import { processCodegen } from "./helper-lib";

const USAGE = `garden helper

Usage:
  bun helper.ts record [url] [--upload-to <baseUrl>] [--site-id <id>] [--insecure]

Commands:
  record    Launch Playwright codegen, then print recorded script JSON.
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
    recordArgs.insecure,
  );
  process.exit(0);
}

console.error(`Unknown command: ${command}\n\n${USAGE}`);
process.exit(1);

async function recordCodegen(
  url?: string,
  uploadTo?: string,
  siteId?: number,
  insecure?: boolean,
) {
  const tmpDir = process.env.TMPDIR ?? "/tmp";
  const outputPath = `${tmpDir}/garden-codegen-${Date.now()}.js`;
  const cmd = ["bunx", "playwright", "codegen", "--output", outputPath];
  if (url) cmd.push(url);

  const proc = Bun.spawn({
    cmd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  const outputFile = Bun.file(outputPath);
  const hasOutput = await outputFile.exists();
  if (!hasOutput) {
    console.error(
      `No codegen output found at ${outputPath}. Exit code: ${exitCode}`,
    );
    console.error("Try closing the codegen window instead of Ctrl+C.");
    process.exit(exitCode || 1);
  }

  const text = await outputFile.text();
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
  if (uploadTo && siteId) {
    await uploadScript(uploadTo, siteId, recorded, insecure);
    console.log(`Uploaded script for site ${siteId} to ${uploadTo}.`);
  } else {
    console.log(JSON.stringify(recorded, null, 2));
  }
}

function parseRecordArgs(rawArgs: string[]) {
  let url: string | undefined;
  let uploadTo: string | undefined;
  let siteId: number | undefined;
  let insecure = false;

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

    if (arg === "--insecure") {
      insecure = true;
      continue;
    }

    if (!arg.startsWith("--") && !url) {
      url = arg;
    }
  }

  return { url, uploadTo, siteId, insecure };
}

async function uploadScript(
  uploadTo: string,
  siteId: number,
  script: object,
  insecure?: boolean,
) {
  const base = uploadTo.replace(/\/$/, "");
  const res = await fetch(`${base}/api/scripts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteId, script }),
    ...(insecure ? { tls: { rejectUnauthorized: false } } : {}),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Upload failed (${res.status}): ${body}`);
  }
}
