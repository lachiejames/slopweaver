/**
 * The change set a description review is bound to, as a digest that survives a pure rebase and moves on any
 * content change.
 *
 * ## Why not the head commit, and why not `git patch-id`
 *
 * A head sha changes on every rebase, so binding a review to it would ask for a fresh review each time the base
 * moved, and the settled rule is that a rebase leaving the description alone does not. Binding to the body bytes
 * alone goes the other way and lets a changed diff reuse an old review. `git patch-id --stable` sits between them
 * but hashes patch TEXT: a binary file contributes no content to it and a rename is read through similarity, so
 * an image swapped for another can leave it unchanged.
 *
 * This digest is an ordered hash of one tuple per changed path in the merge-base-to-head tree delta: status, old
 * mode, new mode, old blob id, new blob id, path. Blob ids are content addresses, so a binary file is covered
 * exactly like text; modes make a mode-only change visible; `--no-renames` reads a rename as a delete plus an add,
 * so no similarity threshold decides anything. A rebase onto a base that did not touch the changed paths leaves
 * every tuple identical, because the merge base's blob for each of those paths is unchanged. A base that DID
 * change one of those paths changes that path's old blob id, and the review is asked for again: the reviewed
 * content moved.
 *
 * Every git call goes through `../../codex/gitRun.ts`'s `runGitChecked` (argv array, stripped `GIT_*`, pinned
 * config), so the digest depends on the repository and nothing else.
 */
import { createHash } from "node:crypto";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";
import { stableStringify } from "#lib/stableStringify.js";

import { gitCommitDiffCommand } from "../../codex/diff.js";
import { runGitChecked } from "../../codex/gitRun.js";
import { type DescriptionReviewError, DescriptionReviewErrors } from "./descriptionReviewErrors.js";

/** One changed path in a tree delta, exactly as `git diff-tree --raw` reports it. */
export interface TreeDeltaEntry {
  /** `A`, `D`, `M` or `T` (renames are off, so never `R` or `C`). */
  readonly status: string;
  readonly oldMode: string;
  readonly newMode: string;
  readonly oldBlob: string;
  readonly newBlob: string;
  readonly path: string;
}

/** The change set a review is bound to, with the commits it was read between. */
export interface ChangeDigestReading {
  readonly changeDigest: string;
  readonly mergeBaseSha: string;
  readonly headSha: string;
  readonly entries: readonly TreeDeltaEntry[];
}

/** A raw record's metadata half: `:<old mode> <new mode> <old blob> <new blob> <status>`. */
const RAW_META = /^:(\d{6}) (\d{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([ADMT])$/;

/** The version tag hashed with every delta, so a later change to the tuple cannot collide with this one. */
const DIGEST_SCHEMA = "description-change-digest/v1";

/**
 * Parse `git diff-tree -r -z --no-renames --raw --no-abbrev` output into entries.
 *
 * @param raw the command's stdout: NUL-separated metadata and path fields, NUL-terminated
 * @returns every entry in the order git printed them, or the first field it could not read
 */
export function parseTreeDelta({ raw }: { raw: string }): Result<readonly TreeDeltaEntry[], DescriptionReviewError> {
  const fields = raw.split("\0");
  const entries: TreeDeltaEntry[] = [];
  let index = 0;
  while (index < fields.length) {
    const meta = fields[index]!;
    if (meta === "" && index === fields.length - 1) {
      break;
    }
    const match = RAW_META.exec(meta);
    const path = fields[index + 1];
    if (match === null || path === undefined || path === "") {
      return err(DescriptionReviewErrors.changeDigestFailed({ detail: `unreadable tree-delta record "${meta}"` }));
    }
    entries.push({
      newBlob: match[4]!,
      newMode: match[2]!,
      oldBlob: match[3]!,
      oldMode: match[1]!,
      path,
      status: match[5]!,
    });
    index += 2;
  }
  return ok(entries);
}

/**
 * The digest of a tree delta: sha256 over its tuples, sorted by path so the order git happens to print cannot
 * matter.
 *
 * @returns the lowercase hex digest
 */
export function changeDigestOf({ entries }: { entries: readonly TreeDeltaEntry[] }): string {
  const tuples = entries
    .map((entry) => [entry.status, entry.oldMode, entry.newMode, entry.oldBlob, entry.newBlob, entry.path])
    .toSorted((left, right) => (left[5]! < right[5]! ? -1 : Number(left[5]! > right[5]!)));
  return createHash("sha256")
    .update(stableStringify({ value: { entries: tuples, schema: DIGEST_SCHEMA } }), "utf8")
    .digest("hex");
}

/**
 * The tree delta as one line per entry, for the packet the reviewer reads beside the patch.
 *
 * @returns the lines, in digest order
 */
export function treeDeltaLines({ entries }: { entries: readonly TreeDeltaEntry[] }): readonly string[] {
  return entries
    .toSorted((left, right) => (left.path < right.path ? -1 : Number(left.path > right.path)))
    .map(
      (entry) => `${entry.status} ${entry.oldMode} ${entry.newMode} ${entry.oldBlob} ${entry.newBlob} ${entry.path}`,
    );
}

/**
 * The change set as a readable patch, for the packet a reviewer reads. Renames are found here, because a reader
 * follows a moved file better than a delete and an add; the digest above never depends on this text.
 *
 * @param repoDir the checkout the pull request's branch lives in
 * @param mergeBaseSha the merge base the digest was read from
 * @param headSha the head commit the digest was read at
 * @returns the patch, or why git could not produce it
 */
export function changePatch({
  repoDir,
  mergeBaseSha,
  headSha,
}: {
  repoDir: string;
  mergeBaseSha: string;
  headSha: string;
}): Result<string, DescriptionReviewError> {
  try {
    return ok(
      runGitChecked({
        args: gitCommitDiffCommand({ commit: headSha, mergeBase: mergeBaseSha }).args,
        cwd: repoDir,
        label: "git diff",
      }),
    );
  } catch (error: unknown) {
    return err(DescriptionReviewErrors.changeDigestFailed({ detail: errorMessage({ error }) }));
  }
}

/**
 * Read the change set between a base ref's merge base and a head ref in one checkout, and digest it.
 *
 * @param repoDir the checkout the pull request's branch lives in
 * @param baseRef a ref this checkout resolves for the branch being merged into (e.g. `origin/main`)
 * @param headRef the commit being described (e.g. `HEAD`)
 * @returns the digest, the two commits it was read between and the entries, or why git could not say
 */
export function computeChangeDigest({
  repoDir,
  baseRef,
  headRef,
}: {
  repoDir: string;
  baseRef: string;
  headRef: string;
}): Result<ChangeDigestReading, DescriptionReviewError> {
  const run = ({ args }: { args: readonly string[] }): string =>
    runGitChecked({ args, cwd: repoDir, label: `git ${args[0]!}` }).trim();
  try {
    const headSha = run({ args: ["rev-parse", "--verify", "--end-of-options", `${headRef}^{commit}`] });
    const mergeBaseSha = run({ args: ["merge-base", "--end-of-options", baseRef, headSha] });
    const raw = runGitChecked({
      args: ["diff-tree", "-r", "-z", "--no-renames", "--raw", "--no-abbrev", mergeBaseSha, headSha],
      cwd: repoDir,
      label: "git diff-tree",
    });
    return parseTreeDelta({ raw }).map((entries) => ({
      changeDigest: changeDigestOf({ entries }),
      entries,
      headSha,
      mergeBaseSha,
    }));
  } catch (error: unknown) {
    return err(DescriptionReviewErrors.changeDigestFailed({ detail: errorMessage({ error }) }));
  }
}
