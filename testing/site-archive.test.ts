import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createSite, startTestEnv, stopTestEnv, triggerRun } from "./test-helpers.ts";

test("archiving a site moves it to archived sites and blocks runs", async () => {
  const env = await startTestEnv();

  try {
    const { siteId, siteDomain } = await createSite(
      env.serverPort,
      env.dbPath,
      "closed-site.local",
    );
    assert.ok(siteId > 0);

    const archiveRes = await fetch(
      `http://localhost:${env.serverPort}/sites/${encodeURIComponent(siteDomain)}/archive`,
      {
        method: "POST",
        redirect: "manual",
      },
    );
    assert.equal(archiveRes.status, 303);

    const db = new DatabaseSync(env.dbPath);
    try {
      const row = db
        .prepare("select archived, archived_at, enabled from sites where id = ?")
        .get(siteId) as
        | { archived: number; archived_at: string | null; enabled: number }
        | undefined;
      assert.equal(row?.archived, 1);
      assert.equal(row?.enabled, 0);
      assert.ok(row?.archived_at);
    } finally {
      db.close();
    }

    const indexRes = await fetch(`http://localhost:${env.serverPort}/`);
    const html = await indexRes.text();
    assert.match(html, /Active Sites/);
    assert.match(html, /No active sites\./);
    assert.match(html, /Archived Sites/);
    assert.match(html, /closed-site\.local/);
    assert.match(html, /Archived/);

    const detailRes = await fetch(
      `http://localhost:${env.serverPort}/sites/${encodeURIComponent(siteDomain)}`,
    );
    const detailHtml = await detailRes.text();
    assert.match(detailHtml, /Unarchive Site/);
    assert.doesNotMatch(detailHtml, /Run Now/);

    const runRes = await triggerRun(env.serverPort, siteDomain);
    assert.equal(runRes.status, 400);
    const runHtml = await runRes.text();
    assert.match(runHtml, /Archived sites cannot be run\./);
  } finally {
    stopTestEnv(env);
  }
});
