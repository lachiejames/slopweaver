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
 * Bump records live in the state home, which neither CI nor a commit holds, and nowhere else. What this module
 * still refuses is a file under `.baselines/` that nothing judges, at either commit — bar `COMMITTED_BUMP_DIR`,
 * the history of manifests committed before records moved to the home, where a change may leave main's
 * byte-identical or delete one, and is refused for any other write there: a file it ADDS (a rename inside the
 * directory, and a file under a path main held as a record, included), since a committed file declares nothing
 * and would read as though it did, and a REWRITE of one main holds, whose bytes changed or which became a tree.
 * Every such write is the one `REWRITTEN_BUMP_MANIFEST` refusal, its message naming which of the three it was, so
 * the gate (`./baselineAgainstMain.ts`) renders each as its four-line policy refusal. The landing verbs run this
 * comparison before reading any record, so a file it refuses never reaches them.
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
  | { readonly code: "UNDECODABLE_PATH"; readonly message: string; readonly path: string }
  | { readonly code: "UNREGISTERED_BASELINE"; readonly message: string; readonly path: string }
  | { readonly code: "REWRITTEN_BUMP_MANIFEST"; readonly message: string; readonly path: string };

/**
 * How a change wrote under `COMMITTED_BUMP_DIR`: a file main does not hold, main's record moved to a new name
 * there, or main's record given other bytes or turned into a tree.
 */
export type BumpDirectoryWrite =
  { readonly kind: "added" } | { readonly kind: "renamed"; readonly from: string } | { readonly kind: "rewritten" };

/** Where a rise is declared instead of in the tree, which every bump-directory refusal ends on. */
const DECLARE_IN_HOME = "declare the rows with `slopweaver dev baseline-bump`, which records them in the state home";

/**
 * The message a bump-directory refusal carries, naming the write it refuses. Pure.
 *
 * @param path the file under the bump directory at the change's commit
 * @param write how the change wrote it
 * @returns the message
 */
function bumpDirectoryMessage({ path, write }: { path: string; write: BumpDirectoryWrite }): string {
  switch (write.kind) {
    case "added":
      return (
        `${path}: added under .baselines/bumps/, where a file declares nothing, since no landing verb reads a ` +
        `bump record from the tree — delete it, and ${DECLARE_IN_HOME}`
      );
    case "renamed":
      return (
        `${path}: renamed from ${write.from} under .baselines/bumps/, where a file at a new name declares ` +
        `nothing, since no landing verb reads a bump record from the tree — move it back or delete it, and ` +
        DECLARE_IN_HOME
      );
    case "rewritten":
      return (
        `${path}: a bump manifest main holds is never rewritten, since its witness judged these bytes — ` +
        "restore it to main's bytes or delete it, and declare the rows again with `slopweaver dev baseline-bump`"
      );
    default: {
      const unreachable: never = write;
      return unreachable;
    }
  }
}

