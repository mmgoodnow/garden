import { chromium, type Locator, type Page } from "playwright";
import { db } from "./db";
import { emitRunEvent } from "./events";
import { decryptSecret } from "./crypto";
import { parseScript, type RecordedScript, type Step } from "./script";

type SecretValues = {
  username?: string;
  password?: string;
  [key: string]: string | undefined;
};

function buildBaseUrl(domain: string | null) {
  if (!domain) return null;
  const trimmed = domain.trim();
  if (!trimmed) return null;
  const hasScheme = /^https?:\/\//i.test(trimmed);
  const base = hasScheme ? trimmed : `${defaultScheme(trimmed)}${trimmed}`;
  return base.replace(/\/$/, "");
}

function defaultScheme(domain: string) {
  const lower = domain.toLowerCase();
  if (
    lower.startsWith("localhost") ||
    lower.startsWith("127.0.0.1") ||
    lower.startsWith("[::1]") ||
    lower.endsWith(".local")
  ) {
    return "http://";
  }
  return "https://";
}

export async function runSite(siteId: number) {
  const site = await db
    .selectFrom("sites")
    .selectAll()
    .where("id", "=", siteId)
    .executeTakeFirst();

  if (!site) {
    throw new Error(`Site ${siteId} not found.`);
  }

  const scriptRow = await db
    .selectFrom("scripts")
    .selectAll()
    .where("site_id", "=", siteId)
    .orderBy("created_at", "desc")
    .limit(1)
    .executeTakeFirst();

  if (!scriptRow) {
    throw new Error("No script uploaded for this site.");
  }

  const script = parseScript(scriptRow.content);

  const now = new Date().toISOString();
  const runResult = await db
    .insertInto("runs")
    .values({
      site_id: siteId,
      status: "running",
      started_at: now,
      finished_at: null,
      duration_ms: null,
      error: null,
    })
    .executeTakeFirst();

  let runId = Number(runResult.insertId ?? 0);
  if (!runId) {
    const fallback = await db
      .selectFrom("runs")
      .select("id")
      .orderBy("id", "desc")
      .limit(1)
      .executeTakeFirst();
    runId = Number(fallback?.id ?? 0);
  }
  const startedAt = Date.now();
  console.log(`[runner] starting run ${runId} for site ${siteId}`);
  emitRunEvent(runId, {
    type: "run.start",
    runId,
    siteId,
    startedAt: now,
  });

  try {
    const secrets = buildSecrets(site.username_enc, site.password_enc, script);
    const baseUrl = buildBaseUrl(site.domain);
    await runScriptWithRetries(script, secrets, runId, baseUrl);

    const duration = Date.now() - startedAt;
    await db
      .updateTable("runs")
      .set({
        status: "success",
        finished_at: new Date().toISOString(),
        duration_ms: duration,
      })
      .where("id", "=", runId)
      .execute();

    await db
      .updateTable("sites")
      .set({
        last_run_at: new Date().toISOString(),
        last_success_at: new Date().toISOString(),
        last_status: "success",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .where("id", "=", siteId)
      .execute();
    console.log(`[runner] run ${runId} success (${duration}ms)`);
    emitRunEvent(runId, {
      type: "run.success",
      runId,
      durationMs: duration,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const duration = Date.now() - startedAt;
    console.error(`[runner] run ${runId} failed (${duration}ms): ${message}`);
    emitRunEvent(runId, {
      type: "run.failed",
      runId,
      durationMs: duration,
      error: message,
    });
    await db
      .updateTable("runs")
      .set({
        status: "failed",
        finished_at: new Date().toISOString(),
        duration_ms: duration,
        error: message,
      })
      .where("id", "=", runId)
      .execute();

    await db
      .updateTable("sites")
      .set({
        last_run_at: new Date().toISOString(),
        last_status: "failed",
        last_error: message,
        updated_at: new Date().toISOString(),
      })
      .where("id", "=", siteId)
      .execute();

    throw error;
  }
}

async function runScript(
  script: RecordedScript,
  secrets: SecretValues,
  runId: number,
  attempt: number,
  startUrl: string | null,
  captchaError?: string,
) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let captchaSequence = 0;

  try {
    if (startUrl && script.steps[0]?.type !== "goto") {
      emitRunEvent(runId, { type: "auto.goto", url: startUrl });
      await page.goto(startUrl, { waitUntil: "domcontentloaded" });
    }
    for (const [index, step] of script.steps.entries()) {
      if (step.type === "captcha") {
        captchaSequence += 1;
      }
      emitRunEvent(runId, {
        type: "step.start",
        attempt,
        index: index + 1,
        total: script.steps.length,
        step: summarizeStep(step),
      });
      await runStep(page, step, secrets, runId, attempt, captchaSequence, captchaError);
      emitRunEvent(runId, {
        type: "step.done",
        attempt,
        index: index + 1,
        total: script.steps.length,
      });
      if (step.type === "captcha") {
        captchaError = undefined;
      }
    }

    await captureScreenshot(runId, page);
  } finally {
    await browser.close();
  }
}

async function runScriptWithRetries(
  script: RecordedScript,
  secrets: SecretValues,
  runId: number,
  startUrl: string | null,
) {
  const retries = Number.parseInt(process.env.RUNNER_MAX_RETRIES ?? "1", 10);
  const delayMs = Number.parseInt(process.env.RUNNER_RETRY_DELAY_MS ?? "2000", 10);
  const attempts = Number.isFinite(retries) && retries > 0 ? retries + 1 : 1;

  let lastError: unknown = null;
  let lastCaptchaError: string | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    console.log(`[runner] run ${runId} attempt ${attempt}/${attempts}`);
    emitRunEvent(runId, {
      type: "run.attempt",
      runId,
      attempt,
      total: attempts,
    });
    try {
      await runScript(script, secrets, runId, attempt, startUrl, lastCaptchaError);
      return;
    } catch (error) {
      lastError = error;
      if (error instanceof CaptchaSolveError) {
        lastCaptchaError = error.message;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[runner] run ${runId} attempt ${attempt} failed: ${message}`);
      emitRunEvent(runId, {
        type: "run.attempt.failed",
        runId,
        attempt,
        error: message,
      });
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

async function runStep(
  page: Page,
  step: Step,
  secrets: SecretValues,
  runId: number,
  attempt: number,
  captchaSequence: number,
  captchaError?: string,
) {
  if (step.type === "captcha") {
    await solveCaptcha(page, step, secrets, runId, attempt, captchaSequence, captchaError);
    return;
  }

  if (step.type === "goto" && step.url) {
    await page.goto(step.url, { waitUntil: "domcontentloaded" });
    return;
  }

  if (!step.locator) {
    return;
  }

  const locator = resolveLocator(page, step.locator);

  if (step.type === "click") return locator.click();
  if (step.type === "dblclick") return locator.dblclick();
  if (step.type === "check") return locator.check();
  if (step.type === "uncheck") return locator.uncheck();
  if (step.type === "hover") return locator.hover();
  if (step.type === "tap") return locator.tap();
  if (step.type === "focus") return locator.focus();

  if (step.type === "fill" || step.type === "type") {
    const value = resolveValue(step.value, secrets);
    if (value === undefined) {
      throw new Error(`Missing value for ${step.type} at ${step.locator}`);
    }
    if (step.type === "fill") return locator.fill(value);
    return locator.type(value);
  }

  if (step.type === "press") {
    const value = resolveValue(step.value, secrets);
    if (!value) {
      throw new Error(`Missing key for press at ${step.locator}`);
    }
    return locator.press(value);
  }

  if (step.type === "selectOption") {
    const value = resolveValue(step.value, secrets);
    if (!value) {
      throw new Error(`Missing value for selectOption at ${step.locator}`);
    }
    return locator.selectOption(value);
  }
}

function summarizeStep(step: Step) {
  return {
    type: step.type,
    locator: step.locator ?? null,
    url: step.type === "goto" ? step.url ?? null : null,
  };
}

type CaptchaModelStep = {
  type: string;
  locator?: string;
  selector?: string;
  url?: string;
  value?: string;
  args?: string;
};

class CaptchaSolveError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    if (cause) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

function resolveValue(value: string | undefined, secrets: SecretValues) {
  if (!value) return value;
  if (value.startsWith("{{") && value.endsWith("}}")) {
    const mapped = secrets[value];
    return mapped ?? "";
  }
  return value;
}

function buildSecrets(
  usernameEnc: string | null,
  passwordEnc: string | null,
  script: RecordedScript,
): SecretValues {
  const values: SecretValues = {};
  const username = usernameEnc ? decryptSecret(usernameEnc) : undefined;
  const password = passwordEnc ? decryptSecret(passwordEnc) : undefined;

  for (const secret of script.secrets) {
    if (secret.kind === "username") {
      values[secret.placeholder] = username ?? "";
    } else if (secret.kind === "password") {
      values[secret.placeholder] = password ?? "";
    } else {
      values[secret.placeholder] = "";
    }
  }

  return values;
}

function resolveLocator(page: Page, target: string): Locator {
  if (target.startsWith("page.")) {
    const call = target.slice("page.".length);
    if (call.startsWith("locator(")) {
      const selector = extractFirstStringLiteral(call);
      return page.locator(selector ?? "");
    }
    if (call.startsWith("getByRole(")) {
      const role = extractFirstStringLiteral(call);
      const name = extractNameOption(call);
      if (name) {
        return page.getByRole(role as never, { name });
      }
      return page.getByRole(role as never);
    }
    if (call.startsWith("getByLabel(")) {
      const label = extractFirstStringLiteral(call);
      return page.getByLabel(label ?? "");
    }
    if (call.startsWith("getByText(")) {
      const text = extractFirstStringLiteral(call);
      return page.getByText(text ?? "");
    }
    if (call.startsWith("getByPlaceholder(")) {
      const text = extractFirstStringLiteral(call);
      return page.getByPlaceholder(text ?? "");
    }
    if (call.startsWith("getByTestId(")) {
      const text = extractFirstStringLiteral(call);
      return page.getByTestId(text ?? "");
    }
    if (call.startsWith("getByTitle(")) {
      const text = extractFirstStringLiteral(call);
      return page.getByTitle(text ?? "");
    }
    if (call.startsWith("getByAltText(")) {
      const text = extractFirstStringLiteral(call);
      return page.getByAltText(text ?? "");
    }
  }

  return page.locator(target);
}

function extractFirstStringLiteral(input: string): string | null {
  const match = input.match(/(['"`])((?:\\.|(?!\1).)*)\1/);
  return match ? match[2] : null;
}

function extractNameOption(input: string): string | null {
  const match = input.match(/name:\s*(['"`])((?:\\.|(?!\1).)*)\1/);
  return match ? match[2] : null;
}

async function solveCaptcha(
  page: Page,
  step: Step & { type: "captcha" },
  secrets: SecretValues,
  runId: number,
  attempt: number,
  sequence: number,
  previousError?: string,
) {
  const target =
    step.steps.find((child) => child.type === "click" && child.locator) ??
    step.steps.find((child) => child.locator);

  if (!target?.locator) {
    throw new Error("Captcha step missing an initial click locator.");
  }

  const locator = resolveLocator(page, target.locator);
  await locator.scrollIntoViewIfNeeded();

  const { html, imageSrcs } = await locator.evaluate((el) => {
    const container = el.closest?.("#captcha") ?? el;
    const images = Array.from(container.querySelectorAll("img"))
      .map((img) => img.getAttribute("src"))
      .filter((src): src is string => Boolean(src));

    return { html: container.outerHTML, imageSrcs: images };
  });

  const sanitizedHtml = sanitizeCaptchaHtml(html, secrets);
  const resolvedImages = await resolveImageAssets(page, imageSrcs);
  const { htmlWithMarkers, imageInputs, imageMap } = buildCaptchaPayload(
    sanitizedHtml,
    resolvedImages,
  );

  let modelSteps: CaptchaModelStep[];
  const request = buildCaptchaRequest(
    page.url(),
    htmlWithMarkers,
    imageInputs,
    imageMap,
    previousError,
    secrets,
  );
  emitRunEvent(runId, {
    type: "captcha.request",
    runId,
    attempt,
    sequence,
    model: request.model,
  });
  try {
    const response = await requestCaptchaSteps(request);
    modelSteps = response.steps;
    await recordCaptchaTrace({
      run_id: runId,
      attempt,
      sequence,
      model: request.model,
      prompt: request.prompt,
      response: response.responseText,
      error: null,
    });
    emitRunEvent(runId, {
      type: "captcha.response",
      runId,
      attempt,
      sequence,
      model: request.model,
      steps: summarizeCaptchaSteps(modelSteps),
    });
  } catch (error) {
    await recordCaptchaTrace({
      run_id: runId,
      attempt,
      sequence,
      model: request.model,
      prompt: request.prompt,
      response: null,
      error: error instanceof Error ? error.message : String(error),
    });
    emitRunEvent(runId, {
      type: "captcha.error",
      runId,
      attempt,
      sequence,
      model: request.model,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new CaptchaSolveError(
      error instanceof Error ? error.message : String(error),
      error,
    );
  }

  if (!modelSteps.length) {
    throw new CaptchaSolveError("Captcha solver returned no steps.");
  }

  try {
    for (const modelStep of modelSteps) {
      const normalized = normalizeCaptchaStep(modelStep);
      await runStep(page, normalized, secrets);
    }
  } catch (error) {
    throw new CaptchaSolveError(
      error instanceof Error ? error.message : String(error),
      error,
    );
  }
}

type ResolvedImage = {
  originalSrc: string;
  dataUrl: string;
  label: string;
};

async function resolveImageAssets(
  page: Page,
  imageSrcs: string[],
): Promise<ResolvedImage[]> {
  const unique = Array.from(new Set(imageSrcs)).filter(Boolean);
  const resolved: ResolvedImage[] = [];
  const limit = 8;

  for (const [index, src] of unique.slice(0, limit).entries()) {
    let absolute: string;
    try {
      absolute = new URL(src, page.url()).toString();
    } catch {
      continue;
    }

    const response = await page.request.get(absolute);
    if (!response.ok()) continue;

    const contentType = response.headers()["content-type"] ?? "image/png";
    const buffer = await response.body();
    const dataUrl = `data:${contentType};base64,${Buffer.from(buffer).toString(
      "base64",
    )}`;

    resolved.push({
      originalSrc: src,
      dataUrl,
      label: `image-${index + 1}`,
    });
  }

  return resolved;
}

function buildCaptchaPayload(html: string, images: ResolvedImage[]) {
  let htmlWithMarkers = html;
  for (const image of images) {
    htmlWithMarkers = htmlWithMarkers.split(image.originalSrc).join(image.label);
  }

  const imageInputs: Array<{ type: "input_image"; image_url: string }> = images.map(
    (image) => ({
      type: "input_image",
      image_url: image.dataUrl,
    }),
  );
  const imageMap = images
    .map((image) => `- ${image.label}: ${image.originalSrc}`)
    .join("\n");

  return { htmlWithMarkers, imageInputs, imageMap };
}

function sanitizeCaptchaHtml(html: string, secrets: SecretValues): string {
  let sanitized = html;
  sanitized = sanitized.replace(
    /<input\b[^>]*type=(['"])password\1[^>]*>/gi,
    "",
  );
  sanitized = sanitized.replace(/\svalue=(['"]).*?\1/gi, "");
  sanitized = sanitized.replace(/\sdata-value=(['"]).*?\1/gi, "");
  return redactSecretsInText(sanitized, secrets);
}

function buildCaptchaRequest(
  pageUrl: string,
  html: string,
  imageInputs: Array<{ type: "input_image"; image_url: string }>,
  imageMap: string,
  previousError: unknown,
  secrets: SecretValues,
) {
  const model = process.env.OPENAI_MODEL ?? "gpt-5-mini";
  const instructions = [
    "You are helping automate captcha completion inside a web page.",
    "Return ONLY JSON matching the provided schema.",
    "Use CSS selectors for locator fields (e.g. '#submit', '.tile:nth-child(2)').",
    "All selectors MUST target elements inside the #captcha container.",
    "Do NOT click any submit/sign-in/continue buttons; the caller will submit the form.",
    "Pick the option that best matches the poster/image.",
    "Only include the actions required to solve the captcha and proceed.",
  ].join(" ");

  const errorTextRaw =
    previousError instanceof Error
      ? previousError.message
      : previousError
        ? String(previousError)
        : "";
  const errorText = errorTextRaw
    ? redactSecretsInText(errorTextRaw, secrets)
    : "";

  const userText = [
    `Page URL: ${pageUrl}`,
    "",
    "HTML fragment for the captcha section:",
    html,
    "",
    imageMap ? "Image map:" : "No images found in fragment.",
    imageMap || "",
    errorText ? `Previous attempt error: ${errorText}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const payload = {
    model,
    input: [
      {
        role: "developer",
        content: [{ type: "input_text", text: instructions }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: userText }, ...imageInputs],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "captcha_steps",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            steps: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  type: { type: "string" },
                  locator: { type: ["string", "null"] },
                  selector: { type: ["string", "null"] },
                  url: { type: ["string", "null"] },
                  value: { type: ["string", "null"] },
                  args: { type: ["string", "null"] },
                },
                required: ["type", "locator", "selector", "url", "value", "args"],
              },
            },
          },
          required: ["steps"],
        },
      },
    },
  };

  return {
    model,
    prompt: truncateText([instructions, "", userText].join("\n")),
    payload,
  };
}

async function requestCaptchaSteps(request: {
  model: string;
  prompt: string;
  payload: unknown;
}): Promise<{ steps: CaptchaModelStep[]; responseText: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to solve captcha steps.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request.payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI captcha request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  const outputText = extractOutputText(data);
  if (!outputText) {
    throw new Error("OpenAI captcha response missing output text.");
  }

  const parsed = JSON.parse(outputText);
  if (!parsed || !Array.isArray(parsed.steps)) {
    throw new Error("OpenAI captcha response did not include steps.");
  }

  return { steps: parsed.steps as CaptchaModelStep[], responseText: outputText };
}

function extractOutputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as {
    output_text?: string;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };
  if (typeof record.output_text === "string") {
    return record.output_text;
  }
  const message = record.output?.find((item) => item.type === "message");
  const content = message?.content?.find((item) => item.type === "output_text");
  return content?.text ?? "";
}

function normalizeCaptchaStep(step: CaptchaModelStep): Step {
  if (step.type === "captcha") {
    throw new Error("Captcha solver returned nested captcha step.");
  }

  if (step.type === "goto") {
    throw new Error("Captcha solver returned disallowed goto step.");
  }

  const locator = step.locator ?? step.selector;
  if (!locator) {
    throw new Error(`Captcha step missing locator for ${step.type}.`);
  }

  const scopedLocator = scopeCaptchaSelector(locator);

  return {
    type: step.type,
    locator: scopedLocator,
    value: step.value,
    args: step.args,
  };
}

function summarizeCaptchaSteps(steps: CaptchaModelStep[]) {
  return steps.map((step) => ({
    type: step.type,
    locator: step.locator ?? step.selector ?? null,
    value: step.value ?? null,
  }));
}

function scopeCaptchaSelector(locator: string): string {
  const trimmed = locator.trim();
  if (!trimmed) {
    throw new Error("Captcha selector is empty.");
  }
  if (trimmed.startsWith("page.")) {
    throw new Error("Captcha selector must be CSS, not Playwright locator syntax.");
  }
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("text=") ||
    lower.startsWith("xpath=") ||
    lower.startsWith("id=") ||
    lower.startsWith("css=")
  ) {
    throw new Error("Captcha selector must be plain CSS.");
  }
  if (trimmed.startsWith("#captcha")) {
    return trimmed;
  }
  return `#captcha ${trimmed}`;
}

function redactSecretsInText(text: string, secrets: SecretValues) {
  let sanitized = text;
  const secretValues = Array.from(
    new Set(
      Object.values(secrets).filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      ),
    ),
  );
  for (const value of secretValues) {
    sanitized = sanitized.split(value).join("[REDACTED]");
  }
  return sanitized;
}

function truncateText(text: string, maxLength = 8000) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

async function recordCaptchaTrace(entry: {
  run_id: number;
  attempt: number;
  sequence: number;
  model: string;
  prompt: string;
  response: string | null;
  error: string | null;
}) {
  if (!entry.run_id) return;
  try {
    await db
      .insertInto("captcha_traces")
      .values({
        run_id: entry.run_id,
        attempt: entry.attempt,
        sequence: entry.sequence,
        model: entry.model,
        prompt: entry.prompt,
        response: entry.response,
        error: entry.error,
        created_at: new Date().toISOString(),
      })
      .execute();
  } catch (err) {
    console.warn(
      `[runner] failed to store captcha trace for run ${entry.run_id}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

async function captureScreenshot(runId: number, page: Page) {
  if (!runId) return;
  const data = await page.screenshot({ fullPage: true, type: "png" });

  await db
    .insertInto("screenshots")
    .values({
      run_id: runId,
      data,
      mime_type: "image/png",
      created_at: new Date().toISOString(),
    })
    .execute();
}
