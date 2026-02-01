# Plan

## Helper CLI (local)
- [x] Record Playwright codegen to JSON
- [x] Deduplicate consecutive identical clicks
- [x] Annotate captcha block with a step range
- [x] Redact typed values into placeholders
- [x] Auto-map secrets with fallback prompt
- [ ] Validate helper output against real login flow

## Backend (Bun + SQLite)
- [x] Define SQLite schema (sites, runs, scripts, screenshots)
- [x] Implement Kysely setup (init on startup)
- [x] Add API routes to create/update sites and upload scripts
- [x] Encrypt secrets at rest with env key
- [ ] Add migrations strategy (versioned schema)
- [x] Validate API routes with curl

## Runner (Playwright)
- [x] Build step runner (click/fill/goto/etc.)
- [x] Inject decrypted secrets at runtime
- [ ] Handle captcha step placeholder (manual or stub solver)
- [x] Capture screenshot after login and store metadata
- [x] Track runs + last success/failure
- [x] Validate runner against mock site

## Validation & Local Test Harness
- [x] Add a mock login site (simple form + session cookie) for repeatable tests
- [x] Document curl flow to create a site, upload script JSON, set credentials, run job
- [x] Verify runner works end-to-end with the mock site
- [ ] Note elevated permissions may be required to bind to ports in sandboxed environments

## UI (SSR)
- [x] Dashboard: sites list with last run status
- [x] Site detail: script summary, run history, screenshots
- [x] Create/edit site form
- [x] “Run now” button + status feedback
- [ ] Manual UI smoke test (create site, upload script, run)

## Ops
- [ ] Dockerfile + compose for NAS
- [ ] Volumes for SQLite + screenshots
- [ ] Cron or scheduler for monthly runs
- [ ] Logging + basic retry policy
