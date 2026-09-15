import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.ts";
import { loadProgram } from "../program/program.ts";
import { detectProduct, productSection, productText, withProductSection } from "../product/product.ts";
import { CONVENTIONS_FILE, type Mined, mine, readConventions, renderConventions, rulesFrom, withSharedSection } from "./conventions.ts";

/**
 * Read the repo's conventions from its code. Writes them down the first time
 * (or with `write`, taking the code's side and keeping the notes); otherwise
 * reports where the code has drifted from what is written. `refresh` (init)
 * rewrites what skrub generates (the description, "use these first") and
 * leaves the rules, the notes and the product section as they are.
 */
export async function establish(
  cwd: string,
  write = false,
  refresh = false,
): Promise<{ mined: Mined | null; existed: boolean; wrote: boolean; refreshed: boolean; drift: string[] }> {
  const program = await loadProgram(cwd, await loadConfig(cwd));
  const mined = mine(program);
  const existing = await readConventions(cwd);
  if (mined.sources === 0) return { mined: null, existed: !!existing, wrote: false, refreshed: false, drift: [] };
  const next = rulesFrom(mined);
  const drift: string[] = [];
  if (existing) {
    for (const key of new Set([...Object.keys(existing.rules), ...Object.keys(next)]) as Set<keyof typeof next>) {
      const was = existing.rules[key];
      const now = next[key];
      if (was === now) continue;
      const observation = mined.observations.find((f) => f.key === key)!;
      const evidence = observation.total > 0 ? ` (${observation.agree} of ${observation.total})` : "";
      drift.push(`${key}: written ${was ?? "(nothing)"}, code now ${now ?? "mixed"}${evidence}`);
    }
  }
  const shouldWrite = !existing || write;
  let refreshed = false;
  const file = path.join(cwd, CONVENTIONS_FILE);
  const before = existing ? await fs.readFile(file, "utf8") : "";
  // The product section is written once from the repo, then kept as the agent and the user left it.
  const kept = productText(before);
  const product = kept != null ? kept.trimEnd().split("\n").concat("") : productSection(await detectProduct(cwd));
  if (shouldWrite) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, withProductSection(renderConventions(mined, existing?.notes ?? ""), product), "utf8");
  } else {
    const generated = refresh ? withFrontmatterOf(renderConventions(mined, existing.notes), before) : withSharedSection(before, mined.shared);
    const next = withProductSection(generated, product);
    if (next !== before) {
      if (refresh) {
        await fs.writeFile(file, next, "utf8");
        refreshed = true;
      } else {
        if (kept == null) drift.push("product: no section yet; `skrub init` adds it");
        if (withSharedSection(before, mined.shared) !== before) drift.push("use these first: the most-imported list has changed");
      }
    }
  }
  return { mined, existed: !!existing, wrote: shouldWrite, refreshed, drift };
}

/** `text` with the frontmatter (the checked rules) of `from`: refreshing the description never changes what is enforced. */
function withFrontmatterOf(text: string, from: string): string {
  const front = /^---\n[\s\S]*?\n---\n/;
  const kept = front.exec(from)?.[0];
  return kept ? text.replace(front, kept) : text;
}
