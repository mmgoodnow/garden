import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMockScript,
  createSite,
  startTestEnv,
  stopTestEnv,
  uploadScript,
} from "./test-helpers.ts";

test(
  "scripts wait endpoint returns latest script after upload",
  async () => {
    const env = await startTestEnv();
    try {
      const { siteId } = await createSite(env.serverPort, env.dbPath);
      assert.ok(siteId > 0);

      const script = buildMockScript(env.mockPort);
      const uploadRes = await uploadScript(env.serverPort, siteId, script);
      assert.equal(uploadRes.status, 200);

      const waitRes = await fetch(
        `http://localhost:${env.serverPort}/api/scripts/wait?siteId=${siteId}&afterId=0`,
      );
      assert.equal(waitRes.status, 200);
      const payload = await waitRes.json();
      assert.equal(typeof payload.id, "number");
      assert.ok(payload.id > 0);
      assert.ok(typeof payload.content === "string");
    } finally {
      stopTestEnv(env);
    }
  },
  30000,
);
