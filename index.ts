import { initDb, db } from "./db";
import { PORT } from "./config";
import { encryptSecret } from "./crypto";
import { parseScript } from "./script";
import { runSite } from "./runner";
import { startScheduler } from "./scheduler";
import { subscribeRunEvents } from "./events";
import {
  layout,
  renderNewSite,
  renderRunDetail,
  renderSiteDetail,
  renderSiteList,
} from "./templates";

await initDb();

Bun.serve({
  port: PORT,
  routes: {
    "/": {
      GET: async () => {
        const sites = await db.selectFrom("sites").selectAll().orderBy("id").execute();
        return htmlResponse(renderSiteList(sites));
      },
    },
    "/sites/new": {
      GET: async () => htmlResponse(renderNewSite()),
    },
    "/sites": {
      POST: async (req) => {
        const form = await req.formData();
        const name = String(form.get("name") ?? "").trim();
        const domain = String(form.get("domain") ?? "").trim();
        if (!name || !domain) {
          return htmlResponse(layout("Error", `<section>Missing name or domain.</section>`), 400);
        }
        const now = new Date().toISOString();
        const result = await db
          .insertInto("sites")
          .values({
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
          })
          .executeTakeFirst();

        const siteId = Number(result.insertId ?? 0);
        return redirect(siteId ? `/sites/${siteId}` : "/");
      },
    },
    "/sites/:id": {
      GET: async (req) => {
        const siteId = Number(req.params.id);
        if (!Number.isFinite(siteId)) {
          return htmlResponse(layout("Not Found", `<section>Site not found.</section>`), 404);
        }

        const site = await db
          .selectFrom("sites")
          .selectAll()
          .where("id", "=", siteId)
          .executeTakeFirst();

        if (!site) {
          return htmlResponse(layout("Not Found", `<section>Site not found.</section>`), 404);
        }

        const script = await db
          .selectFrom("scripts")
          .selectAll()
          .where("site_id", "=", siteId)
          .orderBy("created_at", "desc")
          .limit(1)
          .executeTakeFirst();

        const runs = await db
          .selectFrom("runs")
          .selectAll()
          .where("site_id", "=", siteId)
          .orderBy("started_at", "desc")
          .limit(10)
          .execute();

        const runIds = runs.map((run) => run.id);
        const screenshotsByRun: Record<number, { id: number; run_id: number; created_at: string }> = {};

        if (runIds.length > 0) {
          const screenshots = await db
            .selectFrom("screenshots")
            .select(["id", "run_id", "created_at"])
            .where("run_id", "in", runIds)
            .orderBy("created_at", "desc")
            .execute();

          for (const shot of screenshots) {
            if (!screenshotsByRun[shot.run_id]) {
              screenshotsByRun[shot.run_id] = shot;
            }
          }
        }

        return htmlResponse(
          renderSiteDetail(site, script ?? null, runs, screenshotsByRun),
        );
      },
    },
    "/sites/:id/credentials": {
      POST: async (req) => {
        const siteId = Number(req.params.id);
        const form = await req.formData();
        const username = String(form.get("username") ?? "").trim();
        const password = String(form.get("password") ?? "").trim();

        try {
          const values: {
            username_enc?: string | null;
            password_enc?: string | null;
            updated_at: string;
          } = { updated_at: new Date().toISOString() };

          values.username_enc = username ? encryptSecret(username) : null;
          values.password_enc = password ? encryptSecret(password) : null;

          await db.updateTable("sites").set(values).where("id", "=", siteId).execute();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return htmlResponse(layout("Error", `<section>${message}</section>`), 400);
        }

        return redirect(`/sites/${siteId}`);
      },
    },
    "/sites/:id/script": {
      POST: async (req) => {
        const siteId = Number(req.params.id);
        const form = await req.formData();
        const scriptText = String(form.get("script") ?? "").trim();
        if (!scriptText) {
          return htmlResponse(layout("Error", `<section>Script cannot be empty.</section>`), 400);
        }
        try {
          parseScript(scriptText);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return htmlResponse(layout("Error", `<section>${message}</section>`), 400);
        }

        await db
          .insertInto("scripts")
          .values({
            site_id: siteId,
            content: scriptText,
            created_at: new Date().toISOString(),
          })
          .execute();

        return redirect(`/sites/${siteId}`);
      },
    },
    "/sites/:id/run": {
      POST: async (req) => {
        const siteId = Number(req.params.id);
        runSite(siteId).catch((error) => {
          console.error("Run failed", error);
        });
        return redirect(`/sites/${siteId}`);
      },
    },
    "/sites/:id/delete": {
      POST: async (req) => {
        const siteId = Number(req.params.id);
        if (!Number.isFinite(siteId)) {
          return htmlResponse(layout("Not Found", `<section>Site not found.</section>`), 404);
        }

        const runIds = await db
          .selectFrom("runs")
          .select("id")
          .where("site_id", "=", siteId)
          .execute();
        const ids = runIds.map((row) => row.id);

        if (ids.length) {
          await db.deleteFrom("screenshots").where("run_id", "in", ids).execute();
        }

        await db.deleteFrom("runs").where("site_id", "=", siteId).execute();
        await db.deleteFrom("scripts").where("site_id", "=", siteId).execute();
        await db.deleteFrom("sites").where("id", "=", siteId).execute();

        return redirect("/");
      },
    },
    "/runs/:id": {
      GET: async (req) => {
        const runId = Number(req.params.id);
        const run = await db
          .selectFrom("runs")
          .selectAll()
          .where("id", "=", runId)
          .executeTakeFirst();
        if (!run) {
          return htmlResponse(layout("Not Found", `<section>Run not found.</section>`), 404);
        }
        const screenshot = await db
          .selectFrom("screenshots")
          .select(["id", "created_at"])
          .where("run_id", "=", runId)
          .orderBy("created_at", "desc")
          .limit(1)
          .executeTakeFirst();
        const captchaTraces = await db
          .selectFrom("captcha_traces")
          .selectAll()
          .where("run_id", "=", runId)
          .orderBy("created_at", "asc")
          .execute();
        return htmlResponse(
          renderRunDetail(run, screenshot ?? null, captchaTraces),
        );
      },
    },
    "/api/runs/:id/events": {
      GET: async (req) => {
        const runId = Number(req.params.id);
        if (!Number.isFinite(runId)) {
          return new Response("Run id required.", { status: 400 });
        }
        const stream = subscribeRunEvents(runId);
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
    "/screenshots/:id": {
      GET: async (req) => {
        const shotId = Number(req.params.id);
        const shot = await db
          .selectFrom("screenshots")
          .selectAll()
          .where("id", "=", shotId)
          .executeTakeFirst();
        if (!shot) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(shot.data, {
          headers: { "Content-Type": shot.mime_type || "image/png" },
        });
      },
    },
    "/api/scripts": {
      POST: async (req) => {
        const payload = await req.json();
        const siteId = Number(payload.siteId ?? 0);
        if (!siteId) {
          return new Response(JSON.stringify({ error: "siteId required" }), {
            status: 400,
          });
        }
        const scriptText =
          typeof payload.script === "string"
            ? payload.script
            : JSON.stringify(payload.script, null, 2);
        try {
          parseScript(scriptText);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return new Response(JSON.stringify({ error: message }), { status: 400 });
        }

        await db
          .insertInto("scripts")
          .values({
            site_id: siteId,
            content: scriptText,
            created_at: new Date().toISOString(),
          })
          .execute();

        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    },
    "/api/scripts/wait": {
      GET: async (req) => {
        const url = new URL(req.url);
        const siteId = Number(url.searchParams.get("siteId") ?? 0);
        const afterId = Number(url.searchParams.get("afterId") ?? 0);
        if (!siteId) {
          return new Response(JSON.stringify({ error: "siteId required" }), {
            status: 400,
          });
        }

        const timeoutMs = 25000;
        const intervalMs = 1000;
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
          const latest = await db
            .selectFrom("scripts")
            .selectAll()
            .where("site_id", "=", siteId)
            .orderBy("created_at", "desc")
            .limit(1)
            .executeTakeFirst();

          if (latest && latest.id > afterId) {
            return new Response(
              JSON.stringify({
                id: latest.id,
                content: latest.content,
                created_at: latest.created_at,
              }),
              { status: 200 },
            );
          }

          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }

        return new Response(JSON.stringify({ ok: false }), { status: 200 });
      },
    },
  },
});

console.log(`Garden server running on http://localhost:${PORT}`);
const schedulerFlag = process.env.SCHEDULER_ENABLED?.toLowerCase();
if (schedulerFlag !== "0" && schedulerFlag !== "false") {
  startScheduler();
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function redirect(path: string) {
  return new Response(null, {
    status: 303,
    headers: { Location: path },
  });
}
