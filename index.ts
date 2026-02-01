import { initDb, db } from "./db";
import { PORT } from "./config";
import { encryptSecret } from "./crypto";
import { parseScript } from "./script";
import { runSite } from "./runner";
import { startScheduler } from "./scheduler";
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

        const screenshots = await db
          .selectFrom("screenshots")
          .innerJoin("runs", "runs.id", "screenshots.run_id")
          .select([
            "screenshots.id as id",
            "screenshots.created_at as created_at",
          ])
          .where("runs.site_id", "=", siteId)
          .orderBy("screenshots.created_at", "desc")
          .limit(10)
          .execute();

        return htmlResponse(renderSiteDetail(site, script ?? null, runs, screenshots));
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
        return htmlResponse(renderRunDetail(run));
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
  },
});

console.log(`Garden server running on http://localhost:${PORT}`);
if (process.env.SCHEDULER_ENABLED === "1") {
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
