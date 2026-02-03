import { test, expect } from "bun:test";
import {
  buildMockScript,
  createSite,
  setCredentials,
  startTestEnv,
  stopTestEnv,
  triggerRun,
  uploadScript,
  waitForRun,
  waitForScreenshotSize,
} from "./test-helpers";

test(
  "runner end-to-end flow (mock site + curl-style API calls)",
  async () => {
    const env = await startTestEnv();
    try {
      const { res, siteId, siteDomain } = await createSite(
        env.serverPort,
        env.dbPath,
      );
      expect(res.status).toBe(303);
      expect(Number.isFinite(siteId)).toBe(true);

      const script = buildMockScript(env.mockPort);
      const scriptRes = await uploadScript(env.serverPort, siteId, script);
      expect(scriptRes.status).toBe(200);
      const scriptBody = await scriptRes.json();
      expect(scriptBody.ok).toBe(true);

      const credRes = await setCredentials(env.serverPort, siteDomain);
      expect(credRes.status).toBe(303);

      const runRes = await triggerRun(env.serverPort, siteDomain);
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
  60000,
);
