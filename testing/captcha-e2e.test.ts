import { test, expect } from "bun:test";
import {
  buildCaptchaScript,
  createSite,
  startTestEnv,
  stopTestEnv,
  triggerRun,
  uploadScript,
  waitForRun,
  waitForScreenshotSize,
} from "./test-helpers";

const TIMEOUT_MS = 120000;
const runTest = process.env.OPENAI_API_KEY ? test : test.skip;

runTest(
  "captcha solver flow",
  async () => {
    const env = await startTestEnv();
    try {
      const { res, siteId } = await createSite(env.serverPort);
      expect(res.status).toBe(303);
      expect(Number.isFinite(siteId)).toBe(true);

      const script = buildCaptchaScript(env.mockPort);
      const scriptRes = await uploadScript(env.serverPort, siteId, script);
      expect(scriptRes.status).toBe(200);
      const scriptBody = await scriptRes.json();
      expect(scriptBody.ok).toBe(true);

      const runRes = await triggerRun(env.serverPort, siteId);
      expect(runRes.status).toBe(303);

      const run = await waitForRun(env.dbPath, siteId, 60000);
      if (run.status !== "success") {
        throw new Error(run.error ?? "Captcha run failed without error");
      }
      expect(run.error).toBeNull();

      const shotSize = await waitForScreenshotSize(env.dbPath, run.id, 10000);
      expect(shotSize).toBeGreaterThan(0);
    } finally {
      stopTestEnv(env);
    }
  },
  TIMEOUT_MS,
);
