/**
 * The IO half every caller of the baseline comparison shares: read each registered baseline at main's commit
 * and at the change's commit, and list the paths the change touched. The gate (`./baselineAgainstMain.ts`)
 * reports what this returns, `dev baseline-bump` writes a bump record from it, and the landing verbs
 * (`src/codex/baselineBumpWitnessRun.ts`) re-run it themselves and match it against the records in the home.
 *
 * Both ends are COMMITS, never the working tree and never a ref name: CI supplies main's exact commit
 * (`./gitAtCommit.ts` § resolveFloorBase) and judges the commit it checked out, the landing verbs take both
 * from GitHub's own read of the pull request, and the verb asks git for the merge-base with `origin/main` and
 * says so. A working-tree read would let an uncommitted file decide a verdict on a commit. Every read goes
 * through `./gitAtCommit.ts`, which strips ambient git variables and ignores replacement refs.
 *
 * ## No record is read here
 *
 * Bump records live in the state home, which neither CI nor a commit holds, and a pull request may also commit
 * its manifest under `COMMITTED_BUMP_DIR`, where the landing verbs read it. What this module still refuses is a
 * file under `.baselines/` that nothing judges, at either commit — bar that directory, where a change may add a
 * manifest, leave main's byte-identical or delete one, and is refused only for rewriting one main holds, whose
 * bytes changed or which became a tree.
 */

import { err, ok, type Result } from "../lib/result.js";
import type { BumpManifest } from "./baselineBump.js";
import {
  BASELINE_POLICY_FILES,
  type BaselineShapeError,
  isCommittedBumpPath,
  type Loosening,
  loosenings,
  POLICY_ENTRY,
  RATCHET_BASELINES,
  strayBaselinesOf,
} from "./baselineRegistry.js";
import { gitNulFields, gitShow, gitSucceeds } from "./gitAtCommit.js";

/** Why the comparison could not be made, or a committed file it refuses — never a verdict on a loosening. */
export type BaselineComparisonError =
  | BaselineShapeError
  | { readonly code: "COMMIT_UNREACHABLE"; readonly message: string }
  | { readonly code: "UNREADABLE"; readonly message: string; readonly path: string }
  | { readonly code: "UNREGISTERED_BASELINE"; readonly message: string; readonly path: string }
  | { readonly code: "REWRITTEN_BUMP_MANIFEST"; readonly message: string; readonly path: string };

/** The factory for this module's own failures. */
export const BaselineComparisonErrors = {
  commitUnreachable: ({ rev }: { rev: string }): BaselineComparisonError => ({
    code: "COMMIT_UNREACHABLE",
    message: `commit ${rev} is not in this checkout — fetch it (CI does, at depth 1)`,
  }),
  rewrittenBumpManifest: ({ path }: { path: string }): BaselineComparisonError => ({
    code: "REWRITTEN_BUMP_MANIFEST",
    message:
      `${path}: a bump manifest main holds is never rewritten, since its witness judged these bytes — ` +
      "restore it to main's bytes or delete it, and declare the rows again with `slopweaver dev baseline-bump`",
    path,
  }),
  unreadable: ({ path }: { path: string }): BaselineComparisonError => ({
    code: "UNREADABLE",
    message: `${path} exists and could not be read`,
    path,
  }),
  unregistered: ({ path }: { path: string }): BaselineComparisonError => ({
    code: "UNREGISTERED_BASELINE",
    message:
      `${path} is a committed file under .baselines/ that no registry row judges — add it to RATCHET_BASELINES ` +
      "or, with a reason, to UNRATCHETED_BASELINES in src/devLint/baselineRegistry.ts",
    path,
  }),
} as const;

/** A bump manifest with where it was read — the shape `src/codex/bumpRecordStore.ts`'s records share. */
export interface NewManifest {
  readonly path: string;
  readonly manifest: BumpManifest;
}

/** What a change looks like against main. */
export interface BaselineComparison {
  readonly loosened: readonly Loosening[];
  /** Every path the change's commit differs from main's on. */
  readonly changedPaths: ReadonlySet<string>;
}

