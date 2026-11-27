/**
 * The bump manifests a candidate merge adds under `.baselines/bumps/`, read as records beside the state home's
 * (`./bumpRecordStore.ts`).
 *
 * The landing read (`./baselineBumpWitnessRun.ts`) calls this only after `./baselineBumpLanding.ts` has compared
 * the candidate against its base, and that comparison refuses every file a change adds, renames or rewrites
 * under the directory (`../devLint/baselineComparison.ts`). So on the landing path this lists nothing, and
 * contributes no record: its one effect there is to refuse when git will not list the directory.
 *
 * Called directly, only a file the candidate ADDS against the base counts, and every one must decode as a
 * manifest filed under its own digest, or the whole read is an error — the same fail-closed rule as the home's.
 */

import { err, ok, type Result } from "#lib/result.js";
import { parseBumpManifest } from "../devLint/baselineBump.js";
import { COMMITTED_BUMP_DIR } from "../devLint/baselineRegistry.js";
import { gitNulFields, gitShow } from "../devLint/gitAtCommit.js";
import { type BumpRecord, type BumpRecordStoreError, BumpRecordStoreErrors } from "./bumpRecordStore.js";

/**
 * Every manifest the candidate adds under `.baselines/bumps/` against the base, decoded and checked — none on the
 * landing path, whose comparison has already refused any such file. IO edge.
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
 * The home's records, then each committed one whose digest the home does not already hold, so one declaration
 * kept in both places is judged once. The landing path passes no committed record, so there it returns the
 * home's records alone. Pure.
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
