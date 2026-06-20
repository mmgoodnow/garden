import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("disabled sites cannot be run manually or through the runner", async () => {
  const env = await startTestEnv();

  try {
    const { siteId, siteDomain } = await createSite(
      env.serverPort,
      env.dbPath,
      "disabled-site.local",
    );
    assert.ok(siteId > 0);

    const db = new DatabaseSync(env.dbPath);
    try {
      db.prepare("update sites set enabled = 0 where id = ?").run(siteId);
    } finally {
      db.close();
    }

    const runRes = await triggerRun(env.serverPort, siteDomain);
    assert.equal(runRes.status, 400);
    const runHtml = await runRes.text();
    assert.match(runHtml, /Disabled sites cannot be run\./);

    const runnerRes = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        "import { runSite } from './runner.ts'; try { await runSite(Number(process.argv[1])); process.exit(1); } catch (error) { console.log(error instanceof Error ? error.message : String(error)); }",
        String(siteId),
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          APP_ENC_KEY_BASE64: env.appKey,
          DATA_DIR: env.dataDir,
          DB_PATH: env.dbPath,
        },
        encoding: "utf8",
      },
    );

    assert.equal(runnerRes.status, 0, runnerRes.stderr);
    assert.match(runnerRes.stdout, /Disabled sites cannot be run\./);

    const verifyDb = new DatabaseSync(env.dbPath);
    try {
      const row = verifyDb
        .prepare("select count(*) as count from runs where site_id = ?")
        .get(siteId) as { count: number };
      assert.equal(row.count, 0);
    } finally {
      verifyDb.close();
    }
  } finally {
    stopTestEnv(env);
  }
});
