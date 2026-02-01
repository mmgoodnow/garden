import { test, expect } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";

type Proc = ReturnType<typeof Bun.spawn>;

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MOCK_USERNAME = "test@example.com";
const MOCK_PASSWORD = "password123";

test(
  "runner end-to-end flow (mock site + curl-style API calls)",
  async () => {
    const appKey = randomBytes(32).toString("base64");
    const tempDir = mkdtempSync(join(tmpdir(), "garden-test-"));
    const dataDir = join(tempDir, "data");
    const dbPath = join(dataDir, "garden.db");
    const serverPort = await findFreePort();
    const mockPort = await findFreePort();

    let serverProc: Proc | undefined;
    let mockProc: Proc | undefined;

    try {
      serverProc = Bun.spawn({
        cmd: ["bun", "index.ts"],
        cwd: ROOT,
        env: {
          ...process.env,
          APP_ENC_KEY_BASE64: appKey,
          PORT: String(serverPort),
          DATA_DIR: dataDir,
          DB_PATH: dbPath,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      drain(serverProc.stdout);
      drain(serverProc.stderr);

      mockProc = Bun.spawn({
        cmd: ["bun", "testing/mock-site.ts"],
        cwd: ROOT,
        env: {
          ...process.env,
          MOCK_PORT: String(mockPort),
          MOCK_USERNAME,
          MOCK_PASSWORD,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      drain(mockProc.stdout);
      drain(mockProc.stderr);

      await waitForOk(`http://localhost:${serverPort}/`);
      await waitForOk(`http://localhost:${mockPort}/login`);

      const siteId = await createSite(serverPort);
      await uploadScript(serverPort, siteId, mockPort);
      await setCredentials(serverPort, siteId);
      await triggerRun(serverPort, siteId);

      const run = await waitForRun(dbPath, siteId, 30000);
      expect(run.status).toBe("success");
      expect(run.error).toBeNull();

      const shotSize = await waitForScreenshot(dbPath, run.id, 10000);
      expect(shotSize).toBeGreaterThan(0);
    } finally {
      try {
        serverProc?.kill();
      } catch {
        // ignore cleanup errors
      }
      try {
        mockProc?.kill();
      } catch {
        // ignore cleanup errors
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  },
  60000,
);

async function createSite(port: number) {
  const form = new FormData();
  form.set("name", "Mock Site");
  form.set("domain", "localhost");
  const res = await fetch(`http://localhost:${port}/sites`, {
    method: "POST",
    body: form,
    redirect: "manual",
  });
  expect(res.status).toBe(303);
  const location = res.headers.get("location");
  expect(location).toBeTruthy();
  const siteId = Number(location?.split("/").pop() ?? 0);
  expect(Number.isFinite(siteId)).toBe(true);
  return siteId;
}

async function uploadScript(port: number, siteId: number, mockPort: number) {
  const script = {
    meta: {
      source: "mock-site-test",
      version: 1,
      recordedAt: new Date().toISOString(),
    },
    steps: [
      { type: "goto", url: `http://localhost:${mockPort}/login` },
      {
        type: "fill",
        locator: "page.getByLabel('Username')",
        value: "{{username}}",
      },
      {
        type: "fill",
        locator: "page.getByLabel('Password')",
        value: "{{password}}",
      },
      {
        type: "click",
        locator: "page.getByRole('button', { name: 'Sign in' })",
      },
      { type: "goto", url: `http://localhost:${mockPort}/dashboard` },
    ],
    secrets: [
      { placeholder: "{{username}}", kind: "username" },
      { placeholder: "{{password}}", kind: "password" },
    ],
  };

  const res = await fetch(`http://localhost:${port}/api/scripts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ siteId, script }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
}

async function setCredentials(port: number, siteId: number) {
  const form = new FormData();
  form.set("username", MOCK_USERNAME);
  form.set("password", MOCK_PASSWORD);
  const res = await fetch(`http://localhost:${port}/sites/${siteId}/credentials`, {
    method: "POST",
    body: form,
    redirect: "manual",
  });
  expect(res.status).toBe(303);
}

async function triggerRun(port: number, siteId: number) {
  const res = await fetch(`http://localhost:${port}/sites/${siteId}/run`, {
    method: "POST",
    redirect: "manual",
  });
  expect(res.status).toBe(303);
}

async function waitForOk(url: string, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.ok || res.status === 302 || res.status === 303) {
        return;
      }
    } catch {
      // retry
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForRun(dbPath: string, siteId: number, timeoutMs = 20000) {
  const db = new Database(dbPath);
  try {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const row = db
        .query(
          "select id, status, error from runs where site_id = ? order by id desc limit 1",
        )
        .get(siteId) as { id: number; status: string; error: string | null } | undefined;
      if (row && row.status !== "running") {
        return row;
      }
      await delay(250);
    }
  } finally {
    db.close();
  }
  throw new Error("Timed out waiting for run status");
}

async function waitForScreenshot(dbPath: string, runId: number, timeoutMs = 10000) {
  const db = new Database(dbPath);
  try {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const row = db
        .query(
          "select length(data) as size from screenshots where run_id = ? order by id desc limit 1",
        )
        .get(runId) as { size: number } | undefined;
      if (row?.size) {
        return row.size;
      }
      await delay(250);
    }
  } finally {
    db.close();
  }
  throw new Error("Timed out waiting for screenshot");
}

function drain(stream?: ReadableStream<Uint8Array> | null) {
  if (!stream) return;
  stream.pipeTo(new WritableStream({ write() {} })).catch(() => undefined);
}

async function findFreePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire port")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}
