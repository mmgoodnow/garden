import test from "node:test";
import assert from "node:assert/strict";
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
} from "./test-helpers.ts";

test(
  "runner end-to-end flow (mock site + curl-style API calls)",
  async () => {
    const env = await startTestEnv();
    try {
      const { res, siteId, siteDomain } = await createSite(
        env.serverPort,
        env.dbPath,
      );
      assert.equal(res.status, 303);
      assert.ok(Number.isFinite(siteId));

      const script = buildMockScript(env.mockPort);
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
  60000,
);
