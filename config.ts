import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const DATA_DIR = process.env.DATA_DIR ?? "./data";
export const DB_PATH = process.env.DB_PATH ?? join(DATA_DIR, "garden.db");
export const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);

export const BUILD_INFO = getBuildInfo();
export { getBuildInfo };

function getBuildInfo() {
  const envSha = process.env.GIT_COMMIT_SHA?.trim();
  const envMessage = process.env.GIT_COMMIT_MESSAGE?.trim();
  const sha =
    (envSha && envSha.length > 0 ? envSha : null) ??
    readGitFromFiles().sha ??
    readGit("rev-parse", "HEAD");
  const message =
    (envMessage && envMessage.length > 0 ? envMessage : null) ??
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
    const result = spawnSync("git", args, { encoding: "utf8" });
    if (result.status !== 0) return null;
    return result.stdout.trim() || null;
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
      sha = readPackedRef(ref) ?? "";
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

function readPackedRef(ref: string) {
  const refPath = join(process.cwd(), ".git", ref);
  if (existsSync(refPath)) {
    return readFileSync(refPath, "utf8").trim();
  }

  const packedPath = join(process.cwd(), ".git", "packed-refs");
  if (!existsSync(packedPath)) return null;

  const lines = readFileSync(packedPath, "utf8").split("\n");
  for (const line of lines) {
    if (!line || line.startsWith("#") || line.startsWith("^")) continue;
    const [hash, name] = line.split(" ");
    if (name === ref) return hash;
  }
  return null;
}
