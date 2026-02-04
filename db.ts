import { DatabaseSync } from "node:sqlite";
import { DB_PATH, DATA_DIR } from "./config.ts";
import { ensureDir } from "./util.ts";

export type SiteRow = {
  id: number;
  name: string;
  domain: string;
  enabled: number;
  username_enc: string | null;
  password_enc: string | null;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  last_success_at: string | null;
  last_status: string | null;
  last_error: string | null;
};

export type ScriptRow = {
  id: number;
  site_id: number;
  content: string;
  created_at: string;
};

export type RunRow = {
  id: number;
  site_id: number;
  status: string;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
};

export type ScreenshotRow = {
  id: number;
  run_id: number;
  data: Uint8Array;
  mime_type: string;
  created_at: string;
};

export type CaptchaTraceRow = {
  id: number;
  run_id: number;
  attempt: number;
  sequence: number;
  model: string;
  prompt: string;
  response: string | null;
  error: string | null;
  created_at: string;
};

export type RunEventRow = {
  id: number;
  run_id: number;
  type: string;
  payload: string;
  created_at: string;
};

export const sqlite = createSqlite();

function createSqlite() {
  ensureDir(DATA_DIR);
  return new DatabaseSync(DB_PATH);
}

export function closeDb() {
  sqlite.close();
}

export async function initDb() {
  sqlite.exec("PRAGMA journal_mode=WAL;");
  sqlite.exec("PRAGMA busy_timeout=5000;");
  sqlite.exec(`
    create table if not exists sites (
      id integer primary key autoincrement,
      name text not null,
      domain text not null,
      enabled integer not null default 1,
      username_enc text,
      password_enc text,
      created_at text not null,
      updated_at text not null,
      last_run_at text,
      last_success_at text,
      last_status text,
      last_error text
    );
  `);

  sqlite.exec(`
    create table if not exists scripts (
      id integer primary key autoincrement,
      site_id integer not null,
      content text not null,
      created_at text not null
    );
  `);

  sqlite.exec(`
    create table if not exists runs (
      id integer primary key autoincrement,
      site_id integer not null,
      status text not null,
      error text,
      started_at text not null,
      finished_at text,
      duration_ms integer
    );
  `);

  sqlite.exec(`
    create table if not exists screenshots (
      id integer primary key autoincrement,
      run_id integer not null,
      data blob not null,
      mime_type text not null,
      created_at text not null
    );
  `);

  sqlite.exec(`
    create table if not exists captcha_traces (
      id integer primary key autoincrement,
      run_id integer not null,
      attempt integer not null,
      sequence integer not null,
      model text not null,
      prompt text not null,
      response text,
      error text,
      created_at text not null
    );
  `);

  sqlite.exec(`
    create table if not exists run_events (
      id integer primary key autoincrement,
      run_id integer not null,
      type text not null,
      payload text not null,
      created_at text not null
    );
  `);
}

export async function listSites() {
  return sqlite.prepare("select * from sites order by id").all() as SiteRow[];
}

export async function getSiteByDomain(domain: string) {
  return sqlite
    .prepare("select * from sites where domain = ?")
    .get(domain) as SiteRow | undefined;
}

export async function getSiteById(siteId: number) {
  return sqlite
    .prepare("select * from sites where id = ?")
    .get(siteId) as SiteRow | undefined;
}

export async function getSiteIdByDomain(domain: string) {
  const row = sqlite
    .prepare("select id from sites where domain = ?")
    .get(domain) as { id: number } | undefined;
  return row?.id ?? null;
}

export async function insertSite(values: Omit<SiteRow, "id">) {
  const result = sqlite
    .prepare(
      `insert into sites
      (name, domain, enabled, username_enc, password_enc, created_at, updated_at, last_run_at, last_success_at, last_status, last_error)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      values.name,
      values.domain,
      values.enabled,
      values.username_enc,
      values.password_enc,
      values.created_at,
      values.updated_at,
      values.last_run_at,
      values.last_success_at,
      values.last_status,
      values.last_error,
    );
  return Number(result.lastInsertRowid);
}

export async function updateSite(siteId: number, values: Partial<SiteRow>) {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (key === "id") continue;
    sets.push(`${key} = ?`);
    params.push(value);
  }
  if (!sets.length) return;
  params.push(siteId);
  sqlite.prepare(`update sites set ${sets.join(", ")} where id = ?`).run(...params);
}

export async function getLatestScriptForSite(siteId: number) {
  return sqlite
    .prepare(
      "select * from scripts where site_id = ? order by created_at desc limit 1",
    )
    .get(siteId) as ScriptRow | undefined;
}

export async function listScriptsForSite(siteId: number) {
  return sqlite
    .prepare("select * from scripts where site_id = ? order by created_at desc")
    .all(siteId) as ScriptRow[];
}

export async function insertScript(siteId: number, content: string, createdAt: string) {
  const result = sqlite
    .prepare("insert into scripts (site_id, content, created_at) values (?, ?, ?)")
    .run(siteId, content, createdAt);
  return Number(result.lastInsertRowid);
}

export async function insertRun(values: Omit<RunRow, "id">) {
  const result = sqlite
    .prepare(
      `insert into runs
      (site_id, status, error, started_at, finished_at, duration_ms)
      values (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      values.site_id,
      values.status,
      values.error,
      values.started_at,
      values.finished_at,
      values.duration_ms,
    );
  return Number(result.lastInsertRowid);
}

export async function updateRun(runId: number, values: Partial<RunRow>) {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (key === "id") continue;
    sets.push(`${key} = ?`);
    params.push(value);
  }
  if (!sets.length) return;
  params.push(runId);
  sqlite.prepare(`update runs set ${sets.join(", ")} where id = ?`).run(...params);
}

