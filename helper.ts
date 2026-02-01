import { processCodegen } from "./helper-lib";

const USAGE = `garden helper

Usage:
  bun helper.ts record [url]

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
  const url = args[1];
  await recordCodegen(url);
  process.exit(0);
}

console.error(`Unknown command: ${command}\n\n${USAGE}`);
process.exit(1);

async function recordCodegen(url?: string) {
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
  console.log(JSON.stringify(recorded, null, 2));
}