/** A file's text at a commit, `undefined` when the commit has no such file. */
function textAt({
  root,
  rev,
  path,
}: {
  root: string;
  rev: string;
  path: string;
}): Result<string | undefined, BaselineComparisonError> {
  if (!gitSucceeds({ args: ["cat-file", "-e", `${rev}:${path}`], root })) {
    return ok(undefined);
  }
  const text = gitShow({ root, spec: `${rev}:${path}` });
  return text === undefined ? err(BaselineComparisonErrors.unreadable({ path: `${rev}:${path}` })) : ok(text);
}

/**
 * The first committed file under `.baselines/` that the comparison refuses, or none. Pure.
 *
 * A path under the bump directory is refused only when the change REWRITES one main holds — its blob at the head
 * is not the one main has at that path. One the change adds is a declaration the landing verbs read
 * (`src/codex/committedBumpManifests.ts`), and main's own untouched or deleted ones are history. Any other file
 * no registry row names is refused at either end.
 *
 * @param base every repo-relative file under `.baselines/` at main's commit, with its blob id
 * @param head the same at the change's commit
 * @returns the refusal, or `undefined` when every file is accounted for
 */
export function committedBaselineRefusal({
  base,
  head,
}: {
  base: ReadonlyMap<string, string>;
  head: ReadonlyMap<string, string>;
}): BaselineComparisonError | undefined {
  const written = [...head].find(([path, blob]) => {
    const kept = base.get(path);
    return isCommittedBumpPath({ path }) && kept !== undefined && kept !== blob;
  });
  if (written !== undefined) {
    return BaselineComparisonErrors.rewrittenBumpManifest({ path: written[0] });
  }
  for (const listed of [base, head]) {
    const stray = strayBaselinesOf({ paths: [...listed.keys()].filter((path) => !isCommittedBumpPath({ path })) })[0];
    if (stray !== undefined) {
      return BaselineComparisonErrors.unregistered({ path: stray });
    }
  }
  return undefined;
}

/**
 * Every file under `.baselines/` at one commit, at any depth and of any extension, with its blob id.
 *
 * @returns path to blob, or why git would not list them
 */
function baselineBlobsAt({
  root,
  rev,
}: {
  root: string;
  rev: string;
}): Result<ReadonlyMap<string, string>, BaselineComparisonError> {
  const fields = gitNulFields({ args: ["ls-tree", "-r", "-z", rev, "--", ".baselines/"], root });
  if (fields === undefined) {
    return err(BaselineComparisonErrors.unreadable({ path: `${rev}:.baselines/` }));
  }
  const blobs = new Map<string, string>();
  for (const field of fields) {
    // `<mode> SP <type> SP <object> TAB <path>`, one per NUL-terminated record.
    const tab = field.indexOf("\t");
    const object = field.slice(0, tab).split(" ")[2];
    if (tab < 0 || object === undefined) {
      return err(BaselineComparisonErrors.unreadable({ path: `${rev}:.baselines/` }));
    }
    blobs.set(field.slice(tab + 1), object);
  }
  return ok(blobs);
}

/**
 * Refuse any committed file under `.baselines/` that {@link committedBaselineRefusal} refuses, and any bump record
 * main holds that the head turned into a tree. A recursive listing never emits a tree, so a record replaced by an
 * empty tree, or by a directory of files, is missing from the head's map exactly as a deleted one is; only asking
 * whether the head still names an object at that path tells the two apart.
 */
function unregisteredOf({
  root,
  base,
  head,
}: {
  root: string;
  base: string;
  head: string;
}): Result<void, BaselineComparisonError> {
  return baselineBlobsAt({ rev: base, root }).andThen((baseBlobs) =>
    baselineBlobsAt({ rev: head, root }).andThen((headBlobs) => {
      const refusal = committedBaselineRefusal({ base: baseBlobs, head: headBlobs });
      if (refusal !== undefined) {
        return err(refusal);
      }
      const replacedByTree = [...baseBlobs.keys()].find(
        (path) =>
          isCommittedBumpPath({ path }) &&
          !headBlobs.has(path) &&
          gitSucceeds({ args: ["cat-file", "-e", `${head}:${path}`], root }),
      );
      return replacedByTree === undefined
        ? ok(undefined)
        : err(BaselineComparisonErrors.rewrittenBumpManifest({ path: replacedByTree }));
    }),
  );
}

