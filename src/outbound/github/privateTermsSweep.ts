/**
 * The landing verbs' private-terms sweep: read every file a merge of `headRef` into `baseRef` would add or change, as
 * the exact bytes of the tree the merge would produce, and judge them with the installation's private terms in the
 * build running the verb (`../../hygiene/changeSetPrivateTerms.ts`).
 *
 * ## The failure this exists to catch
 *
 * The repository scan learned the private terms in the pre-push hook, and a branch cut before that commit pushes on
 * its OWN checkout's hook, which applies none. CI holds no terms file by design, and `github merge --admin` lands a
 * branch over a disjoint base move without a rebase, so a private term on such a branch could reach `main` with no
 * scan at any step — the first sign would be every later push failing, after publication. This read runs in the landing
 * verb's own code, so the branch's age decides nothing.
 *
 * ## What is read, and what is not
 *
 * `git merge-tree --write-tree` builds the merged tree without touching a working tree, index or ref, every read
 * ignoring local replacement refs; `git diff-tree -r -z --no-renames` against the base lists every path whose
 * final entry differs, so a renamed or copied destination is just a changed path and correctness owes nothing to
 * rename detection. A deleted path publishes nothing and is skipped. Each blob is read as bytes with `git cat-file`,
 * because a reviewed-residue entry is bound by exact bytes and a decode would break that binding. A symlink's blob is
 * its target text, which is what publishes. A submodule entry has no blob to read, a path that is not UTF-8 cannot be
 * named as it lands, and any read that fails makes the WHOLE change set unreadable — a partial read is never reported
 * clean.
 *
 * The residue, named rather than discovered: git here is not GitHub's merge implementation, so a custom merge driver
 * or attribute could make the two disagree; and the base can still move between this read and GitHub's merge, which
 * pins the head commit and never the base.
 */

import { execFileSync } from "node:child_process";
import { stripGitEnv } from "../../codex/gitRun.js";
import { readReviewedResidue } from "../../freshCut/reviewedResidueStore.js";
import {
  type ChangeSetFile,
  type ChangeSetPrivateTermsVerdict,
  judgeChangeSetPrivateTerms,
  type LandingBase,
  uncheckedChangeSet,
} from "../../hygiene/changeSetPrivateTerms.js";
import { loadPrivateTerms } from "../../hygiene/privateTerms.js";
import { err, ok, type Result } from "../../lib/result.js";
import { GitReadStoppedError } from "./gitReadStopped.js";
import { refResolves } from "./probeSweep.js";

/**
 * How long one git read here may take before it is killed — the bound `./docsBudgetSweep.ts` puts on the same class
 * of local read, for the same reason: a read wedged on a held lock ends rather than blocking the landing for good.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/**
 * The most one git read here may print. A changed blob past it is refused as unreadable rather than truncated: a
 * scan of part of a file reads identically to a scan of all of it.
 */
const GIT_READ_MAX_BYTES = 256 * 1024 * 1024;

/** The tree-entry modes whose blob is published text: a regular file, an executable, a symlink's target. */
const BLOB_MODES: ReadonlySet<string> = new Set(["100644", "100755", "120000"]);

/** Why the merged change set could not be read whole. */
export interface PrivateTermsSweepError {
  readonly code: "REF_UNRESOLVED" | "MERGE_TREE_UNAVAILABLE" | "DIFF_FAILED" | "UNSUPPORTED_ENTRY" | "BLOB_READ_FAILED";
  readonly message: string;
}

/** The factory every {@link PrivateTermsSweepError} is built through. */
export const PrivateTermsSweepErrors = {
  blobReadFailed: ({ path, why }: { path: string; why: string }): PrivateTermsSweepError => ({
    code: "BLOB_READ_FAILED",
    message: `the merged content of ${path} could not be read (${why})`,
  }),
  diffFailed: ({ why }: { why: string }): PrivateTermsSweepError => ({
    code: "DIFF_FAILED",
    message: `the paths the merge changes could not be listed (${why})`,
  }),
  mergeTreeUnavailable: ({ why }: { why: string }): PrivateTermsSweepError => ({
    code: "MERGE_TREE_UNAVAILABLE",
    message: why,
  }),
  refUnresolved: ({ baseRef, headRef }: { baseRef: string; headRef: string }): PrivateTermsSweepError => ({
    code: "REF_UNRESOLVED",
    message: `could not resolve "${baseRef}" and/or "${headRef}" as commits`,
  }),
  unsupportedEntry: ({ path, mode }: { path: string; mode: string }): PrivateTermsSweepError => ({
    code: "UNSUPPORTED_ENTRY",
    message: `${path} lands as a tree entry of mode ${mode}, which has no file content to scan`,
  }),
} as const;

