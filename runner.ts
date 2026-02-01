import { chromium, type Locator, type Page } from "playwright";
import { db } from "./db";
import { decryptSecret } from "./crypto";
import { parseScript, type RecordedScript, type Step } from "./script";

type SecretValues = {
  username?: string;
  password?: string;
  [key: string]: string | undefined;
};

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

  try {
    const secrets = buildSecrets(site.username_enc, site.password_enc, script);
    await runScriptWithRetries(script, secrets, runId);

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const duration = Date.now() - startedAt;
    console.error(`[runner] run ${runId} failed (${duration}ms): ${message}`);
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
) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    for (const step of script.steps) {
      await runStep(page, step, secrets);
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
) {
  const retries = Number.parseInt(process.env.RUNNER_MAX_RETRIES ?? "1", 10);
  const delayMs = Number.parseInt(process.env.RUNNER_RETRY_DELAY_MS ?? "2000", 10);
  const attempts = Number.isFinite(retries) && retries > 0 ? retries + 1 : 1;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    console.log(`[runner] run ${runId} attempt ${attempt}/${attempts}`);
    try {
      await runScript(script, secrets, runId);
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[runner] run ${runId} attempt ${attempt} failed: ${message}`);
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

async function runStep(page: Page, step: Step, secrets: SecretValues) {
  if (step.type === "captcha") {
    await solveCaptcha(page, step, secrets);
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

type CaptchaModelStep = {
  type: string;
  locator?: string;
  selector?: string;
  url?: string;
  value?: string;
  args?: string;
};

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
    const pickContainer = (node: Element) => {
      let current: Element | null = node;
      let chosen: Element = node;

      for (let i = 0; i < 3; i += 1) {
        if (!current?.parentElement) break;
        const parent = current.parentElement;
        const parentHtml = parent.outerHTML ?? "";
        const chosenHtml = chosen.outerHTML ?? "";
        const hasImage = Boolean(parent.querySelector("img"));
        if (hasImage || parentHtml.length > chosenHtml.length + 200) {
          chosen = parent;
        }
        current = parent;
      }

      return chosen;
    };

    const container = pickContainer(el);
    const images = Array.from(container.querySelectorAll("img"))
      .map((img) => img.getAttribute("src"))
      .filter((src): src is string => Boolean(src));

    return { html: container.outerHTML, imageSrcs: images };
  });

  const resolvedImages = await resolveImageAssets(page, imageSrcs);
  const { htmlWithMarkers, imageInputs, imageMap } = buildCaptchaPayload(
    html,
    resolvedImages,
  );

  const modelSteps = await requestCaptchaSteps(
    page.url(),
    htmlWithMarkers,
    imageInputs,
    imageMap,
  );

  if (!modelSteps.length) {
    throw new Error("Captcha solver returned no steps.");
  }

  for (const modelStep of modelSteps) {
    const normalized = normalizeCaptchaStep(modelStep);
    await runStep(page, normalized, secrets);
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

async function requestCaptchaSteps(
  pageUrl: string,
  html: string,
  imageInputs: Array<{ type: "input_image"; image_url: string }>,
  imageMap: string,
): Promise<CaptchaModelStep[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to solve captcha steps.");
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-5-mini";
  const instructions = [
    "You are helping automate captcha completion inside a web page.",
    "Return ONLY JSON matching the provided schema.",
    "Use CSS selectors for locator fields (e.g. '#submit', '.tile:nth-child(2)').",
    "Only include the actions required to solve the captcha and proceed.",
  ].join(" ");

  const userText = [
    `Page URL: ${pageUrl}`,
    "",
    "HTML fragment for the captcha section:",
    html,
    "",
    imageMap ? "Image map:" : "No images found in fragment.",
    imageMap || "",
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
                  locator: { type: "string" },
                  selector: { type: "string" },
                  url: { type: "string" },
                  value: { type: "string" },
                  args: { type: "string" },
                },
                required: ["type"],
              },
            },
          },
          required: ["steps"],
        },
      },
    },
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
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

  return parsed.steps as CaptchaModelStep[];
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
    return { type: "goto", url: step.url ?? "" };
  }

  const locator = step.locator ?? step.selector;
  if (!locator) {
    throw new Error(`Captcha step missing locator for ${step.type}.`);
  }

  return {
    type: step.type,
    locator,
    value: step.value,
    args: step.args,
  };
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
