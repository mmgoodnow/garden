import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const DATA_DIR = process.env.DATA_DIR ?? "./data";
export const DB_PATH = process.env.DB_PATH ?? join(DATA_DIR, "garden.db");
export const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);

export const BUILD_INFO = getBuildInfo();

function getBuildInfo() {
  const sha =
    process.env.GIT_COMMIT_SHA ??
    readGitFromFiles().sha ??
    readGit("rev-parse", "HEAD");
  const message =
    process.env.GIT_COMMIT_MESSAGE ??
    readGitFromFiles().message ??
    readGit("log", "-1", "--pretty=%s");

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

function readGitFromFiles() {
  try {
    const headPath = join(process.cwd(), ".git", "HEAD");
    if (!existsSync(headPath)) return { sha: null, message: null };
    const head = readFileSync(headPath, "utf8").trim();
    let sha = "";
    if (head.startsWith("ref:")) {
      const ref = head.replace("ref:", "").trim();
      const refPath = join(process.cwd(), ".git", ref);
      if (existsSync(refPath)) {
        sha = readFileSync(refPath, "utf8").trim();
      }
    } else {
      sha = head;
    }

    const logPath = join(process.cwd(), ".git", "logs", "HEAD");
    let message = "";
    if (existsSync(logPath)) {
      const log = readFileSync(logPath, "utf8").trim().split("\n").pop() ?? "";
      const parts = log.split("\t");
      message = parts[1] ? parts[1].trim() : "";
    }

    return { sha: sha || null, message: message || null };
  } catch {
    return { sha: null, message: null };
  }
}
