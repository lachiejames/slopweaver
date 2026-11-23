/**
 * The one filesystem edge for the gate's debt list. Reads and writes a single newline-delimited file of
 * accepted finding keys.
 *
 * ## Why this is state OUTSIDE the repository
 *
 * `AGENTS.md` § "Tools in the codebase, state outside it": what this file records is the set of
 * defects standing in THIS MACHINE's auto-memory corpora, which are per-install and live outside git
 * entirely. Committing a baseline of them — the way `.baselines/error-shape-threshold-baseline.json` commits
 * a fact about this repository's own source — would make one operator's memory defects a fact every other
 * install inherits. So it lives under `$SLOPWEAVER_HOME`, uncommitted, and a fresh machine simply starts
 * with an empty list.
 *
 * ## Why lines rather than JSON
 *
 * A key holds a NUL separator and nothing else needs escaping, so a line is already unambiguous and
 * `git diff` of a state repo shows one accepted defect per line. There is no record shape to grow into.
 */

import { existsSync, readFileSync } from "node:fs";

import type { IngestError } from "../lib/ingestError.js";
import type { Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { stateHomePaths } from "../stateHome.js";

/**
 * Where the debt list lives.
 *
 * Read off `stateHome.ts` rather than joined here: that file is the ONE contract for every path under
 * `$SLOPWEAVER_HOME`, and a guard test refuses a second module deriving one with its own `join`.
 *
 * @returns the absolute path
 */
export function gateBaselinePath(): string {
  return stateHomePaths().memoryGateBaseline;
}

/**
 * Read the accepted keys.
 *
 * An absent file is an EMPTY list rather than an error: never having accepted anything is the normal state
 * of a fresh install, and the gate's whole contract on a fresh install is that every finding is fresh.
 *
 * @param path the debt list's path
 * @returns the accepted keys, or a typed I/O error
 */
export function readGateBaseline({ path }: { path: string }): Result<readonly string[], IngestError> {
  return safeFs({
    execute: (): readonly string[] => {
      if (!existsSync(path)) {
        return [];
      }
      return readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line.length > 0);
    },
    operation: "memory.readGateBaseline",
    path,
  });
}

/**
 * Replace the accepted keys.
 *
 * @param path the debt list's path
 * @param keys the keys to record, already sorted
 * @returns nothing on success, or a typed I/O error
 */
export function writeGateBaseline({
  path,
  keys,
}: {
  path: string;
  keys: readonly string[];
}): Result<void, IngestError> {
  return safeFs({
    execute: (): void => {
      writeFileAtomic({ contents: keys.map((key) => `${key}\n`).join(""), path });
    },
    operation: "memory.writeGateBaseline",
    path,
  });
}
