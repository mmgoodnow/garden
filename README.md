# garden

To install dependencies:

```bash
npm install
```

Requires Node 24 (use `fnm` with `.node-version`).

To run:

```bash
node --experimental-transform-types index.ts
```

Helper CLI (subcommand):

```bash
node --experimental-transform-types index.ts helper record [url] --upload-to http://localhost:3000 --site-id <id>
```

Codebase map:

```mermaid
graph TD
  index["index.ts"] --> server["Express server"]
  index --> helper["helper subcommand"]
  server --> templates["templates.ts"]
  server --> db["db.ts (node:sqlite)"]
  server --> scheduler["scheduler.ts"]
  scheduler --> runner["runner.ts"]
  runner --> playwright["Playwright"]
  runner --> events["events.ts"]
  events --> db
  helper --> helperlib["helper-lib.ts"]
```
