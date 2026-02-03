---
description: Use Node.js (with tsx) and Express for the server.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to Node.js with `tsx` for running TypeScript directly.

- Use `node --import tsx <file>` or `tsx <file>` to run TypeScript.
- Use `node --test --import tsx` for tests.
- Use `npm install` for dependencies.

## APIs

- Use Express for HTTP routing.
- Use `node:sqlite` for SQLite access.
- Prefer `node:fs` for file IO and `node:child_process` for subprocesses.

## Testing

Use `node --test --import tsx` to run tests.

```ts#index.test.ts
import test from "node:test";
import assert from "node:assert/strict";

test("hello world", () => {
  assert.equal(1, 1);
});
```