/** One changed path from `git diff-tree --raw -z`: its final mode, its final object and its status letter. */
interface RawChange {
  readonly path: string;
  readonly mode: string;
  readonly object: string;
  readonly status: string;
}

/**
 * Pure: parse `git diff-tree -r -z --no-renames` raw output — `:<old mode> <new mode> <old> <new> <status>` NUL
 * `<path>` NUL, repeated. With renames off every record carries exactly one path.
 *
 * @param output the command's whole stdout
 * @returns every record, in git's order, or `undefined` when the output does not have that shape
 */
export function parseRawDiffTree({ output }: { output: string }): readonly RawChange[] | undefined {
  const fields = output.split("\u0000");
  // A trailing NUL leaves one empty field; anything else left over is a shape this parser does not know.
  if (fields.at(-1) === "") {
    fields.pop();
  }
  if (fields.length % 2 !== 0) {
    return undefined;
  }
  const changes: RawChange[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    const meta = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*$/u.exec(fields[index]!);
    const path = fields[index + 1]!;
    if (meta === null || path.length === 0) {
      return undefined;
    }
    changes.push({ mode: meta[2]!, object: meta[4]!, path, status: meta[5]! });
  }
  return changes;
}

/**
 * Pure: decode bytes as UTF-8, refusing any invalid sequence rather than replacing it.
 *
 * @param bytes the raw output
 * @returns the text, or `undefined` when the bytes are not valid UTF-8
 */
export function strictUtf8({ bytes }: { bytes: Buffer }): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Run one bounded git read in `repo`, returning its stdout bytes; a timeout throws {@link GitReadStoppedError}.
 *
 * `--no-replace-objects` on every read: git otherwise honours a local `refs/replace/<sha>` even for a full object
 * name, so a replacement could make the pinned head, or a changed blob, read as a different object and the change
 * set come back short — and short reads as clean (`../../codex/gitRun.ts` records the same class).
 */
