import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const outputPath = process.argv[2] ?? "build-info.json";

const info = resolveBuildInfo();
writeFileSync(outputPath, JSON.stringify(info));

function resolveBuildInfo() {
  let sha = process.env.GIT_COMMIT_SHA ?? "";
  let message = process.env.GIT_COMMIT_MESSAGE ?? "";

  const gitDir = join(process.cwd(), ".git");
  if (existsSync(gitDir)) {
    if (!sha || !message) {
      const gitResult = readGitCommand();
      sha = sha || gitResult.sha;
      message = message || gitResult.message;
    }
    if (!sha) {
      const headPath = join(gitDir, "HEAD");
      if (existsSync(headPath)) {
        const head = readFileSync(headPath, "utf8").trim();
        if (head.startsWith("ref:")) {
          const ref = head.replace("ref:", "").trim();
          sha = readRef(gitDir, ref) ?? sha;
        } else {
          sha = head;
        }
      }
    }

    if (!message) {
      const logPath = join(gitDir, "logs", "HEAD");
      if (existsSync(logPath)) {
        const last = readFileSync(logPath, "utf8").trim().split("\n").pop() ?? "";
        const parts = last.split("\t");
        message = parts[1] ? parts[1].trim() : "";
      }
    }
  }

  return { sha, message };
}

function readRef(gitDir: string, ref: string) {
  const refPath = join(gitDir, ref);
  if (existsSync(refPath)) {
    return readFileSync(refPath, "utf8").trim();
  }

  const packedPath = join(gitDir, "packed-refs");
  if (!existsSync(packedPath)) return null;

  const lines = readFileSync(packedPath, "utf8").split("\n");
  for (const line of lines) {
    if (!line || line.startsWith("#") || line.startsWith("^")) continue;
    const [hash, name] = line.split(" ");
    if (name === ref) return hash;
  }
  return null;
}

function readGitCommand() {
  try {
    const shaResult = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
    const msgResult = spawnSync("git", ["log", "-1", "--pretty=%s"], {
      encoding: "utf8",
    });
    if (shaResult.status !== 0 || msgResult.status !== 0) {
      return { sha: "", message: "" };
    }
    const sha = shaResult.stdout.trim();
    const message = msgResult.stdout.trim();
    return { sha, message };
  } catch {
    return { sha: "", message: "" };
  }
}
