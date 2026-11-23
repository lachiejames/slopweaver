/**
 * The bump manifests a pull request itself commits under `.baselines/bumps/`, read as records beside the state
 * home's (`./bumpRecordStore.ts`). A landing CLI built before records moved to the home finds a declaration only
 * there, so a pull request landed by one carries its manifest in the tree; this read lets the current landing
 * verbs take the same file, so one declaration and one witness satisfy both.
 *
 * Only a file the candidate merge ADDS against the base counts. One main already holds is history, whatever its
 * rows, and one a change rewrites is CI's to refuse (`../devLint/baselineComparison.ts`), never a declaration.
 * Every added file must decode as a manifest filed under its own digest, or the whole read is an error — the
 * same fail-closed rule as the home's.
 */

import { err, ok, type Result } from "#lib/result.js";
import { parseBumpManifest } from "../devLint/baselineBump.js";
import { COMMITTED_BUMP_DIR } from "../devLint/baselineRegistry.js";
import { gitNulFields, gitShow } from "../devLint/gitAtCommit.js";
import { type BumpRecord, type BumpRecordStoreError, BumpRecordStoreErrors } from "./bumpRecordStore.js";

/**
 * Every manifest the candidate adds under `.baselines/bumps/` against the base, decoded and checked. IO edge.
 *
 * @param root a checkout holding both commits
 * @param base the pull request's base commit
 * @param candidate the merge commit landing would produce
 * @returns the manifests as records keyed by their repository path, or why one could not be read — never a
 *   partial list
 */
export function committedBumpManifests({
  root,
  base,
  candidate,
}: {
  root: string;
  base: string;
  candidate: string;
}): Result<readonly BumpRecord[], BumpRecordStoreError> {
  const added = gitNulFields({
    // `--no-renames`: a move inside the directory is otherwise an `R`, which the `A` filter drops.
    args: ["diff", "--no-renames", "--name-only", "--diff-filter=A", "-z", base, candidate, "--", COMMITTED_BUMP_DIR],
    root,
  });
  if (added === undefined) {
    return err(
      BumpRecordStoreErrors.unreadable({ cause: `git would not list them at ${candidate}`, path: COMMITTED_BUMP_DIR }),
    );
  }
  const records: BumpRecord[] = [];
  for (const path of added.toSorted()) {
    const text = gitShow({ root, spec: `${candidate}:${path}` });
    if (text === undefined) {
      return err(BumpRecordStoreErrors.unreadable({ cause: `git would not show it at ${candidate}`, path }));
    }
    const manifest = parseBumpManifest({ name: path.slice(path.lastIndexOf("/") + 1), path, text });
    if (manifest.isErr()) {
      return err(BumpRecordStoreErrors.invalid({ detail: manifest.error.message, path }));
    }
    records.push({ manifest: manifest.value, path });
  }
  return ok(records);
}

/**
 * The records a landing judges: the home's, then each manifest the change commits whose digest the home does
 * not already hold, so one declaration kept in both places is judged once. Pure.
 *
 * @param stored the records read from the state home
 * @param committed the manifests {@link committedBumpManifests} read from the change
 * @returns every record, the home's first
 */
export function landingBumpRecords({
  stored,
  committed,
}: {
  stored: readonly BumpRecord[];
  committed: readonly BumpRecord[];
}): readonly BumpRecord[] {
  const held = new Set(stored.map((record) => record.manifest.digest));
  return [...stored, ...committed.filter((record) => !held.has(record.manifest.digest))];
}
