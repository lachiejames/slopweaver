/**
 * `$CODEX_HOME/auth.json`'s stamp — the one file read the sign-in observations need, and a Codex store's own file
 * rather than Slopweaver state: it stays a stat when the observations themselves move into the store.
 */
import { statSync } from "node:fs";
import { join } from "node:path";

import type { CodexAuthStamp } from "./signInRecord.js";

/**
 * Stamp a store's `auth.json` — its mtime, ctime and size, never a byte of what it says.
 *
 * @param codexHome the store directory
 * @returns present with the stamp, or absent when there is no file to stat
 */
export function readCodexAuthStamp({ codexHome }: { codexHome: string }): CodexAuthStamp {
  try {
    const stat = statSync(join(codexHome, "auth.json"));
    return { ctimeMs: stat.ctimeMs, kind: "present", mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    return { kind: "absent" };
  }
}