export async function listRunsForSite(siteId: number, limit = 10) {
  return sqlite
    .prepare(
      "select * from runs where site_id = ? order by started_at desc limit ?",
    )
    .all(siteId, limit) as RunRow[];
}

export async function listRunsBySite(siteId: number) {
  return sqlite.prepare("select * from runs where site_id = ?").all(siteId) as RunRow[];
}

export async function getLatestRunId() {
  const row = sqlite
    .prepare("select id from runs order by id desc limit 1")
    .get() as { id: number } | undefined;
  return row?.id ?? null;
}

export async function getRunById(runId: number) {
  return sqlite
    .prepare("select * from runs where id = ?")
    .get(runId) as RunRow | undefined;
}

export async function listScreenshotsForRuns(runIds: number[]) {
  if (!runIds.length) return [];
  const placeholders = runIds.map(() => "?").join(", ");
  return sqlite
    .prepare(
      `select id, run_id, created_at from screenshots where run_id in (${placeholders}) order by created_at desc`,
    )
    .all(...runIds) as Array<{ id: number; run_id: number; created_at: string }>;
}

export async function getLatestScreenshotForRun(runId: number) {
  return sqlite
    .prepare(
      "select id, created_at from screenshots where run_id = ? order by created_at desc limit 1",
    )
    .get(runId) as { id: number; created_at: string } | undefined;
}

export async function getScreenshotById(shotId: number) {
  return sqlite
    .prepare("select * from screenshots where id = ?")
    .get(shotId) as ScreenshotRow | undefined;
}

export async function insertScreenshot(
  runId: number,
  data: Uint8Array,
  mimeType: string,
  createdAt: string,
) {
  const result = sqlite
    .prepare(
      "insert into screenshots (run_id, data, mime_type, created_at) values (?, ?, ?, ?)",
    )
    .run(runId, data, mimeType, createdAt);
  return Number(result.lastInsertRowid);
}

export async function listCaptchaTracesForRun(runId: number) {
  return sqlite
    .prepare("select * from captcha_traces where run_id = ? order by created_at asc")
    .all(runId) as CaptchaTraceRow[];
}

export async function insertCaptchaTrace(values: Omit<CaptchaTraceRow, "id">) {
  const result = sqlite
    .prepare(
      `insert into captcha_traces
      (run_id, attempt, sequence, model, prompt, response, error, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      values.run_id,
      values.attempt,
      values.sequence,
      values.model,
      values.prompt,
      values.response,
      values.error,
      values.created_at,
    );
  return Number(result.lastInsertRowid);
}

export async function listRunEventsForRun(runId: number) {
  return sqlite
    .prepare("select * from run_events where run_id = ? order by created_at asc")
    .all(runId) as RunEventRow[];
}

export async function insertRunEvent(values: Omit<RunEventRow, "id">) {
  const result = sqlite
    .prepare(
      "insert into run_events (run_id, type, payload, created_at) values (?, ?, ?, ?)",
    )
    .run(values.run_id, values.type, values.payload, values.created_at);
  return Number(result.lastInsertRowid);
}

export async function deleteScreenshotsByRunIds(runIds: number[]) {
  if (!runIds.length) return;
  const placeholders = runIds.map(() => "?").join(", ");
  sqlite
    .prepare(`delete from screenshots where run_id in (${placeholders})`)
    .run(...runIds);
}

export async function deleteRunsBySiteId(siteId: number) {
  sqlite.prepare("delete from runs where site_id = ?").run(siteId);
}

export async function deleteScriptsBySiteId(siteId: number) {
  sqlite.prepare("delete from scripts where site_id = ?").run(siteId);
}

export async function deleteSitesById(siteId: number) {
  sqlite.prepare("delete from sites where id = ?").run(siteId);
}

export async function deleteAllData() {
  sqlite.exec("delete from screenshots;");
  sqlite.exec("delete from runs;");
  sqlite.exec("delete from scripts;");
  sqlite.exec("delete from sites;");
}
