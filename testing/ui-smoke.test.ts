import { test, expect } from "bun:test";
import { chromium, type Page } from "playwright";
import {
  buildMockScript,
  MOCK_PASSWORD,
  MOCK_USERNAME,
  startTestEnv,
  stopTestEnv,
} from "./test-helpers";

const TIMEOUT_MS = 60000;

test(
  "UI smoke flow (create site, upload script, run)",
  async () => {
    const env = await startTestEnv();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
      const scriptText = JSON.stringify(buildMockScript(env.mockPort), null, 2);

      await page.goto(`http://localhost:${env.serverPort}/sites/new`);
      await page.locator('input[name="name"]').fill("Mock Site");
      await page.locator('input[name="domain"]').fill("localhost");
      await page.getByRole("button", { name: "Create" }).click();
      await page.waitForURL(/\/sites\/[0-9]+$/);

      await page.locator('input[name="username"]').fill(MOCK_USERNAME);
      await page.locator('input[name="password"]').fill(MOCK_PASSWORD);
      await page.getByRole("button", { name: "Update" }).click();
      await page.waitForSelector("text=Stored: yes");

      await page.locator('textarea[name="script"]').fill(scriptText);
      await page.getByRole("button", { name: "Save Script" }).click();
      await page.waitForTimeout(500);

      await page.getByRole("button", { name: "Run Now" }).click();
      await waitForRunSuccess(page, 30000);

      const viewLinks = page.getByRole("link", { name: "view" });
      expect(await viewLinks.count()).toBeGreaterThan(0);
    } finally {
      await browser.close();
      stopTestEnv(env);
    }
  },
  TIMEOUT_MS,
);

async function waitForRunSuccess(page: Page, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await page.reload();
    const successCell = page.getByRole("cell", { name: "success" });
    if (await successCell.count()) {
      return;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error("Timed out waiting for success run");
}
