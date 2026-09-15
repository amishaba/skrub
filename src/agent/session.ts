import { promises as fs } from "node:fs";
import path from "node:path";
import { CONVENTIONS_FILE } from "../conventions/conventions.ts";
import { exists } from "../lib/fs.ts";
import { productText, productUnfilled } from "../product/product.ts";

const PRODUCT_GUIDE = ".claude/skills/skrub/references/product.md";

/**
 * What every Claude Code session starts knowing, through a SessionStart hook:
 * where the conventions live, what the product is and whose patterns it
 * follows, and, until the agent has filled it in, that the product section
 * needs filling first. A skill only loads when a task looks like it needs
 * one; this doesn't wait for that. Null when the repo has no conventions file.
 */
export async function sessionContext(cwd: string): Promise<string | null> {
  const file = path.join(cwd, CONVENTIONS_FILE);
  if (!(await exists(file))) return null;
  const text = await fs.readFile(file, "utf8");
  const guide = (await exists(path.join(cwd, PRODUCT_GUIDE))) ? ` Before building a feature, read ${PRODUCT_GUIDE}.` : "";
  const lines = [`skrub: this repo's conventions are in ${CONVENTIONS_FILE}; follow them in new code.${guide}`];
  if (productUnfilled(text)) {
    lines.push(
      `Its "## product" section isn't filled in yet. Before anything else this session, fill each "(to fill in)" line from the README, package.json, routes and UI: ` +
        "who uses it and the job they're doing, the space with two or three products those users already know, and what to copy from them for this repo's surfaces. " +
        "Keep each line short. Claude Code asks the user before any edit under .claude/, and that approval is their chance to correct it; " +
        "if they turn it down, put the lines in your reply instead.",
    );
  } else {
    const product = (productText(text) ?? "").split("\n").filter((l) => l.startsWith("- "));
    if (product.length) lines.push("The product, as written there:", ...product);
  }
  return lines.join("\n");
}
