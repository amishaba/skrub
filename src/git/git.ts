import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** Run git in `cwd`; resolves with trimmed stdout, rejects with stderr. */
export function git(args: string[], cwd: string, stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `git ${args[0]} exited ${code}`));
    });
    if (stdin != null) child.stdin.write(stdin);
    child.stdin.end();
  });
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    return (await git(["rev-parse", "--is-inside-work-tree"], cwd)) === "true";
  } catch {
    return false;
  }
}

export async function isDirty(cwd: string): Promise<boolean> {
  const out = await git(["status", "--porcelain"], cwd);
  if (!out) return false;
  return out.split("\n").some((line) => {
    const file = line.slice(3).replace(/^.* -> /, "");
    return file.length > 0 && !file.split("/").includes(".skrub") && !file.split("/").includes(".unvibe");
  });
}

/**
 * Tracked and untracked (not ignored) files, relative to `cwd`; null outside a
 * git repo. Synchronous, since it runs while the ts-morph project loads.
 */
export function listFiles(cwd: string): string[] | null {
  const res = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd, encoding: "utf8" });
  if (res.status !== 0) return null;
  // A tracked file deleted in the working tree stays listed until the deletion is staged.
  return res.stdout.split("\0").filter((f) => f && existsSync(path.join(cwd, f)));
}

/** Whether git ignores `rel` (from .gitignore, .git/info/exclude or a global excludes file); false outside a git repo. */
export function isIgnored(cwd: string, rel: string): boolean {
  return spawnSync("git", ["check-ignore", "-q", rel], { cwd }).status === 0;
}

export async function refExists(ref: string, cwd: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function gitApplyCheck(cwd: string, patch: string): Promise<{ ok: boolean; error: string }> {
  try {
    await git(["apply", "--check", "-"], cwd, patch);
    return { ok: true, error: "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function gitApply(cwd: string, patch: string): Promise<void> {
  await git(["apply", "-"], cwd, patch);
}
