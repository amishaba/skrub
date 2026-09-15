#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

// The scanned repo's .env holds its own app's keys. Only skrub's own settings
// (SKRUB_*) are read from it, so a GEMINI_API_KEY meant for the app never turns
// on skrub's LLM pass. A key set in the shell still does.
if (existsSync(".env")) {
  try {
    const vars = parseEnv(readFileSync(".env", "utf8"));
    for (const [k, v] of Object.entries(vars)) {
      if (k.startsWith("SKRUB_") && process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    // keys can still come from the shell
  }
}

const root = dirname(fileURLToPath(import.meta.url));
register({ tsconfig: join(root, "../tsconfig.json") });
await import("../src/cli.ts");
