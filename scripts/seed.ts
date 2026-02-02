import { initDb, db } from "../db";
import { encryptSecret } from "../crypto";

type SiteInput = {
  name: string;
  domain: string;
  status: "success" | "failed";
  error: string | null;
};

const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAf6dS5gAAAABJRU5ErkJggg==";

await initDb();

const args = process.argv.slice(2);
const shouldReset = args.includes("--reset");

if (shouldReset) {
  await db.deleteFrom("screenshots").execute();
  await db.deleteFrom("runs").execute();
  await db.deleteFrom("scripts").execute();
  await db.deleteFrom("sites").execute();
}

const now = new Date().toISOString();
const credentials = buildCredentials();

const sites: SiteInput[] = [
  {
    name: "Mock Site",
    domain: "localhost:4001",
    status: "success",
    error: null,
  },
  {
    name: "Billing Portal",
    domain: "billing.example.com",
    status: "failed",
    error: "login: unauthorized",
  },
];

for (const site of sites) {
  const result = await db
    .insertInto("sites")
    .values({
      name: site.name,
      domain: site.domain,
      enabled: 1,
      created_at: now,
      updated_at: now,
      last_run_at: now,
      last_success_at: site.status === "success" ? now : null,
      last_status: site.status,
      last_error: site.error,
      username_enc: credentials.username_enc,
      password_enc: credentials.password_enc,
    })
    .executeTakeFirst();

  const siteId = Number(result.insertId ?? 0);
  if (!siteId) continue;

  const script = buildSampleScript(site.domain);
  await db
    .insertInto("scripts")
    .values({
      site_id: siteId,
      content: JSON.stringify(script, null, 2),
      created_at: now,
    })
    .execute();

  const runResult = await db
    .insertInto("runs")
    .values({
      site_id: siteId,
      status: site.status,
      error: site.error,
      started_at: now,
      finished_at: now,
      duration_ms: 3200,
    })
    .executeTakeFirst();

  const runId = Number(runResult.insertId ?? 0);
  if (!runId) continue;

  if (site.status === "success") {
    await db
      .insertInto("screenshots")
      .values({
        run_id: runId,
        data: Buffer.from(SAMPLE_PNG_BASE64, "base64"),
        mime_type: "image/png",
        created_at: now,
      })
      .execute();
  }
}

console.log(
  `Seeded ${sites.length} site(s)${shouldReset ? " (after reset)" : ""}.`,
);

function buildCredentials() {
  try {
    return {
      username_enc: encryptSecret("user@example.com"),
      password_enc: encryptSecret("password123"),
    };
  } catch {
    return { username_enc: null, password_enc: null };
  }
}

function buildSampleScript(domain: string) {
  const trimmed = domain.trim();
  const hasScheme = /^https?:\/\//i.test(trimmed);
  const base = hasScheme ? trimmed : `${defaultScheme(trimmed)}${trimmed}`;
  const baseUrl = base.replace(/\/$/, "");
  return {
    meta: {
      source: "seed",
      version: 1,
      recordedAt: new Date().toISOString(),
    },
    steps: [
      { type: "fill", locator: "page.getByLabel('Username')", value: "{{username}}" },
      { type: "fill", locator: "page.getByLabel('Password')", value: "{{password}}" },
      { type: "captcha", steps: [{ type: "click", locator: "#captcha" }] },
      { type: "click", locator: "page.getByRole('button', { name: 'Sign in' })" },
      { type: "goto", url: `${baseUrl}/dashboard` },
    ],
    secrets: [
      { placeholder: "{{username}}", kind: "username" },
      { placeholder: "{{password}}", kind: "password" },
    ],
  };
}

function defaultScheme(domain: string) {
  const lower = domain.toLowerCase();
  if (
    lower.startsWith("localhost") ||
    lower.startsWith("127.0.0.1") ||
    lower.startsWith("[::1]") ||
    lower.endsWith(".local")
  ) {
    return "http://";
  }
  return "https://";
}
