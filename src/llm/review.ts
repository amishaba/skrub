import { promises as fs } from "node:fs";
import path from "node:path";
import { type Hunk, type HunkKind, slug } from "../hunk.ts";
import { LLM_MODEL, geminiJson, geminiKey } from "./gemini.ts";
import { candidate, readFileBlocks } from "./context.ts";

const SAFE_KINDS = new Set<HunkKind>(["unused_export", "unused_file", "unused_import"]);
const EXTRA_KINDS = new Set(["naming", "pattern", "dup", "glue", "claudeism"]);

const REVIEW_PROMPT = `You are the second pass of skrub, a TypeScript quality tool. You are NOT a bug finder.

The first pass already found dead exports, files and imports (knip and the compiler) plus heuristics (glue wrappers, duplicate bodies, narrating comments, weak names).

Your job:
1. Drop heuristic false positives (keep: false). Candidates marked safe are not yours to judge; leave them out of verdicts.
2. Optionally replace a heuristic finding's reason with one sentence, no lecture.
3. Add notes the heuristics missed: vague names, copy-paste, wrappers, narrating comments, leftover agent slop. Notes are read by a person; they never delete anything.

NEVER report bugs, security, correctness, missing tests, error handling, performance, or formatting.

Return JSON:
{
  "verdicts": [{ "id": "hunk-id", "keep": true, "reason": "optional better sentence" }],
  "findings": [{ "file": "src/foo.ts", "startLine": 1, "endLine": 1, "kind": "naming"|"pattern"|"dup"|"glue"|"claudeism", "reason": "one sentence", "confidence": 0.6 }]
}
Max 8 extra findings. High precision. Empty arrays are fine.`;

interface LlmReview {
  hunks: Hunk[];
  model: string | null;
}

/**
 * Second pass. No-op if --no-llm or no key. Safe findings pass through exactly
 * as they were; the model can only drop or reword heuristic ones, and what it
 * adds are notes, never deletions.
 */
export async function reviewWithLlm(cwd: string, hunks: Hunk[], files: string[], enabled: boolean): Promise<LlmReview> {
  if (!enabled) return { hunks, model: null };
  const key = geminiKey();
  if (!key) return { hunks, model: null };

  const toReview = hunks.slice(0, 25);
  const fileBlocks = await readFileBlocks(cwd, [...new Set([...toReview.map((h) => h.file), ...files])]);

  const candidates = toReview.map((h) => ({ ...candidate(h), safe: h.safe }));

  const raw = await geminiJson(
    key,
    `${REVIEW_PROMPT}\n\nCANDIDATES\n${JSON.stringify(candidates, null, 2)}\n\n${fileBlocks.join("\n\n")}`,
  );
  if (!raw) return { hunks, model: LLM_MODEL };

  const byId = new Map(hunks.map((h) => [h.id, { ...h }]));
  if (Array.isArray(raw.verdicts)) {
    for (const v of raw.verdicts) {
      if (!v || typeof v !== "object") continue;
      const id = typeof v.id === "string" ? v.id : "";
      const h = byId.get(id);
      if (!h || h.safe || SAFE_KINDS.has(h.kind)) continue;
      if (v.keep === false) {
        byId.delete(id);
        continue;
      }
      if (typeof v.reason === "string" && v.reason.trim()) h.reason = v.reason.trim().split("\n")[0]!;
    }
  }

  const extra = await findingsToHunks(cwd, raw.findings);
  const merged = [...byId.values(), ...extra];
  return { hunks: merged, model: LLM_MODEL };
}

async function findingsToHunks(cwd: string, findings: unknown): Promise<Hunk[]> {
  if (!Array.isArray(findings)) return [];
  const hunks: Hunk[] = [];
  for (const item of findings.slice(0, 8)) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const file = typeof f.file === "string" ? f.file.split("\\").join("/") : "";
    const startLine = Number(f.startLine);
    const endLine = Number(f.endLine ?? f.startLine);
    const kind = typeof f.kind === "string" ? f.kind : "";
    const reason = typeof f.reason === "string" ? f.reason.trim().split("\n")[0]! : "";
    if (!file || !EXTRA_KINDS.has(kind) || !reason || !Number.isFinite(startLine) || startLine < 1) continue;
    let text = "";
    try {
      const src = await fs.readFile(path.join(cwd, file), "utf8");
      const lines = src.split("\n");
      text = lines.slice(Math.max(0, startLine - 1), Math.max(startLine, endLine)).join("\n") + "\n";
    } catch {
      continue;
    }
    hunks.push({
      id: slug(["llm", kind, file, String(startLine)]),
      file,
      startLine,
      endLine: Number.isFinite(endLine) && endLine >= startLine ? endLine : startLine,
      kind: kind as HunkKind,
      confidence: Math.min(0.7, Math.max(0.4, Number(f.confidence) || 0.55)),
      reason,
      text,
      safe: false,
      action: "comment",
    });
  }
  return hunks;
}
