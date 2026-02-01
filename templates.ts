import { escapeHtml } from "./util";

type SiteRow = {
  id: number;
  name: string;
  domain: string;
  enabled: number;
  last_status: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
};

type RunRow = {
  id: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  error: string | null;
};

type ScriptRow = {
  id: number;
  content: string;
  created_at: string;
};

type ScreenshotRow = {
  id: number;
  created_at: string;
};

export function layout(title: string, body: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #f6f4f1;
        --panel: #ffffff;
        --panel-2: #faf8f5;
        --ink: #1b1b1b;
        --muted: #6b6b6b;
        --accent: #1f7a5c;
        --accent-ink: #ffffff;
        --border: #e1ddd6;
        --shadow: 0 10px 24px rgba(20, 15, 10, 0.08);
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0f1210;
          --panel: #171b18;
          --panel-2: #121613;
          --ink: #f3f2ef;
          --muted: #a4a8a2;
          --accent: #4bb891;
          --accent-ink: #0d120f;
          --border: #2a2f2b;
          --shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: radial-gradient(1200px 600px at 20% -10%, rgba(31, 122, 92, 0.18), transparent 60%),
          var(--bg);
        color: var(--ink);
        font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
      }
      header {
        padding: 20px 28px;
        border-bottom: 1px solid var(--border);
        background: var(--panel);
        position: sticky;
        top: 0;
        z-index: 10;
      }
      header h1 {
        margin: 0;
        font-size: 22px;
        letter-spacing: 0.2px;
      }
      main {
        padding: 28px 28px 56px;
        display: flex;
        flex-direction: column;
        gap: 20px;
        max-width: 1120px;
        margin: 0 auto;
      }
      nav a {
        color: var(--accent);
        text-decoration: none;
        margin-right: 12px;
        font-weight: 600;
      }
      section {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 18px;
        box-shadow: var(--shadow);
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        text-align: left;
        padding: 10px 8px;
        border-bottom: 1px solid var(--border);
      }
      th { color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; }
      tr:last-child td { border-bottom: none; }
      .muted { color: var(--muted); }
      .row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 16px;
      }
      label { display: block; font-size: 12px; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
      input, textarea, button, select {
        width: 100%;
        padding: 8px 10px;
        font-size: 14px;
        border-radius: 8px;
        border: 1px solid var(--border);
        font-family: inherit;
        background: var(--panel-2);
        color: var(--ink);
      }
      input:focus, textarea:focus, select:focus {
        outline: 2px solid color-mix(in srgb, var(--accent), transparent 60%);
        border-color: var(--accent);
      }
      button {
        background: var(--accent);
        color: var(--accent-ink);
        border: none;
        cursor: pointer;
        padding: 10px 12px;
        font-weight: 600;
        transition: transform 120ms ease, box-shadow 120ms ease;
      }
      button:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(0,0,0,0.12); }
      button.secondary {
        background: transparent;
        color: var(--accent);
        border: 1px solid var(--accent);
      }
      form {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      form > label {
        margin-top: 6px;
      }
      form > label:first-child {
        margin-top: 0;
      }
      pre {
        white-space: pre-wrap;
        background: var(--panel-2);
        border: 1px solid var(--border);
        padding: 12px;
        border-radius: 8px;
        max-height: 320px;
        overflow: auto;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      @media (max-width: 720px) {
        header { padding: 16px 18px; }
        main { padding: 20px 18px 44px; }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Garden</h1>
      <nav>
        <a href="/">Sites</a>
        <a href="/sites/new">New Site</a>
      </nav>
    </header>
    <main>
      ${body}
    </main>
  </body>
</html>`;
}

export function renderSiteList(sites: SiteRow[]) {
  const rows = sites
    .map(
      (site) => `<tr>
        <td><a href="/sites/${site.id}">${escapeHtml(site.name)}</a></td>
        <td>${escapeHtml(site.domain)}</td>
        <td>${site.enabled ? "Enabled" : "Disabled"}</td>
        <td>${escapeHtml(site.last_status ?? "never")}</td>
        <td>${escapeHtml(site.last_run_at ?? "-")}</td>
        <td>${escapeHtml(site.last_success_at ?? "-")}</td>
      </tr>`,
    )
    .join("");

  return layout(
    "Sites",
    `<section>
      <h2>Sites</h2>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Domain</th>
            <th>Status</th>
            <th>Last Run</th>
            <th>Last Run At</th>
            <th>Last Success</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="6" class="muted">No sites yet.</td></tr>`}
        </tbody>
      </table>
    </section>`,
  );
}

export function renderNewSite() {
  return layout(
    "New Site",
    `<section>
      <h2>Create Site</h2>
      <form method="post" action="/sites">
        <label>Name</label>
        <input name="name" required />
        <label>Domain</label>
        <input name="domain" placeholder="example.com" required />
        <button type="submit">Create</button>
      </form>
    </section>`,
  );
}

export function renderSiteDetail(
  site: SiteRow & {
    id: number;
    username_enc: string | null;
    password_enc: string | null;
  },
  script: ScriptRow | null,
  runs: RunRow[],
  screenshots: ScreenshotRow[],
) {
  const scriptId = script?.id ?? 0;
  const scriptContent = script ? escapeHtml(script.content) : "";
  const domain = site.domain.trim();
  const hasScheme = /^https?:\/\//i.test(domain);
  const siteUrl = hasScheme ? domain : `https://${domain}`;
  const runRows = runs
    .map(
      (run) => `<tr>
        <td><a href="/runs/${run.id}">#${run.id}</a></td>
        <td>${escapeHtml(run.status)}</td>
        <td>${escapeHtml(run.started_at)}</td>
        <td>${escapeHtml(run.finished_at ?? "-")}</td>
        <td>${escapeHtml(run.error ?? "-")}</td>
      </tr>`,
    )
    .join("");

  const screenshotRows = screenshots
    .map(
      (shot) => `<tr>
        <td><a href="/screenshots/${shot.id}">view</a></td>
        <td>${escapeHtml(shot.created_at)}</td>
      </tr>`,
    )
    .join("");

  return layout(
    site.name,
    `<div class="row">
      <section>
        <h2>${escapeHtml(site.name)}</h2>
        <p class="muted">${escapeHtml(site.domain)}</p>
        <div class="actions">
          <form method="post" action="/sites/${site.id}/run">
            <button type="submit">Run Now</button>
          </form>
          <form method="post" action="/sites/${site.id}/delete" onsubmit="return confirm('Delete this site and all related data?');">
            <button type="submit" class="secondary">Delete Site</button>
          </form>
        </div>
      </section>
      <section>
        <h3>Credentials</h3>
        <form method="post" action="/sites/${site.id}/credentials">
          <label>Username</label>
          <input name="username" placeholder="user@example.com" />
          <label>Password</label>
          <input name="password" type="password" />
          <button type="submit">Update</button>
        </form>
        <p class="muted">
          Stored: ${
            site.username_enc && site.password_enc ? "yes" : "no"
          }
        </p>
      </section>
    </div>

    <section>
      <h3>Script</h3>
      <div class="muted" style="margin-bottom: 8px;">
        <button type="button" class="secondary" id="copy-cli" data-site-id="${site.id}">
          Copy CLI command
        </button>
        <span id="cli-status" class="muted" style="margin-left: 8px;"></span>
      </div>
      <form method="post" action="/sites/${site.id}/script">
        <label>Recorded JSON</label>
        <textarea name="script" rows="12" data-script-id="${scriptId}">${scriptContent}</textarea>
        <button type="submit">Save Script</button>
      </form>
    </section>

    <div class="row">
      <section>
        <h3>Runs</h3>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Status</th>
              <th>Started</th>
              <th>Finished</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            ${runRows || `<tr><td colspan="5" class="muted">No runs yet.</td></tr>`}
          </tbody>
        </table>
      </section>
      <section>
        <h3>Screenshots</h3>
        <table>
          <thead>
            <tr>
              <th>Preview</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            ${
              screenshotRows ||
              `<tr><td colspan="2" class="muted">No screenshots yet.</td></tr>`
            }
          </tbody>
        </table>
      </section>
    </div>

    <script>
      (() => {
        const copyBtn = document.getElementById("copy-cli");
        const statusEl = document.getElementById("cli-status");
        const textarea = document.querySelector("textarea[name='script']");
        if (!copyBtn || !statusEl || !textarea) return;

        const siteId = copyBtn.getAttribute("data-site-id");
        const origin = window.location.origin;
        const siteUrl = ${JSON.stringify(siteUrl)};
        const cmd =
          "bun run /Users/mmgoodnow/src/garden/helper.ts record " +
          siteUrl +
          " --upload-to " +
          origin +
          " --site-id " +
          siteId;

        async function waitForScript() {
          const afterId = Number(textarea.dataset.scriptId || "0");
          statusEl.textContent = "Waiting for upload...";
          try {
            const res = await fetch(
              "/api/scripts/wait?siteId=" + siteId + "&afterId=" + afterId,
            );
            if (!res.ok) {
              statusEl.textContent = "Upload wait failed.";
              return;
            }
            const payload = await res.json();
            if (payload && payload.content) {
              textarea.value = payload.content;
              textarea.dataset.scriptId = String(payload.id || afterId);
              statusEl.textContent = "Script received.";
              return;
            }
            statusEl.textContent = "No script uploaded yet.";
          } catch (err) {
            statusEl.textContent = "Upload wait failed.";
          }
        }

        copyBtn.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(cmd);
            statusEl.textContent = "Copied. Run it locally.";
          } catch (err) {
            window.prompt("Copy CLI command:", cmd);
            statusEl.textContent = "Copy command to run locally.";
          }
          void waitForScript();
        });
      })();
    </script>`,
  );
}

export function renderRunDetail(run: RunRow) {
  return layout(
    `Run #${run.id}`,
    `<section>
      <h2>Run #${run.id}</h2>
      <p>Status: ${escapeHtml(run.status)}</p>
      <p>Started: ${escapeHtml(run.started_at)}</p>
      <p>Finished: ${escapeHtml(run.finished_at ?? "-")}</p>
      <p>Error: ${escapeHtml(run.error ?? "-")}</p>
    </section>`,
  );
}
