import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createSite, startTestEnv, stopTestEnv } from "./test-helpers.ts";

test("index page shows 30d and all-time uptime", async () => {
  const env = await startTestEnv();

  try {
    const { siteId } = await createSite(env.serverPort, env.dbPath, "uptime.local");
    assert.ok(siteId > 0);

    const now = Date.now();
    const db = new DatabaseSync(env.dbPath);
    try {
      const insertRun = db.prepare(
        `insert into runs (site_id, status, error, started_at, finished_at, duration_ms)
         values (?, ?, ?, ?, ?, ?)`,
      );

      insertRun.run(
        siteId,
        "success",
        null,
        new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
        new Date(now - 5 * 24 * 60 * 60 * 1000 + 1_000).toISOString(),
        1_000,
      );
      insertRun.run(
        siteId,
        "failed",
        "boom",
        new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
        new Date(now - 10 * 24 * 60 * 60 * 1000 + 1_000).toISOString(),
        1_000,
      );
      insertRun.run(
        siteId,
        "success",
        null,
        new Date(now - 45 * 24 * 60 * 60 * 1000).toISOString(),
        new Date(now - 45 * 24 * 60 * 60 * 1000 + 1_000).toISOString(),
        1_000,
      );
      insertRun.run(
        siteId,
        "failed",
        "old failure",
        new Date(now - 120 * 24 * 60 * 60 * 1000).toISOString(),
        new Date(now - 120 * 24 * 60 * 60 * 1000 + 1_000).toISOString(),
        1_000,
      );
      insertRun.run(
        siteId,
        "running",
        null,
        new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        null,
        null,
      );
    } finally {
      db.close();
    }

    const res = await fetch(`http://localhost:${env.serverPort}/`);
    const html = await res.text();

    assert.match(
      html,
      /30d<\/span><strong>1\/2<\/strong>/,
    );
    assert.match(
      html,
      /All<\/span><strong>50%<\/strong>/,
    );
  } finally {
    stopTestEnv(env);
  }
});
