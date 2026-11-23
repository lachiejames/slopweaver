/**
 * A recursive fingerprint of a state home, for tests that assert "this run changed nothing".
 *
 * ## Why this is shared rather than written per test
 *
 * The obvious spelling — compare `readdirSync(home)` before and after — cannot see a change INSIDE an
 * existing file. A run that appends to a nested corpus file, or rewrites a scaffolded JSON, leaves the
 * top-level listing identical, so the test stays green while the behaviour it names regresses.
 *
 * That is not hypothetical. Two tests in this repo were written that way; a review pass produced a
 * counterexample for the first, it was fixed in place, and the SECOND one — six files away, asserting the
 * same kind of property — was missed until a later pass found it too. One shared helper is the fix for the
 * class, not just for the two instances.
 *
 * CONTENT hashes, not sizes. The first version used `statSync(full).size`, and a review pass pointed out the
 * obvious hole: rewriting a file's first byte while preserving its length leaves the fingerprint identical,
 * so "this run changed nothing" stayed green over a rewritten file. Size is a cheaper observation that is
 * also a weaker one, which is the trade this helper exists to stop tests making.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every file under `home`, as `path:sha256`, walked recursively and sorted.
 *
 * @param home the directory to fingerprint
 * @returns one `path:hash` entry per file, in path order
 */
export function homeFingerprint({ home }: { home: string }): readonly string[] {
  const walk = ({ dir }: { dir: string }): readonly string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        return walk({ dir: full });
      }
      return [`${full}:${createHash("sha256").update(readFileSync(full)).digest("hex")}`];
    });
  return walk({ dir: home }).toSorted();
}
