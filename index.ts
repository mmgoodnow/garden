import express from "express";
import multer from "multer";
import {
  deleteRunsBySiteId,
  deleteScreenshotsByRunIds,
  deleteScriptsBySiteId,
  deleteSitesById,
  getLatestScreenshotForRun,
  getRunById,
  getScreenshotById,
  getSiteByDomain,
  getSiteById,
  getSiteIdByDomain,
  getLatestScriptForSite,
  initDb,
  insertScript,
  insertSite,
  listCaptchaTracesForRun,
  listRunEventsForRun,
  listRunsBySite,
  listRunsForSite,
  listScreenshotsForRuns,
  listSites,
  updateSite,
} from "./db.ts";
import { BUILD_INFO, PORT } from "./config.ts";
import { encryptSecret } from "./crypto.ts";
import { runHelper } from "./helper.ts";
import { parseScript } from "./script.ts";
import { runSite } from "./runner.ts";
import { startScheduler } from "./scheduler.ts";
import { subscribeRunEvents } from "./events.ts";
import {
  layout,
  renderNewSite,
  renderRunDetail,
  renderSiteDetail,
  renderSiteList,
} from "./templates.ts";

const cliArgs = process.argv.slice(2);
const firstArg = cliArgs[0];

if (firstArg === "--version") {
  const sha = BUILD_INFO?.sha ? BUILD_INFO.sha.slice(0, 7) : "unknown";
  const message = BUILD_INFO?.message ? ` - ${BUILD_INFO.message}` : "";
  console.log(`garden ${sha}${message}`);
  process.exit(0);
}

if (firstArg === "helper") {
  const code = await runHelper(cliArgs.slice(1));
  process.exit(code);
}

await initDb();

const app = express();
const upload = multer();
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "5mb" }));

app.get("/", async (_req, res) => {
  const sites = await listSites();
  res.status(200).type("html").send(renderSiteList(sites));
});

app.get("/sites/new", async (_req, res) => {
  res.status(200).type("html").send(renderNewSite());
});

app.post("/sites", upload.none(), async (req, res) => {
  const name = String(req.body.name ?? "").trim();
  const domain = String(req.body.domain ?? "").trim();
  if (!name || !domain) {
    res
      .status(400)
      .type("html")
      .send(layout("Error", `<section>Missing name or domain.</section>`));
    return;
  }
  const existing = await getSiteIdByDomain(domain);
  if (existing) {
    res
      .status(400)
      .type("html")
      .send(layout("Error", `<section>Domain already exists.</section>`));
    return;
  }
  const now = new Date().toISOString();
  const siteId = await insertSite({
    name,
    domain,
    enabled: 1,
    created_at: now,
    updated_at: now,
    last_run_at: null,
    last_success_at: null,
    last_status: null,
    last_error: null,
    username_enc: null,
    password_enc: null,
    cookies_enc: null,
  });

  res.redirect(303, siteId ? `/sites/${encodeURIComponent(domain)}` : "/");
});

app.get("/sites/:domain", async (req, res) => {
  const domainParam = String(req.params.domain ?? "").trim();
  if (!domainParam) {
    res
      .status(404)
      .type("html")
      .send(layout("Not Found", `<section>Site not found.</section>`));
    return;
  }

  const site = await getSiteByDomain(domainParam);

  if (!site) {
    const numericId = Number(domainParam);
    if (Number.isFinite(numericId)) {
      const fallback = await getSiteById(numericId);
      if (fallback) {
        res.redirect(303, `/sites/${encodeURIComponent(fallback.domain)}`);
        return;
      }
    }
    res
      .status(404)
      .type("html")
      .send(layout("Not Found", `<section>Site not found.</section>`));
    return;
  }

  const script = await getLatestScriptForSite(site.id);
  const runs = await listRunsForSite(site.id, 10);
  const runIds = runs.map((run) => run.id);
  const screenshotsByRun: Record<number, { id: number; run_id: number; created_at: string }> =
    {};

  if (runIds.length > 0) {
    const screenshots = await listScreenshotsForRuns(runIds);
    for (const shot of screenshots) {
      if (!screenshotsByRun[shot.run_id]) {
        screenshotsByRun[shot.run_id] = shot;
      }
    }
  }

  const scheduleDays = Number.parseInt(
    process.env.SCHEDULE_EVERY_DAYS ?? "6",
    10,
  );
  const scheduleWindowDays = Math.max(scheduleDays, 1);
  const lastRunAt = site.last_run_at ? Date.parse(site.last_run_at) : NaN;
  const nextRunAt = Number.isNaN(lastRunAt)
    ? new Date().toISOString()
    : new Date(lastRunAt + scheduleWindowDays * 24 * 60 * 60 * 1000).toISOString();

  res
    .status(200)
    .type("html")
    .send(
      renderSiteDetail(
        site,
        script ?? null,
        runs,
        screenshotsByRun,
        nextRunAt,
      ),
    );
});

app.post("/sites/:domain/credentials", upload.none(), async (req, res) => {
  const domainParam = String(req.params.domain ?? "").trim();
  const username = String(req.body.username ?? "").trim();
  const password = String(req.body.password ?? "").trim();

  try {
    const siteId = await getSiteIdByDomain(domainParam);
    if (!siteId) {
      res
        .status(404)
        .type("html")
        .send(layout("Error", `<section>Site not found.</section>`));
      return;
    }
    const values: {
      username_enc?: string | null;
      password_enc?: string | null;
      updated_at: string;
    } = { updated_at: new Date().toISOString() };

    values.username_enc = username ? encryptSecret(username) : null;
    values.password_enc = password ? encryptSecret(password) : null;

    await updateSite(siteId, values);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res
      .status(400)
      .type("html")
      .send(layout("Error", `<section>${message}</section>`));
    return;
  }

  res.redirect(303, `/sites/${encodeURIComponent(domainParam)}`);
});

