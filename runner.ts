import { chromium, type Locator, type Page } from "playwright";
import { db } from "./db";
import { decryptSecret } from "./crypto";
import { ensureDir } from "./util";
import { SCREENSHOT_DIR } from "./config";
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

  try {
    const secrets = buildSecrets(site.username_enc, site.password_enc, script);
    await runScript(script, secrets, runId);

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const duration = Date.now() - startedAt;
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

async function runStep(page: Page, step: Step, secrets: SecretValues) {
  if (step.type === "captcha") {
    throw new Error("Captcha step requires a solver (not implemented yet).");
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

async function captureScreenshot(runId: number, page: Page) {
  if (!runId) return;
  ensureDir(SCREENSHOT_DIR);
  const path = `${SCREENSHOT_DIR}/run-${runId}.png`;
  await page.screenshot({ path, fullPage: true });

  await db
    .insertInto("screenshots")
    .values({
      run_id: runId,
      path,
      created_at: new Date().toISOString(),
    })
    .execute();
}
