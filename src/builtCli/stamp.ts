/**
 * Writing and removing the build manifest — the one file that decides whether a built tree is trusted.
 *
 * It is its own module because WHEN it is written is the whole safety argument, and that is easier to hold
 * in one place than inside the emit. A manifest present says "this tree was emitted from exactly this
 * source and was proved to run". Anything less than both halves must leave NO manifest, because a tree with
 * no manifest is not selected by `bin/slopweaver` and is not judged by the guard — it is simply ignored, and
 * the caller gets tsx.
 */

import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { safeJsonStringify } from "#lib/safeJson.js";
import { BUILD_MANIFEST_FILE, type SourceStamp } from "./staleness.js";

/**
 * Remove the manifest of a tree that is about to be overwritten, before the first file of the new emit
 * lands.
 *
 * A build that FAILS half way leaves a tree mixing old and new files, and until this ran first it left the
 * old manifest sitting beside them — stamped against source that no longer described either half, and
 * judged current by the guard. The failing build tells the operator it failed; the next verb, run from the
 * artifact it left, told them nothing at all.
 *
 * @param outDir the directory being emitted into
 */
export function clearStamp({ outDir }: { outDir: string }): void {
  const path = join(outDir, BUILD_MANIFEST_FILE);
  if (existsSync(path)) {
    rmSync(path);
  }
}

/**
 * Stamp a build that emitted and then PROVED itself by running.
 *
 * The stamps are TAKEN FROM THE CALLER, scanned beside the file listing before esbuild reads a byte, and
 * never re-scanned here. Scanning at this point instead was a measured hole
 * (`stale-tree-cannot-answer`): a source file written during the emit-and-smoke window landed in the
 * manifest as though it had been built in, while the emitted tree still held the module from before it.
 * The guard compared equal and the built CLI answered, saying nothing. Recording the PRE-emit stamps fails
 * the other way: such a file compares unequal, so the next verb refuses and names it. Repro: start
 * `dev build --out <dir>`, append a line to a tracked `src` module about a second in, then run
 * `<dir>/cli/index.js catalog`.
 *
 * @param outDir where the build was emitted
 * @param root the repository root the source was read from, recorded because `--out` may name any directory
 * @param stamps the source as it stood when the emit STARTED reading it
 */
export function stampBuild({
  outDir,
  root,
  stamps,
}: {
  outDir: string;
  root: string;
  stamps: readonly SourceStamp[];
}): void {
  writeFileSync(
    join(outDir, BUILD_MANIFEST_FILE),
    `${safeJsonStringify({
      label: BUILD_MANIFEST_FILE,
      value: { builtAtIso: new Date().toISOString(), root, stamps },
    })}\n`,
  );
}
