/** Tiny glob: * and ** only. Patterns without * match a prefix or exact path. */
export function matches(rel: string, pattern: string): boolean {
  const n = rel.split("\\").join("/");
  const p = pattern.split("\\").join("/").replace(/\/$/, "");
  if (!p.includes("*")) return n === p || n.startsWith(p + "/");
  const re = globToRe(p);
  return re.test(n);
}

function globToRe(pattern: string): RegExp {
  let i = 0;
  let out = "^";
  while (i < pattern.length) {
    if (pattern.startsWith("**/", i)) {
      out += "(?:.*/)?";
      i += 3;
      continue;
    }
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      out += ".*";
      i += 2;
      continue;
    }
    if (pattern[i] === "*") {
      out += "[^/]*";
      i += 1;
      continue;
    }
    if ("+.^${}()|[]\\".includes(pattern[i]!)) out += "\\" + pattern[i];
    else out += pattern[i];
    i += 1;
  }
  out += "$";
  return new RegExp(out);
}
