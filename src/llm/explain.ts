import type { Hunk } from "../hunk.ts";
import { geminiJson, geminiKey } from "./gemini.ts";
import { candidate, readFileBlocks } from "./context.ts";

const EXPLAIN_PROMPT = `You are skrub explaining proposed code deletions to a PR reviewer.
skrub has already decided each candidate can be removed — dead code, a duplicate,
a pass-through wrapper, or leftover agent slop. For each one, write at most 40 words:
what the code is, then why removing it is safe. No preamble, no hedging, no praise.
Do not restate the reason you were given, and never argue for keeping it. Return JSON:
{ "explanations": [{ "id": "hunk-id", "text": "..." }] }`;

/**
 * One-to-two sentence explanation per delete hunk, for the suggestion posted on a
 * PR. No-op (empty map) if disabled or no key — the comment then falls back to the
 * mechanical reason alone. Only the hunks passed in are explained; pass just the
 * ones that will become suggestions.
 */
export async function explainDeletions(cwd: string, hunks: Hunk[], enabled: boolean): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!enabled || hunks.length === 0) return out;
  const key = geminiKey();
  if (!key) return out;

  const picked = hunks.slice(0, 30);
  const ids = new Set(picked.map((h) => h.id));
  const fileBlocks = await readFileBlocks(cwd, [...new Set(picked.map((h) => h.file))]);
  const candidates = picked.map(candidate);

  const raw = await geminiJson(
    key,
    `${EXPLAIN_PROMPT}\n\nCANDIDATES\n${JSON.stringify(candidates, null, 2)}\n\n${fileBlocks.join("\n\n")}`,
  );
  if (!raw || !Array.isArray(raw.explanations)) return out;
  for (const item of raw.explanations) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const id = typeof e.id === "string" ? e.id : "";
    const text = typeof e.text === "string" ? e.text.trim().replace(/\s+/g, " ") : "";
    if (ids.has(id) && text) out.set(id, text);
  }
  return out;
}
