type RecordedStep = {
  type: string;
  locator?: string;
  url?: string;
  value?: string;
  args?: string;
};

type RecordedScript = {
  meta: {
    source: "playwright-codegen";
    version: number;
    recordedAt: string;
  };
  steps: RecordedStep[];
};

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

  const recorded = parseCodegen(text);
  console.log(JSON.stringify(recorded, null, 2));
}

function parseCodegen(text: string): RecordedScript {
  const steps: RecordedStep[] = [];
  const lines = text.split(/\r?\n/);
  const actions = new Set([
    "click",
    "dblclick",
    "fill",
    "press",
    "type",
    "check",
    "uncheck",
    "selectOption",
    "hover",
    "tap",
    "focus",
  ]);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("await ")) continue;

    if (trimmed.startsWith("await page.goto(")) {
      const url = extractFirstStringLiteral(trimmed);
      if (url) steps.push({ type: "goto", url });
      continue;
    }

    const match = trimmed.match(/^await (.+)\.(\w+)\((.*)\);$/);
    if (!match) continue;

    const [, target, action, rawArgs] = match;
    if (!actions.has(action)) continue;

    const step: RecordedStep = {
      type: action,
      locator: target,
    };

    const args = rawArgs.trim();
    const value = extractFirstStringLiteral(args);
    if (value && (action === "fill" || action === "type" || action === "press")) {
      step.value = value;
    }
    if (args && !step.value) {
      step.args = args;
    }

    steps.push(step);
  }

  const deduped: RecordedStep[] = [];
  for (const step of steps) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      prev.type === "click" &&
      step.type === "click" &&
      prev.locator === step.locator &&
      prev.args === step.args
    ) {
      continue;
    }
    deduped.push(step);
  }

  return {
    meta: {
      source: "playwright-codegen",
      version: 1,
      recordedAt: new Date().toISOString(),
    },
    steps: deduped,
  };
}

function extractFirstStringLiteral(input: string): string | null {
  const match = input.match(/(['"`])((?:\\.|(?!\1).)*)\1/);
  return match ? match[2] : null;
}
