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
  path: string;
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
        color-scheme: light;
        --bg: #f6f4f1;
        --panel: #ffffff;
        --ink: #1b1b1b;
        --muted: #6b6b6b;
        --accent: #1f7a5c;
        --border: #e1ddd6;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--ink);
        font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
      }
      header {
        padding: 24px 32px;
        border-bottom: 1px solid var(--border);
        background: var(--panel);
      }
      header h1 {
        margin: 0;
        font-size: 22px;
      }
      main {
        padding: 24px 32px 48px;
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      nav a {
        color: var(--accent);
        text-decoration: none;
        margin-right: 12px;
      }
      section {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 12px;
        padding: 16px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        text-align: left;
        padding: 8px 6px;
        border-bottom: 1px solid var(--border);
      }
      th { color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; }
      .muted { color: var(--muted); }
      .row {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
      }
      .row > section {
        flex: 1 1 320px;
      }
      label { display: block; font-size: 12px; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
      input, textarea, button, select {
        width: 100%;
        padding: 8px 10px;
        font-size: 14px;
        border-radius: 8px;
        border: 1px solid var(--border);
        font-family: inherit;
      }
      button {
        background: var(--accent);
        color: white;
        border: none;
        cursor: pointer;
      }
      button.secondary {
        background: transparent;
        color: var(--accent);
        border: 1px solid var(--accent);
      }
      pre {
        white-space: pre-wrap;
        background: #faf8f5;
        border: 1px solid var(--border);
        padding: 12px;
        border-radius: 8px;
        max-height: 320px;
        overflow: auto;
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
    `<section>
      <h2>${escapeHtml(site.name)}</h2>
      <p class="muted">${escapeHtml(site.domain)}</p>
      <form method="post" action="/sites/${site.id}/run">
        <button type="submit">Run Now</button>
      </form>
    </section>

    <div class="row">
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
      <section>
        <h3>Script</h3>
        <form method="post" action="/sites/${site.id}/script">
          <label>Recorded JSON</label>
          <textarea name="script" rows="12">${
            script ? escapeHtml(script.content) : ""
          }</textarea>
          <button type="submit">Save Script</button>
        </form>
      </section>
    </div>

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
    </div>`,
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
