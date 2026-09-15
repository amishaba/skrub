import { promises as fs } from "node:fs";
import { gh, githubToken } from "./api.ts";

export interface PrContext {
  owner: string;
  repo: string;
  number: number;
  headSha: string;
  baseSha: string;
  baseRef: string;
}

export async function prContextFromEnv(opts: {
  pr?: string;
  repo?: string;
  against?: string;
}): Promise<PrContext | null> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath) {
    try {
      const event = JSON.parse(await fs.readFile(eventPath, "utf8")) as {
        number?: number;
        pull_request?: {
          number?: number;
          head?: { sha?: string };
          base?: { sha?: string; ref?: string };
        };
        repository?: { full_name?: string };
      };
      const pr = event.pull_request;
      const full = event.repository?.full_name ?? process.env.GITHUB_REPOSITORY;
      const [owner, repo] = (full ?? "").split("/");
      const number = pr?.number ?? event.number;
      if (owner && repo && number && pr?.head?.sha && pr.base?.sha) {
        return {
          owner,
          repo,
          number,
          headSha: pr.head.sha,
          baseSha: pr.base.sha,
          baseRef: pr.base.ref ?? "HEAD",
        };
      }
    } catch {
      // fall through to flags
    }
  }

  const full = opts.repo ?? process.env.GITHUB_REPOSITORY;
  const number = opts.pr ? Number.parseInt(opts.pr, 10) : NaN;
  if (!full || !Number.isFinite(number)) return null;
  const [owner, repo] = full.split("/");
  if (!owner || !repo) return null;

  const token = githubToken();
  if (!token) return null;
  const pr = await gh< {
    head: { sha: string };
    base: { sha: string; ref: string };
  }>(`/repos/${owner}/${repo}/pulls/${number}`, token);
  return {
    owner,
    repo,
    number,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    baseRef: pr.base.ref,
  };
}
