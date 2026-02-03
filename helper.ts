import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { processCodegen } from "./helper-lib";

const USAGE = `garden helper

Usage:
  node --experimental-strip-types helper.ts record [url] [--upload-to <baseUrl>] [--site-id <id>]
  node --experimental-strip-types helper.ts upload <script.json> --upload-to <baseUrl> --site-id <id>

Commands:
  record    Launch Playwright codegen, save script JSON, optionally upload.
  upload    Upload a saved script JSON file.
`;

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "help" || command === "--help") {
  console.log(USAGE);
  process.exit(0);
}

if (command === "record") {
  const recordArgs = parseRecordArgs(args.slice(1));
  await recordCodegen(
    recordArgs.url,
    recordArgs.uploadTo,
    recordArgs.siteId,
  );
  process.exit(0);
}

if (command === "upload") {
  const uploadArgs = parseUploadArgs(args.slice(1));
  if (!uploadArgs.path || !uploadArgs.uploadTo || !uploadArgs.siteId) {
    console.error(`Missing required args.\n\n${USAGE}`);
    process.exit(1);
  }
  const script = await readScriptFile(uploadArgs.path);
  await uploadScript(uploadArgs.uploadTo, uploadArgs.siteId, script);
  console.log(`Uploaded script for site ${uploadArgs.siteId} to ${uploadArgs.uploadTo}.`);
  process.exit(0);
}

console.error(`Unknown command: ${command}\n\n${USAGE}`);
process.exit(1);

async function recordCodegen(
  url?: string,
  uploadTo?: string,
  siteId?: number,
) {
  const tmpDir = process.env.TMPDIR ?? "/tmp";
  const outputPath = `${tmpDir}/garden-codegen-${Date.now()}.js`;
  const cmd = ["npx", "playwright", "codegen", "--output", outputPath];
  if (url) cmd.push(url);

  const proc = spawn(cmd[0]!, cmd.slice(1), { stdio: "inherit" });
  const exitCode = await new Promise<number>((resolve) => {
    proc.on("close", (code) => resolve(code ?? 1));
  });
  const hasOutput = await fileExists(outputPath);
  if (!hasOutput) {
    console.error(
      `No codegen output found at ${outputPath}. Exit code: ${exitCode}`,
    );
    console.error("Try closing the codegen window instead of Ctrl+C.");
    process.exit(exitCode || 1);
  }

  const text = await readFile(outputPath, "utf8");
  if (!text.trim()) {
    console.error(`Codegen output was empty at ${outputPath}.`);
    console.error("Try closing the codegen window instead of Ctrl+C.");
    process.exit(exitCode || 1);
  }

  if (exitCode !== 0) {
    console.error(
      `Warning: codegen exited with ${exitCode}, but output was captured.`,
    );
  }

  const recorded = await processCodegen(text);
  const savedPath = await writeScriptFile(recorded);
  console.log(`Saved script to ${savedPath}.`);
  if (uploadTo && siteId) {
    await uploadScript(uploadTo, siteId, recorded);
    console.log(`Uploaded script for site ${siteId} to ${uploadTo}.`);
    console.log(
      `If you need to retry: node --experimental-strip-types helper.ts upload ${savedPath} --upload-to ${uploadTo} --site-id ${siteId}`,
    );
  } else {
    console.log(JSON.stringify(recorded, null, 2));
    console.log(
      `To upload later: node --experimental-strip-types helper.ts upload ${savedPath} --upload-to <baseUrl> --site-id <id>`,
    );
  }
}

function parseRecordArgs(rawArgs: string[]) {
  let url: string | undefined;
  let uploadTo: string | undefined;
  let siteId: number | undefined;

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg) continue;

    if (arg === "--upload-to") {
      uploadTo = rawArgs[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--site-id") {
      const parsed = Number.parseInt(rawArgs[i + 1] ?? "", 10);
      if (Number.isFinite(parsed)) {
        siteId = parsed;
      }
      i += 1;
      continue;
    }

    if (!arg.startsWith("--") && !url) {
      url = arg;
    }
  }

  return { url, uploadTo, siteId };
}

function parseUploadArgs(rawArgs: string[]) {
  let path: string | undefined;
  let uploadTo: string | undefined;
  let siteId: number | undefined;

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg) continue;

    if (arg === "--upload-to") {
      uploadTo = rawArgs[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--site-id") {
      const parsed = Number.parseInt(rawArgs[i + 1] ?? "", 10);
      if (Number.isFinite(parsed)) {
        siteId = parsed;
      }
      i += 1;
      continue;
    }

    if (!arg.startsWith("--") && !path) {
      path = arg;
    }
  }

  return { path, uploadTo, siteId };
}

async function uploadScript(
  uploadTo: string,
  siteId: number,
  script: object,
) {
  const base = uploadTo.replace(/\/$/, "");
  const payload = JSON.stringify({ siteId, script });
  try {
    const res = await fetch(`${base}/api/scripts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Upload failed (${res.status}): ${body}`);
    }
    return;
  } catch (error) {
    if (!(error instanceof Error) || !shouldOfferCurl(error)) {
      throw error;
    }
    const useCurl = await confirm("Fetch failed. Do you want to try curl? (y/N)");
    if (!useCurl) {
      throw error;
    }
    const payloadPath = await writePayloadFile(payload);
    await uploadWithCurl(base, payloadPath);
  }
}

async function readScriptFile(path: string) {
  if (!(await fileExists(path))) {
    throw new Error(`Script file not found: ${path}`);
  }
  const text = await readFile(path, "utf8");
  const data = JSON.parse(text);
  if (!data || typeof data !== "object") {
    throw new Error(`Invalid script JSON in ${path}`);
  }
  return data;
}

async function writeScriptFile(script: object) {
  const tmpDir = process.env.TMPDIR ?? "/tmp";
  const path = `${tmpDir}/garden-script-${Date.now()}.json`;
  await writeFile(path, JSON.stringify(script, null, 2), "utf8");
  return path;
}

async function writePayloadFile(payload: string) {
  const tmpDir = process.env.TMPDIR ?? "/tmp";
  const path = `${tmpDir}/garden-upload-${Date.now()}.json`;
  await writeFile(path, payload, "utf8");
  return path;
}

async function uploadWithCurl(base: string, payloadPath: string) {
  const proc = spawn(
    "curl",
    [
      "-sS",
      "-X",
      "POST",
      "-H",
      "Content-Type: application/json",
      "--data-binary",
      `@${payloadPath}`,
      `${base}/api/scripts`,
    ],
    { stdio: "inherit" },
  );
  const exitCode = await new Promise<number>((resolve) => {
    proc.on("close", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error(`curl upload failed with exit code ${exitCode}`);
  }
}

async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function shouldOfferCurl(error: Error) {
  const message = error.message.toLowerCase();
  return (
    message.includes("unable_to_get_issuer_cert_locally") ||
    message.includes("certificate") ||
    message.includes("fetch failed") ||
    message.includes("tls")
  );
}

async function confirm(promptText: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${promptText} `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}
