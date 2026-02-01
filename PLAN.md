# Plan

## Helper CLI (local)
- [x] Record Playwright codegen to JSON
- [x] Deduplicate consecutive identical clicks
- [x] Annotate captcha block with a step range
- [x] Redact typed values into placeholders
- [x] Auto-map secrets with fallback prompt

## Backend (Bun + SQLite)
- [ ] Define SQLite schema (sites, runs, scripts, screenshots, secrets)
- [ ] Implement Kysely setup + migrations
- [ ] Add API routes to create/update sites and upload scripts
- [ ] Encrypt secrets at rest with env key

## Runner (Playwright)
- [ ] Build step runner (click/fill/goto/etc.)
- [ ] Inject decrypted secrets at runtime
- [ ] Handle captcha step placeholder (manual or stub solver)
- [ ] Capture screenshot after login and store metadata
- [ ] Track runs + last success/failure

## UI (SSR)
- [ ] Dashboard: sites list with last run status
- [ ] Site detail: script summary, run history, screenshots
- [ ] Create/edit site form
- [ ] “Run now” button + status feedback

## Ops
- [ ] Dockerfile + compose for NAS
- [ ] Volumes for SQLite + screenshots
- [ ] Cron or scheduler for monthly runs
- [ ] Logging + basic retry policy
