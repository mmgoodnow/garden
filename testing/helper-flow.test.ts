import test from "node:test";
import assert from "node:assert/strict";
import { processCodegen } from "../helper-lib.ts";
import {
  createSite,
  setCredentials,
  startTestEnv,
  stopTestEnv,
  triggerRun,
  uploadScript,
  waitForRun,
  waitForScreenshotSize,
} from "./test-helpers.ts";

const TIMEOUT_MS = 60000;

test(
  "helper output runs against mock login flow",
  async () => {
    const env = await startTestEnv();

    try {
      const codegen = `
await page.goto('http://localhost:${env.mockPort}/login');
await page.getByLabel('Username').fill('test@example.com');
await page.getByLabel('Password').fill('password123');
await page.locator('#movie-nosferatu').check();
await page.getByRole('button', { name: 'Sign in' }).click();
await page.goto('http://localhost:${env.mockPort}/dashboard');
`;

      const script = await processCodegen(codegen);
      const { res, siteId, siteDomain } = await createSite(
        env.serverPort,
        env.dbPath,
      );
      assert.equal(res.status, 303);
      assert.ok(Number.isFinite(siteId));

      const scriptRes = await uploadScript(env.serverPort, siteId, script);
      assert.equal(scriptRes.status, 200);
      const scriptBody = await scriptRes.json();
      assert.equal(scriptBody.ok, true);

      const credRes = await setCredentials(env.serverPort, siteDomain);
      assert.equal(credRes.status, 303);

      const runRes = await triggerRun(env.serverPort, siteDomain);
      assert.equal(runRes.status, 303);

      const run = await waitForRun(env.dbPath, siteId, 30000);
      assert.equal(run.status, "success");
      assert.equal(run.error, null);

      const shotSize = await waitForScreenshotSize(env.dbPath, run.id, 10000);
      assert.ok(shotSize > 0);
    } finally {
      stopTestEnv(env);
    }
  },
  TIMEOUT_MS,
);
