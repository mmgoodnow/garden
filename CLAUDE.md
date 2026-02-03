---
description: Use Node.js (24+) and Express for the server.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to Node.js with type-stripping for running TypeScript directly.

- Use `node --experimental-strip-types <file>` to run TypeScript.
- Use `node --test --experimental-strip-types` for tests.
- Use `npm install` for dependencies.

## APIs

- Use Express for HTTP routing.
- Use `node:sqlite` for SQLite access.
- Prefer `node:fs` for file IO and `node:child_process` for subprocesses.

## Testing

Use `node --test --experimental-strip-types` to run tests.

```ts#index.test.ts
import test from "node:test";
import assert from "node:assert/strict";

test("hello world", () => {
  assert.equal(1, 1);
});
```
