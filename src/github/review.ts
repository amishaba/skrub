import { GitHubError, gh, githubToken } from "./api.ts";
import type { PrContext } from "./pr.ts";

const MARKER = "<!-- skrub -->";
const LEGACY_MARKER = "<!-- unvibe -->";

export interface ReviewComment {
  path: string;
  line: number;
  startLine?: number;
  body: string;
}

interface GhComment {
  id: number;
  body?: string;
}

interface PostResult {
  url: string;
  /** Inline notes that landed. */
  posted: number;
  /** Inline notes GitHub refused because the line is not part of the diff. */
  skipped: number;
}

/** At most this many inline notes per run; the summary table still counts everything. */
const MAX_INLINE = 30;

/**
 * Replace skrub's inline notes on the PR and keep exactly one summary comment.
 * The summary text is built after posting, so it can say how many notes landed.
 */
export async function postReview(
  ctx: PrContext,
  comments: ReviewComment[],
  summaryFor: (posted: number, skipped: number) => string,
): Promise<PostResult> {
  const token = githubToken();
  if (!token) throw new Error("GITHUB_TOKEN missing — cannot comment on the PR.");

  await deletePriorComments(ctx, token);

  // Post each note as a standalone review comment, not one grouped review. A review
  // object can't be deleted through the API, so its summary body would linger on
  // every re-run; standalone comments are deletable and get cleared above. Posting
  // one at a time also means a note on a line outside the diff is skipped and
  // counted, instead of sinking the whole batch.
  let posted = 0;
  let skipped = 0;
  for (const c of comments.slice(0, MAX_INLINE)) {
    try {
      await gh(`/repos/${ctx.owner}/${ctx.repo}/pulls/${ctx.number}/comments`, token, {
        method: "POST",
        body: JSON.stringify({
          commit_id: ctx.headSha,
          path: c.path,
          line: c.line,
          side: "RIGHT",
          ...(c.startLine && c.startLine !== c.line ? { start_line: c.startLine, start_side: "RIGHT" } : {}),
          body: `${MARKER}\n${c.body}`,
        }),
      });
      posted += 1;
    } catch (err) {
      // 422 is GitHub saying the line is not in the diff. Anything else (auth,
      // rate limit, network) is a real failure and must not pass as "skipped".
      if (err instanceof GitHubError && err.status === 422) {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }

  const body = `${MARKER}\n${summaryFor(posted, skipped)}`;
  // With nothing to say, only refresh a summary that already exists — a clean
  // PR should not collect a "nothing to delete" comment on every push.
  const url =
    comments.length === 0 ? await updateSummaryIfPresent(ctx, token, body) : await upsertSummary(ctx, token, body);
  return { url, posted, skipped };
}

/** Keep a single summary comment and edit it in place; never stack a new one per run. */
async function upsertSummary(ctx: PrContext, token: string, body: string): Promise<string> {
  const [keep, ...extra] = await skrubIssueComments(ctx, token);
  await Promise.all(extra.map((c) => deleteIssueComment(ctx, token, c.id)));
  if (keep) {
    const updated = await gh<{ html_url?: string }>(
      `/repos/${ctx.owner}/${ctx.repo}/issues/comments/${keep.id}`,
      token,
      { method: "PATCH", body: JSON.stringify({ body }) },
    );
    return updated.html_url ?? prUrl(ctx);
  }
  const created = await gh<{ html_url?: string }>(
    `/repos/${ctx.owner}/${ctx.repo}/issues/${ctx.number}/comments`,
    token,
    { method: "POST", body: JSON.stringify({ body }) },
  );
  return created.html_url ?? prUrl(ctx);
}

async function deletePriorComments(ctx: PrContext, token: string): Promise<void> {
  const comments = await gh<GhComment[]>(
    `/repos/${ctx.owner}/${ctx.repo}/pulls/${ctx.number}/comments?per_page=100`,
    token,
  );
  for (const c of comments) {
    if (!isSkrub(c.body)) continue;
    try {
      await gh(`/repos/${ctx.owner}/${ctx.repo}/pulls/comments/${c.id}`, token, { method: "DELETE" });
    } catch {
      // already gone
    }
  }
}

async function updateSummaryIfPresent(ctx: PrContext, token: string, body: string): Promise<string> {
  const existing = await skrubIssueComments(ctx, token);
  if (existing.length === 0) return prUrl(ctx);
  return upsertSummary(ctx, token, body);
}

async function skrubIssueComments(ctx: PrContext, token: string): Promise<GhComment[]> {
  const comments = await gh<GhComment[]>(
    `/repos/${ctx.owner}/${ctx.repo}/issues/${ctx.number}/comments?per_page=100`,
    token,
  );
  return comments.filter((c) => isSkrub(c.body));
}

async function deleteIssueComment(ctx: PrContext, token: string, id: number): Promise<void> {
  try {
    await gh(`/repos/${ctx.owner}/${ctx.repo}/issues/comments/${id}`, token, { method: "DELETE" });
  } catch {
    // already gone
  }
}

function isSkrub(body?: string): boolean {
  return !!body && (body.includes(MARKER) || body.includes(LEGACY_MARKER));
}

function prUrl(ctx: PrContext): string {
  return `https://github.com/${ctx.owner}/${ctx.repo}/pull/${ctx.number}`;
}