function gitBytes({ repo, args }: { repo: string; args: readonly string[] }): Result<Buffer, string> {
  try {
    return ok(
      execFileSync("git", ["--no-replace-objects", ...args], {
        cwd: repo,
        env: stripGitEnv({ env: process.env }),
        killSignal: "SIGKILL",
        maxBuffer: GIT_READ_MAX_BYTES,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: GIT_READ_TIMEOUT_MS,
      }),
    );
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ETIMEDOUT") {
      throw new GitReadStoppedError(
        `git ${args.join(" ")} was still running after ${String(GIT_READ_TIMEOUT_MS / 60_000)} minutes, so it was stopped`,
      );
    }
    return err(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Read every file a merge of `headRef` into `baseRef` would add or change, as the merged tree's exact bytes. IO edge.
 *
 * @param repo a checkout holding both commits
 * @param baseRef the branch being merged into, as a ref or commit this checkout resolves
 * @param headRef the branch being merged from
 * @returns every changed, non-deleted file with its bytes, or why the change set could not be read whole
 */
export function readMergedChangeSet({
  repo,
  baseRef,
  headRef,
}: {
  repo: string;
  baseRef: string;
  headRef: string;
}): Result<readonly ChangeSetFile[], PrivateTermsSweepError> {
  try {
    return readChangeSet({ baseRef, headRef, repo });
  } catch (error: unknown) {
    if (error instanceof GitReadStoppedError) {
      return err(PrivateTermsSweepErrors.mergeTreeUnavailable({ why: error.message }));
    }
    throw error;
  }
}

/** {@link readMergedChangeSet}'s body; a git read stopped at its bound throws out of it. */
function readChangeSet({
  repo,
  baseRef,
  headRef,
}: {
  repo: string;
  baseRef: string;
  headRef: string;
}): Result<readonly ChangeSetFile[], PrivateTermsSweepError> {
  if (!refResolves({ ref: baseRef, repo }) || !refResolves({ ref: headRef, repo })) {
    return err(PrivateTermsSweepErrors.refUnresolved({ baseRef, headRef }));
  }
  // A conflict exits 1 and any other failure non-zero too: either way there is no clean tree, so nothing is clean.
  const merged = gitBytes({ args: ["merge-tree", "--write-tree", baseRef, headRef], repo });
  if (merged.isErr()) {
    return err(
      PrivateTermsSweepErrors.mergeTreeUnavailable({
        why: `git merge-tree of "${baseRef}" and "${headRef}" wrote no clean tree (${merged.error})`,
      }),
    );
  }
  const listed = gitBytes({
    args: [
      "diff-tree",
      "-r",
      "-z",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      baseRef,
      merged.value.toString("utf8").trim(),
    ],
    repo,
  });
  if (listed.isErr()) {
    return err(PrivateTermsSweepErrors.diffFailed({ why: listed.error }));
  }
  const output = strictUtf8({ bytes: listed.value });
  if (output === undefined) {
    // A path that is not UTF-8 would decode to a different name, so the path judged would not be the path landed.
    return err(PrivateTermsSweepErrors.diffFailed({ why: "a changed path is not valid UTF-8, so it cannot be named" }));
  }
  const changes = parseRawDiffTree({ output });
  if (changes === undefined) {
    return err(PrivateTermsSweepErrors.diffFailed({ why: "git printed a listing this read does not recognise" }));
  }
  return readChangedBlobs({ changes, repo });
}

/** The bytes of every changed, non-deleted path, or the first entry or blob that will not read. */
function readChangedBlobs({
  repo,
  changes,
}: {
  repo: string;
  changes: readonly RawChange[];
}): Result<readonly ChangeSetFile[], PrivateTermsSweepError> {
  const files: ChangeSetFile[] = [];
  for (const change of changes) {
    if (change.status === "D") {
      continue;
    }
    if (!BLOB_MODES.has(change.mode)) {
      return err(PrivateTermsSweepErrors.unsupportedEntry({ mode: change.mode, path: change.path }));
    }
    const blob = gitBytes({ args: ["cat-file", "blob", change.object], repo });
    if (blob.isErr()) {
      return err(PrivateTermsSweepErrors.blobReadFailed({ path: change.path, why: blob.error }));
    }
    files.push({ bytes: blob.value, path: change.path });
  }
  return ok(files);
}

/**
 * Judge the change set a merge of `headRef` into the landing's base would land against the installation's private
 * terms and reviewed residue, both read from `home` by the build running this. IO edge.
 *
 * The terms load FIRST, whatever the base: an unreadable or malformed file is a hold even with no base to read, and
 * an unchecked verdict carries the loaded terms so a reason or detail printed beside it is judged against them.
 *
 * @param repo a checkout holding both commits
 * @param base the commit the landing just fetched, or why it has none
 * @param headRef the pull request's head commit
 * @param home the state home holding the private terms and the reviewed-residue list
 * @returns `hold`, `unchecked` (with why) or `clean`
 */
export function sweepMergePrivateTerms({
  repo,
  base,
  headRef,
  home,
}: {
  repo: string;
  base: LandingBase;
  headRef: string;
  home: string;
}): ChangeSetPrivateTermsVerdict {
  const load = loadPrivateTerms({ home });
  if (load.kind !== "loaded") {
    // Absent is `unchecked` and an unreadable or malformed file a hold, whatever the tree holds: no git is read.
    return judgeChangeSetPrivateTerms({ files: [], load, residue: { entries: [], kind: "read" } });
  }
  if (base.kind === "unfetched") {
    return uncheckedChangeSet({ detail: base.detail, load });
  }
  const files = readMergedChangeSet({ baseRef: base.sha, headRef, repo });
  if (files.isErr()) {
    return uncheckedChangeSet({ detail: `${files.error.message} — the change set was not checked`, load });
  }
  const residue = readReviewedResidue({ home });
  return judgeChangeSetPrivateTerms({
    files: files.value,
    load,
    residue: residue.isOk() ? { entries: residue.value.entries, kind: "read" } : { kind: "unreadable" },
  });
}