/**
 * Every ratchet baseline's loosenings between the two commits.
 *
 * @returns the loosenings in registry order, or why a baseline could not be read or decoded
 */
function ratchetLoosenings({
  root,
  base,
  head,
}: {
  root: string;
  base: string;
  head: string;
}): Result<readonly Loosening[], BaselineComparisonError> {
  const loosened: Loosening[] = [];
  for (const baseline of RATCHET_BASELINES) {
    const rows = textAt({ path: baseline.file, rev: base, root }).andThen((baseText) =>
      textAt({ path: baseline.file, rev: head, root }).andThen((headText) =>
        loosenings({ base: baseText, baseline, head: headText }).mapErr((error): BaselineComparisonError => error),
      ),
    );
    if (rows.isErr()) {
      return err(rows.error);
    }
    loosened.push(...rows.value);
  }
  return ok(loosened);
}

/**
 * Every path the two commits differ on.
 *
 * @returns the paths, or why git would not list them
 */
function changedPathsAt({
  root,
  base,
  head,
}: {
  root: string;
  base: string;
  head: string;
}): Result<ReadonlySet<string>, BaselineComparisonError> {
  const changed = gitNulFields({ args: ["diff", "--name-only", "-z", base, head], root });
  if (changed === undefined) {
    return err(BaselineComparisonErrors.unreadable({ path: `git diff ${base} ${head}` }));
  }
  return ok(new Set(changed));
}

/**
 * A policy-file row for every policy file main already had that the change touches.
 *
 * @param changedPaths every path the change differs from main on
 * @returns the rows, in policy-file order
 */
function policyLoosenings({
  root,
  base,
  changedPaths,
}: {
  root: string;
  base: string;
  changedPaths: ReadonlySet<string>;
}): readonly Loosening[] {
  return BASELINE_POLICY_FILES.filter(
    (file) => changedPaths.has(file) && gitSucceeds({ args: ["cat-file", "-e", `${base}:${file}`], root }),
  ).map((file): Loosening => ({ entry: POLICY_ENTRY, file, from: null, to: null }));
}

/**
 * What a change loosened against one commit — every ratchet row and every policy-file row, with the stray check
 * left out. Landing reads it against a record's OWN base when that is an older main commit, so a record cannot
 * name one commit and carry rows measured against another. IO edge.
 *
 * @param root the repository root
 * @param base the commit the rows are measured from
 * @param head the commit measured
 * @returns the loosenings, or why a baseline could not be read or decoded
 */
export function loosenedBetween({
  root,
  base,
  head,
}: {
  root: string;
  base: string;
  head: string;
}): Result<readonly Loosening[], BaselineComparisonError> {
  return ratchetLoosenings({ base, head, root }).andThen((ratchets) =>
    changedPathsAt({ base, head, root }).map((changedPaths) => [
      ...ratchets,
      ...policyLoosenings({ base, changedPaths, root }),
    ]),
  );
}

/**
 * Compare the change's committed baselines against main's. IO edge.
 *
 * @param root the repository root
 * @param base main's commit
 * @param head the change's commit — `HEAD` in CI, where the checkout IS the commit judged
 * @returns what was loosened and what the change touched — or why either could not be read, or the committed
 *   file under `.baselines/` the comparison refuses
 */
export function compareAgainstBase({
  root,
  base,
  head,
}: {
  root: string;
  base: string;
  head: string;
}): Result<BaselineComparison, BaselineComparisonError> {
  for (const rev of [base, head]) {
    if (!gitSucceeds({ args: ["cat-file", "-e", `${rev}^{commit}`], root })) {
      return err(BaselineComparisonErrors.commitUnreachable({ rev }));
    }
  }
  return unregisteredOf({ base, head, root })
    .andThen(() => ratchetLoosenings({ base, head, root }))
    .andThen((ratchets) =>
      changedPathsAt({ base, head, root }).map((changedPaths): BaselineComparison => ({
        changedPaths,
        loosened: [...ratchets, ...policyLoosenings({ base, changedPaths, root })],
      })),
    );
}
