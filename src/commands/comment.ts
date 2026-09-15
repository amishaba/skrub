import type { Scan } from "../scan/summary.ts";
import { fail, errMessage } from "../lib/errors.ts";
import { runScan } from "../scan/run.ts";
import { explainDeletions } from "../llm/explain.ts";
import path from "node:path";
import { GitHubError } from "../github/api.ts";
import { postReview, type ReviewComment } from "../github/review.ts";
import { git } from "../git/git.ts";
import { prContextFromEnv } from "../github/pr.ts";
import { findingLines, headline, noteMarkdown, suggestsDeletion, summaryMarkdown } from "../report/report.ts";

export async function commentCommand(opts: {
  against?: string;
  cwd?: string;
  pr?: string;
  repo?: string;
  llm?: boolean;
}): Promise<void> {
  const ctx = await prContextFromEnv({ pr: opts.pr, repo: opts.repo, against: opts.against });
  if (!ctx) {
    fail("skrub comment needs a pull request (GitHub Actions) or --pr <n> --repo owner/name.");
  }

  const cwd = path.resolve(opts.cwd ?? process.cwd());
  await onHeadCommit(cwd, ctx.headSha);
  // Diff from where the branch left the base, not the base's tip: commits that
  // landed on the base since are not this PR's.
  const against = opts.against ?? (await git(["merge-base", ctx.baseSha, "HEAD"], cwd).catch(() => ctx.baseSha));
  const llm = opts.llm !== false;
  let scan: Scan;
  try {
    // A failed scan exits here, before any existing comment is touched, so a
    // broken run never replaces a good result with nothing.
    ({ scan } = await runScan({ cwd: opts.cwd, against, llm, requireAgainst: true }));
  } catch (err) {
    fail(errMessage(err));
  }

  const explanations = await explainDeletions(
    opts.cwd ?? process.cwd(),
    scan.hunks.filter(suggestsDeletion),
    llm,
  );

  const notes: ReviewComment[] = scan.hunks
    .filter((h) => h.startLine >= 1)
    .map((h) => ({
      path: h.file,
      line: h.endLine,
      startLine: h.startLine,
      body: noteMarkdown(h, explanations.get(h.id)),
    }));

  let result: Awaited<ReturnType<typeof postReview>>;
  try {
    result = await postReview(ctx, notes, (posted, skipped) =>
      summaryMarkdown(scan, { base: against, head: ctx.headSha, posted, total: notes.length, skipped }),
    );
  } catch (err) {
    // A pull request from a fork gets a read-only token: report in the log and pass, rather than fail the job.
    if (err instanceof GitHubError && (err.status === 403 || err.status === 404)) {
      console.log(`skrub comment  ${headline(scan.hunks)}`);
      console.log(`  can't comment on this pull request (GitHub ${err.status}: the token is read-only, as it is for forks)`);
      for (const line of findingLines(scan.hunks)) console.log(`  ${line}`);
      return;
    }
    throw err;
  }

  console.log(`skrub comment  ${headline(scan.hunks)}`);
  if (result.skipped > 0) {
    console.log(`  ${result.posted} of ${notes.length} inline, ${result.skipped} outside the diff`);
  }
  console.log(`  ${result.url}`);
}

/**
 * Line numbers must come from the commit the comments are posted on. On a
 * pull_request event, actions/checkout gives the merge of the PR into its base,
 * where lines can sit lower than in the PR's own head; in Actions, move to the
 * head. Anywhere else, ask for it rather than switch someone's checkout.
 */
async function onHeadCommit(cwd: string, headSha: string): Promise<void> {
  const here = await git(["rev-parse", "HEAD"], cwd).catch(() => "");
  if (here === headSha) return;
  if (process.env.GITHUB_ACTIONS !== "true") {
    fail(`skrub comment scans the pull request's head commit; check out ${headSha.slice(0, 7)} first.`);
  }
  try {
    await git(["checkout", "--quiet", "--detach", headSha], cwd);
  } catch {
    await git(["fetch", "--quiet", "--depth=1", "origin", headSha], cwd);
    await git(["checkout", "--quiet", "--detach", headSha], cwd);
  }
}