/** The factory for this module's own failures. */
export const BaselineComparisonErrors = {
  commitUnreachable: ({ rev }: { rev: string }): BaselineComparisonError => ({
    code: "COMMIT_UNREACHABLE",
    message: `commit ${rev} is not in this checkout — fetch it (CI does, at depth 1)`,
  }),
  /**
   * A write under the bump directory that the comparison refuses, whichever of the three it is. Its code keeps
   * the name `REWRITTEN_BUMP_MANIFEST`, which the gate's renderer branches on; the message names the write.
   *
   * @param path the file under the bump directory at the change's commit
   * @param write how the change wrote it, which the message names
   * @returns the refusal
   */
  bumpDirectoryWrite: ({ path, write }: { path: string; write: BumpDirectoryWrite }): BaselineComparisonError => ({
    code: "REWRITTEN_BUMP_MANIFEST",
    message: bumpDirectoryMessage({ path, write }),
    path,
  }),
  unreadable: ({ path }: { path: string }): BaselineComparisonError => ({
    code: "UNREADABLE",
    message: `${path} exists and could not be read`,
    path,
  }),
  undecodablePath: ({ rev, path }: { rev: string; path: string }): BaselineComparisonError => ({
    code: "UNDECODABLE_PATH",
    message:
      `${rev}:${path} names a file under .baselines/ whose path does not decode as UTF-8 (read as U+FFFD), so ` +
      "two different names could compare as one — rename it to a UTF-8 path",
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
 * A path under the bump directory is refused whenever its blob at the head is not the one main has at that path.
 * Either way it is reported as main's record RENAMED when it carries the blob of another of main's records whose
 * old name no longer holds it (deleted, a move to a path under that old name, or two records swapped). Otherwise a
 * path main holds is REWRITTEN, checked first. A file main does not hold is main's record REWRITTEN when it sits
 * under a path main held as a record (that record became a directory), and ADDED otherwise. Bump records come
 * only from the state home, so a file committed there declares nothing and would read as though it did. Main's own
 * untouched or deleted ones are history. Any other file no registry row names is refused at either end.
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
  const bumps = [...head].filter(([path]) => isCommittedBumpPath({ path }));
  const mainBumps = [...base].filter(([held]) => isCommittedBumpPath({ path: held }));
  const movedFrom = ({ path, blob }: { path: string; blob: string }): readonly [string, string] | undefined =>
    mainBumps.find(([held, heldBlob]) => held !== path && heldBlob === blob && head.get(held) !== heldBlob);
  const written = bumps.find(([path, blob]) => {
    const kept = base.get(path);
    return kept !== undefined && kept !== blob;
  });
  if (written !== undefined) {
    const [path, blob] = written;
    const swapped = movedFrom({ blob, path });
    if (swapped !== undefined) {
      return BaselineComparisonErrors.bumpDirectoryWrite({ path, write: { from: swapped[0], kind: "renamed" } });
    }
    return BaselineComparisonErrors.bumpDirectoryWrite({ path, write: { kind: "rewritten" } });
  }
  const added = bumps.find(([path]) => !base.has(path));
  if (added !== undefined) {
    const [path, blob] = added;
    const moved = movedFrom({ blob, path });
    if (moved !== undefined) {
      return BaselineComparisonErrors.bumpDirectoryWrite({ path, write: { from: moved[0], kind: "renamed" } });
    }
    const becameDirectory = mainBumps.find(([held]) => path.startsWith(`${held}/`));
    if (becameDirectory !== undefined) {
      return BaselineComparisonErrors.bumpDirectoryWrite({ path: becameDirectory[0], write: { kind: "rewritten" } });
    }
    return BaselineComparisonErrors.bumpDirectoryWrite({ path, write: { kind: "added" } });
  }
  for (const listed of [base, head]) {
    const stray = strayBaselinesOf({ paths: [...listed.keys()].filter((path) => !isCommittedBumpPath({ path })) })[0];
    if (stray !== undefined) {
      return BaselineComparisonErrors.unregistered({ path: stray });
    }
  }
  return undefined;
}

/** U+FFFD, which a UTF-8 decode puts where a byte sequence does not decode. */
const REPLACEMENT_CHARACTER = String.fromCodePoint(0xfffd);

/**
 * Every file under `.baselines/` at one commit, at any depth and of any extension, with its blob id.
 *
 * Git's output is decoded as UTF-8, so a path whose bytes are not valid UTF-8 reads with U+FFFD in it, and two
 * different such names would read as one key. Every path carrying U+FFFD is refused rather than compared — a
 * genuine U+FFFD in a valid name included, which costs nothing a baseline needs.
 *
 * @returns path to blob, or why git would not list them, or the first path that does not decode
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
    const path = field.slice(tab + 1);
    if (path.includes(REPLACEMENT_CHARACTER)) {
      return err(BaselineComparisonErrors.undecodablePath({ path, rev }));
    }
    blobs.set(path, object);
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
        : err(BaselineComparisonErrors.bumpDirectoryWrite({ path: replacedByTree, write: { kind: "rewritten" } }));
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