app.post("/sites/:domain/cookies", upload.none(), async (req, res) => {
  const domainParam = String(req.params.domain ?? "").trim();
  const cookies = String(req.body.cookies ?? "").trim();

  try {
    const siteId = await getSiteIdByDomain(domainParam);
    if (!siteId) {
      res
        .status(404)
        .type("html")
        .send(layout("Error", `<section>Site not found.</section>`));
      return;
    }

    await updateSite(siteId, {
      cookies_enc: cookies ? encryptSecret(cookies) : null,
      updated_at: new Date().toISOString(),
    });
    res.redirect(303, `/sites/${encodeURIComponent(domainParam)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res
      .status(500)
      .type("html")
      .send(layout("Error", `<section>${message}</section>`));
  }
});

app.post("/sites/:domain/script", upload.none(), async (req, res) => {
  const domainParam = String(req.params.domain ?? "").trim();
  const siteId = await getSiteIdByDomain(domainParam);
  if (!siteId) {
    res
      .status(404)
      .type("html")
      .send(layout("Error", `<section>Site not found.</section>`));
    return;
  }
  const scriptText = String(req.body.script ?? "").trim();
  if (!scriptText) {
    res
      .status(400)
      .type("html")
      .send(layout("Error", `<section>Script cannot be empty.</section>`));
    return;
  }
  let normalizedScript = scriptText;
  try {
    normalizedScript = JSON.stringify(JSON.parse(scriptText), null, 2);
    parseScript(normalizedScript);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res
      .status(400)
      .type("html")
      .send(layout("Error", `<section>${message}</section>`));
    return;
  }

  await insertScript(siteId, normalizedScript, new Date().toISOString());

  res.redirect(303, `/sites/${encodeURIComponent(domainParam)}`);
});

app.post("/sites/:domain/run", async (req, res) => {
  const domainParam = String(req.params.domain ?? "").trim();
  const siteId = await getSiteIdByDomain(domainParam);
  if (!siteId) {
    res
      .status(404)
      .type("html")
      .send(layout("Error", `<section>Site not found.</section>`));
    return;
  }
  runSite(siteId).catch((error) => {
    console.error("Run failed", error);
  });
  res.redirect(303, `/sites/${encodeURIComponent(domainParam)}`);
});

app.post("/sites/:domain/delete", async (req, res) => {
  const domainParam = String(req.params.domain ?? "").trim();
  const siteId = await getSiteIdByDomain(domainParam);
  if (!siteId) {
    res
      .status(404)
      .type("html")
      .send(layout("Not Found", `<section>Site not found.</section>`));
    return;
  }

  const runIds = await listRunsBySite(siteId);
  const ids = runIds.map((row) => row.id);

  if (ids.length) {
    await deleteScreenshotsByRunIds(ids);
  }

  await deleteRunsBySiteId(siteId);
  await deleteScriptsBySiteId(siteId);
  await deleteSitesById(siteId);

  res.redirect(303, "/");
});

app.get("/runs/:id", async (req, res) => {
  const runId = Number(req.params.id);
  const run = await getRunById(runId);
  if (!run) {
    res
      .status(404)
      .type("html")
      .send(layout("Not Found", `<section>Run not found.</section>`));
    return;
  }
  const screenshot = await getLatestScreenshotForRun(runId);
  const captchaTraces = await listCaptchaTracesForRun(runId);
  const runEvents = await listRunEventsForRun(runId);
  res
    .status(200)
    .type("html")
    .send(renderRunDetail(run, screenshot ?? null, captchaTraces, runEvents));
});

app.get("/api/runs/:id/events", async (req, res) => {
  const runId = Number(req.params.id);
  if (!Number.isFinite(runId)) {
    res.status(400).type("text").send("Run id required.");
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  subscribeRunEvents(runId, res);
});

app.get("/screenshots/:id", async (req, res) => {
  const shotId = Number(req.params.id);
  const shot = await getScreenshotById(shotId);
  if (!shot) {
    res.status(404).type("text").send("Not found");
    return;
  }
  res.status(200).type(shot.mime_type || "image/png").send(Buffer.from(shot.data));
});

app.post("/api/scripts", async (req, res) => {
  const payload = req.body ?? {};
  const siteId = Number(payload.siteId ?? 0);
  if (!siteId) {
    res.status(400).json({ error: "siteId required" });
    return;
  }
  const scriptText =
    typeof payload.script === "string"
      ? payload.script
      : JSON.stringify(payload.script, null, 2);
  try {
    parseScript(scriptText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ error: message });
    return;
  }

  await insertScript(siteId, scriptText, new Date().toISOString());

  res.status(200).json({ ok: true });
});

app.get("/api/scripts/wait", async (req, res) => {
  const siteId = Number(req.query.siteId ?? 0);
  const afterId = Number(req.query.afterId ?? 0);
  if (!siteId) {
    res.status(400).json({ error: "siteId required" });
    return;
  }

  const timeoutMs = 25000;
  const intervalMs = 1000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const latest = await getLatestScriptForSite(siteId);

    if (latest && latest.id > afterId) {
      res.status(200).json({
        id: latest.id,
        content: latest.content,
        created_at: latest.created_at,
      });
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  res.status(200).json({ ok: false });
});

app.listen(PORT, () => {
  console.log(`Garden server running on http://localhost:${PORT}`);
  const schedulerFlag = process.env.SCHEDULER_ENABLED?.toLowerCase();
  if (schedulerFlag !== "0" && schedulerFlag !== "false") {
    startScheduler();
  }
});
