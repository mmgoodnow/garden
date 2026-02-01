export type ActionStep = {
  type: string;
  locator?: string;
  url?: string;
  value?: string;
  args?: string;
};

export type SecretKind = "username" | "password" | "secret";

export type SecretSpec = {
  placeholder: string;
  kind: SecretKind;
};

export type CaptchaStep = {
  type: "captcha";
  steps: ActionStep[];
};

export type Step = ActionStep | CaptchaStep;

export type RecordedScript = {
  meta: {
    source: "playwright-codegen";
    version: number;
    recordedAt: string;
  };
  steps: Step[];
  secrets: SecretSpec[];
};

export async function processCodegen(text: string): Promise<RecordedScript> {
  const recorded = parseCodegen(text);
  const annotated = await annotateCaptcha(recorded.steps);
  const redacted = redactSecrets(annotated);
  recorded.steps = redacted.steps;
  recorded.secrets = await mapSecretKinds(redacted.secrets, redacted.steps);
  return recorded;
}

export function parseCodegen(text: string): RecordedScript {
  const steps: ActionStep[] = [];
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

    const step: ActionStep = {
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

  const deduped: ActionStep[] = [];
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
    secrets: [],
  };
}

async function annotateCaptcha(steps: ActionStep[]): Promise<Step[]> {
  if (!process.stdin.isTTY) {
    return steps;
  }

  if (steps.length === 0) {
    console.log("No steps to annotate.");
    return steps;
  }

  const start = await pickStepIndex(
    "What's the first action of the captcha solution?",
    steps,
    0,
  );
  if (start === null) {
    return steps;
  }

  const end = await pickStepIndex(
    "What's the last action of the captcha solution?",
    steps,
    start,
    start,
  );
  if (end === null) {
    return steps;
  }

  const from = Math.min(start, end);
  const to = Math.max(start, end);
  const captchaSteps = steps.slice(from, to + 1);
  if (captchaSteps.length === 0) {
    return steps;
  }

  const updated: Step[] = [];
  updated.push(...steps.slice(0, from));
  updated.push({ type: "captcha", steps: captchaSteps });
  updated.push(...steps.slice(to + 1));
  return updated;
}

function redactSecrets(steps: Step[]): {
  steps: Step[];
  secrets: SecretSpec[];
} {
  let counter = 0;
  const secrets: SecretSpec[] = [];

  const redactedSteps = steps.map((step) => {
    if (step.type === "captcha") {
      return step;
    }

    if ((step.type === "fill" || step.type === "type") && step.value) {
      counter += 1;
      const placeholder = `{{secret_${counter}}}`;
      secrets.push({
        placeholder,
        kind: "secret",
      });
      return {
        ...step,
        value: placeholder,
      };
    }

    return step;
  });

  return { steps: redactedSteps, secrets };
}

async function mapSecretKinds(secrets: SecretSpec[], steps: Step[]): Promise<SecretSpec[]> {
  let prompted = false;
  for (const secret of secrets) {
    const hint = findSecretHint(secret.placeholder, steps);

    if (hint.includes("pass") || hint.includes("pwd") || hint.includes("password")) {
      secret.kind = "password";
      continue;
    }

    if (
      hint.includes("user") ||
      hint.includes("email") ||
      hint.includes("login") ||
      hint.includes("username")
    ) {
      secret.kind = "username";
      continue;
    }

    if (!process.stdin.isTTY) {
      secret.kind = "secret";
      continue;
    }

    if (!prompted) {
      console.log("\nMap secret placeholders:");
      prompted = true;
    }

    const source = hint ? truncate(hint, 50) : "unknown";
    const answer = await promptLine(
      `  ${secret.placeholder} from ${source} [u=username, p=password, s=secret]: `,
    );
    const normalized = answer.trim().toLowerCase();
    if (normalized === "u") secret.kind = "username";
    else if (normalized === "p") secret.kind = "password";
    else secret.kind = "secret";
  }

  return secrets;
}

function findSecretHint(placeholder: string, steps: Step[]): string {
  for (const step of steps) {
    if (step.type === "captcha") continue;
    if ((step.type === "fill" || step.type === "type") && step.value === placeholder) {
      return `${step.type} ${step.locator ?? ""}`.trim();
    }
  }
  return "";
}

function extractFirstStringLiteral(input: string): string | null {
  const match = input.match(/(['"`])((?:\\.|(?!\1).)*)\1/);
  return match ? match[2] : null;
}

function promptLine(question: string): Promise<string> {
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  if (stdin.isTTY) stdin.setRawMode(false);
  stdin.resume();

  return new Promise((resolve) => {
    process.stdout.write(question);
    const onData = (data: Buffer) => {
      stdin.off("data", onData);
      if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
      resolve(data.toString().trim());
    };
    stdin.on("data", onData);
  });
}

function summarizeStep(step: ActionStep | CaptchaStep): string {
  if (step.type === "captcha") {
    return `captcha (${step.steps.length} steps)`;
  }
  if (step.type === "goto" && step.url) {
    return `goto ${truncate(step.url, 80)}`;
  }

  if (step.type === "fill" || step.type === "type" || step.type === "press") {
    const value = step.value ? ` \"${truncate(step.value, 30)}\"` : "";
    return `${step.type} ${truncate(step.locator ?? "", 60)}${value}`;
  }

  return `${step.type} ${truncate(step.locator ?? "", 80)}`;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

async function pickStepIndex(
  title: string,
  steps: ActionStep[],
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

      if (chunk === "j" || chunk === "n" || chunk === "\u001b[B" || chunk === "\u000e") {
        if (index < steps.length - 1) index += 1;
        render();
        return;
      }

      if (chunk === "k" || chunk === "p" || chunk === "\u001b[A" || chunk === "\u0010") {
        if (index > 0) index -= 1;
        render();
        return;
      }
    };

    stdin.on("data", onData);
  });
}
