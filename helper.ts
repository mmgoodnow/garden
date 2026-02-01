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
  captchaSteps?: number[];
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
  const captchaSteps = await annotateCaptcha(recorded.steps);
  if (captchaSteps && captchaSteps.length > 0) {
    recorded.captchaSteps = captchaSteps;
  }
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

async function annotateCaptcha(
  steps: RecordedStep[],
): Promise<number[] | null> {
  if (!process.stdin.isTTY) {
    return null;
  }

  if (steps.length === 0) {
    console.log("No steps to annotate.");
    return null;
  }

  const start = await pickStepIndex(
    "What's the first action of the captcha solution?",
    steps,
    0,
  );
  if (start === null) {
    return null;
  }

  const end = await pickStepIndex(
    "What's the last action of the captcha solution?",
    steps,
    start,
    start,
  );
  if (end === null) {
    return null;
  }

  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const range = [];
  for (let i = from; i <= to; i += 1) range.push(i);
  return range;
}

function summarizeStep(step: RecordedStep): string {
  if (step.type === "goto" && step.url) {
    return `goto ${truncate(step.url, 80)}`;
  }

  if (step.type === "fill" || step.type === "type" || step.type === "press") {
    const value = step.value ? ` "${truncate(step.value, 30)}"` : "";
    return `${step.type} ${truncate(step.locator ?? "", 60)}${value}`;
  }

  return `${step.type} ${truncate(step.locator ?? "", 80)}`;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function promptLine(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const onData = (data: Buffer) => {
      process.stdin.off("data", onData);
      resolve(data.toString().trim());
    };
    process.stdin.on("data", onData);
  });
}

async function pickStepIndex(
  title: string,
  steps: RecordedStep[],
  initialIndex: number,
  highlightIndex?: number,
): Promise<number | null> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return null;

  let index = Math.min(Math.max(initialIndex, 0), steps.length - 1);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  const windowSize = 12;
  const reset = "\x1b[0m";
  const highlight = "\x1b[36m";
  const startMark = "\x1b[33m";
  const dim = "\x1b[2m";

  const render = () => {
    process.stdout.write("\x1b[2J\x1b[H");
    console.log(title);
    console.log("Use up/down or j/k. Enter to select. q to cancel.");
    console.log("");

    const half = Math.floor(windowSize / 2);
    let start = Math.max(0, index - half);
    let end = Math.min(steps.length, start + windowSize);
    if (end - start < windowSize) {
      start = Math.max(0, end - windowSize);
    }

    if (start > 0) {
      console.log(`  ${dim}...${reset}`);
    }

    for (let i = start; i < end; i += 1) {
      const summary = summarizeStep(steps[i]);
      if (i === index) {
        console.log(`  ${highlight}>> ${i + 1}. ${summary}${reset}`);
        continue;
      }

      if (highlightIndex === i) {
        console.log(
          `  ${startMark}*  ${i + 1}. ${summary} [captcha start]${reset}`,
        );
        continue;
      }

      console.log(`     ${i + 1}. ${summary}`);
    }

    if (end < steps.length) {
      console.log(`  ${dim}...${reset}`);
    }
  };

  render();

  return await new Promise((resolve) => {
    const finish = (value: number | null) => {
      stdin.off("data", onData);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      process.stdout.write("\n");
      resolve(value);
    };

    const onData = (chunk: string) => {
      if (chunk === "\u0003") {
        finish(null);
        return;
      }

      if (chunk === "\r" || chunk === "\n") {
        finish(index);
        return;
      }

      if (chunk === "q") {
        finish(null);
        return;
      }

      if (chunk === "j" || chunk === "n" || chunk === "\u001b[B") {
        if (index < steps.length - 1) index += 1;
        render();
        return;
      }

      if (chunk === "k" || chunk === "p" || chunk === "\u001b[A") {
        if (index > 0) index -= 1;
        render();
        return;
      }
    };

    stdin.on("data", onData);
  });
}
