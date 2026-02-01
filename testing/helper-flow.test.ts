import { test, expect } from "bun:test";
import { processCodegen } from "../helper-lib";
import {
  createSite,
  setCredentials,
  startTestEnv,
  stopTestEnv,
  triggerRun,
  uploadScript,
  waitForRun,
  waitForScreenshotSize,
} from "./test-helpers";

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
await page.getByRole('button', { name: 'Sign in' }).click();
await page.goto('http://localhost:${env.mockPort}/dashboard');
`;

      const script = await processCodegen(codegen);
      const { res, siteId } = await createSite(env.serverPort);
      expect(res.status).toBe(303);
      expect(Number.isFinite(siteId)).toBe(true);

      const scriptRes = await uploadScript(env.serverPort, siteId, script);
      expect(scriptRes.status).toBe(200);
      const scriptBody = await scriptRes.json();
      expect(scriptBody.ok).toBe(true);

      const credRes = await setCredentials(env.serverPort, siteId);
      expect(credRes.status).toBe(303);

      const runRes = await triggerRun(env.serverPort, siteId);
      expect(runRes.status).toBe(303);

      const run = await waitForRun(env.dbPath, siteId, 30000);
      expect(run.status).toBe("success");
      expect(run.error).toBeNull();

      const shotSize = await waitForScreenshotSize(env.dbPath, run.id, 10000);
      expect(shotSize).toBeGreaterThan(0);
    } finally {
      stopTestEnv(env);
    }
  },
  TIMEOUT_MS,
);
