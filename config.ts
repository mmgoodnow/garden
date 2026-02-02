import { join } from "node:path";

export const DATA_DIR = process.env.DATA_DIR ?? "./data";
export const DB_PATH = process.env.DB_PATH ?? join(DATA_DIR, "garden.db");
export const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);

export const BUILD_INFO = getBuildInfo();

function getBuildInfo() {
  const sha = process.env.GIT_COMMIT_SHA ?? readGit("rev-parse", "HEAD");
  const message = process.env.GIT_COMMIT_MESSAGE ?? readGit("log", "-1", "--pretty=%s");

  if (!sha && !message) return null;

  return {
    sha: sha?.trim() || "unknown",
    message: message?.trim() || "",
  };
}

function readGit(...args: string[]) {
  try {
    const result = Bun.spawnSync({
      cmd: ["git", ...args],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) return null;
    return new TextDecoder().decode(result.stdout).trim() || null;
  } catch {
    return null;
  }
}
