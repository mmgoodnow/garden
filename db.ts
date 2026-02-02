import { Database as BunSqliteDatabase } from "bun:sqlite";
import { Kysely, Generated } from "kysely";
import { BunSqliteDialect } from "@meck93/kysely-bun-sqlite";
import { DB_PATH, DATA_DIR } from "./config";
import { ensureDir } from "./util";

export type SitesTable = {
  id: Generated<number>;
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

export type ScriptsTable = {
  id: Generated<number>;
  site_id: number;
  content: string;
  created_at: string;
};

export type RunsTable = {
  id: Generated<number>;
  site_id: number;
  status: string;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
};

export type ScreenshotsTable = {
  id: Generated<number>;
  run_id: number;
  data: Uint8Array;
  mime_type: string;
  created_at: string;
};

export type CaptchaTracesTable = {
  id: Generated<number>;
  run_id: number;
  attempt: number;
  sequence: number;
  model: string;
  prompt: string;
  response: string | null;
  error: string | null;
  created_at: string;
};

export type DB = {
  sites: SitesTable;
  scripts: ScriptsTable;
  runs: RunsTable;
  screenshots: ScreenshotsTable;
  captcha_traces: CaptchaTracesTable;
};

export const sqlite = createSqlite();
export const db = new Kysely<DB>({
  dialect: new BunSqliteDialect({
    database: sqlite,
  }),
});

function createSqlite() {
  ensureDir(DATA_DIR);
  return new BunSqliteDatabase(DB_PATH);
}

export async function initDb() {
  await db.schema
    .createTable("sites")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("domain", "text", (col) => col.notNull())
    .addColumn("enabled", "integer", (col) => col.notNull().defaultTo(1))
    .addColumn("username_enc", "text")
    .addColumn("password_enc", "text")
    .addColumn("created_at", "text", (col) => col.notNull())
    .addColumn("updated_at", "text", (col) => col.notNull())
    .addColumn("last_run_at", "text")
    .addColumn("last_success_at", "text")
    .addColumn("last_status", "text")
    .addColumn("last_error", "text")
    .execute();

  await db.schema
    .createTable("scripts")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("site_id", "integer", (col) => col.notNull())
    .addColumn("content", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull())
    .execute();

  await db.schema
    .createTable("runs")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("site_id", "integer", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("error", "text")
    .addColumn("started_at", "text", (col) => col.notNull())
    .addColumn("finished_at", "text")
    .addColumn("duration_ms", "integer")
    .execute();

  await db.schema
    .createTable("screenshots")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("run_id", "integer", (col) => col.notNull())
    .addColumn("data", "blob", (col) => col.notNull())
    .addColumn("mime_type", "text", (col) => col.notNull())
    .addColumn("created_at", "text", (col) => col.notNull())
    .execute();

  await db.schema
    .createTable("captcha_traces")
    .ifNotExists()
    .addColumn("id", "integer", (col) => col.primaryKey().autoIncrement())
    .addColumn("run_id", "integer", (col) => col.notNull())
    .addColumn("attempt", "integer", (col) => col.notNull())
    .addColumn("sequence", "integer", (col) => col.notNull())
    .addColumn("model", "text", (col) => col.notNull())
    .addColumn("prompt", "text", (col) => col.notNull())
    .addColumn("response", "text")
    .addColumn("error", "text")
    .addColumn("created_at", "text", (col) => col.notNull())
    .execute();
}
