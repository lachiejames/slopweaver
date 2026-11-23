/**
 * Pure diff planning: the exact git argv arrays, and every rule about what we refuse to review.
 *
 * WHY THE HOST COMPUTES THE DIFF. The Codex SDK has no review or diff support — there is no `--base`,
 * `--uncommitted` or `--commit` anywhere in its typed surface (checked in 0.144.5, 0.145.0 and 0.146.0).
 * So scoping is ours. Doing it here rather than asking the model to run `git diff` itself keeps the
 * measured property that made the 51-second review work: the material is complete when the model receives
 * it, so a correct pass makes zero tool calls.
 *
 * WHY WE REFUSE RATHER THAN TRUNCATE. Silent truncation would destroy the only thing a review verdict
 * means. "CLEAN over the first 1MB of your diff" is indistinguishable from "CLEAN" to a reader, and a
 * reviewer who does not know what was omitted cannot calibrate the answer. So every case below either
 * makes it into the prompt whole, or the pass refuses before spending a single token.
 *
 * The byte cap is REQUIRED from the caller and has no default. A cap invented here would be a policy guess
 * (the predecessor's largest measured review input was 84KB, so any round number is unearned), and bytes
 * are a refusal bound rather than a proof of context fit: a small, high-entropy diff can still exceed the
 * model's usable context on top of the ~17-21k fixed baseline every call costs.
 */

import { createHash } from "node:crypto";
import { err, ok, type Result } from "../lib/result.js";

/** The argv for one git invocation. Never a shell string — there is no shell, so quoting cannot go wrong. */
export interface GitCommand {
  readonly args: readonly string[];
}

/** The flags every review-shaped diff is taken with — one list, so the worktree and commit forms cannot drift. */
const TRACKED_DIFF_FLAGS = ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--find-renames"] as const;

/** Why a diff cannot honestly be reviewed. Each is refused BEFORE any model call. */
export type DiffRefusal =
  | { readonly kind: "empty" }
  | { readonly kind: "too-large"; readonly bytes: number; readonly maxBytes: number }
  | { readonly kind: "binary"; readonly paths: readonly string[] }
  | { readonly kind: "submodule"; readonly paths: readonly string[] }
  | { readonly kind: "unmerged"; readonly paths: readonly string[] }
  /**
   * Git's output was not valid UTF-8. Detected at the BYTE level in {@link ../codex/gitDiff}, never by
   * scanning decoded text for U+FFFD: source legitimately containing that character would false-positive,
   * which it did — this repo's own diff fixtures contain one.
   */
  | { readonly kind: "invalid-utf8" };

/**
 * Resolve the repository root — honours a worktree, unlike assuming `cwd`.
 *
 * @returns the `rev-parse --show-toplevel` command
 */
export function gitRepoRootCommand(): GitCommand {
  return { args: ["rev-parse", "--show-toplevel"] };
}

/**
 * Resolve `HEAD`, recorded so a commit landing after capture is detectable.
 *
 * @returns the `rev-parse HEAD` command
 */
export function gitHeadShaCommand(): GitCommand {
  return { args: ["rev-parse", "HEAD"] };
}

/**
 * Resolve the merge base with the review base ref.
 *
 * A three-dot merge base — not a two-dot range — so the diff shows what THIS branch changed, not
 * everything that landed on the base since it forked.
 *
 * @param base the base ref (e.g. `origin/main`)
 * @returns the git command
 */
export function gitMergeBaseCommand({ base }: { base: string }): GitCommand {
  return { args: ["merge-base", base, "HEAD"] };
}

/**
 * The tracked-changes diff against a resolved merge base.
 *
 * Every flag is deliberate: `--no-color` and `--no-pager` keep the output machine-clean; `--no-ext-diff`
 * and `--no-textconv` stop a repo-configured external driver from rewriting what we review (a review of
 * driver output is not a review of the change); `--find-renames` keeps a rename readable instead of a
 * delete plus an add; `--numstat`-free full patch text is what the model actually needs.
 *
 * This compares the merge base to the current WORKTREE, so staged and unstaged edits both participate —
 * which is what a reviewer means by "the changes", and avoids reviewing a commit that no longer matches
 * the files on disk.
 *
 * @param mergeBase the resolved merge-base sha
 * @returns the git command
 */
export function gitTrackedDiffCommand({ mergeBase }: { mergeBase: string }): GitCommand {
  return { args: [...TRACKED_DIFF_FLAGS, mergeBase, "--"] };
}

/**
 * The merge base of a base ref and a COMMIT this checkout need not have checked out.
 *
 * `--end-of-options` because the base ref is read back from a pass record on disk, and a value beginning
 * with `-` must reach git as a revision rather than as a flag.
 *
 * @param base the base ref the review diff was taken against (e.g. `origin/main`)
 * @param commit the commit being judged, as a full object name
 * @returns the git command
 */
export function gitCommitMergeBaseCommand({ base, commit }: { base: string; commit: string }): GitCommand {
  return { args: ["merge-base", "--end-of-options", base, commit] };
}

/**
 * The diff a CLEAN checkout at `commit` would review, taken without checking it out.
 *
 * Byte-identical to {@link gitTrackedDiffCommand} run in a clean checkout sitting at `commit`, because the
 * worktree then IS the commit and a clean checkout has no untracked part to append. MEASURED in a
 * clean worktree — both of these print the same digest:
 *
 * ```bash
 * git diff --no-color --no-ext-diff --no-textconv --find-renames HEAD~5 -- | shasum -a 256
 * git diff --no-color --no-ext-diff --no-textconv --find-renames HEAD~5 HEAD -- | shasum -a 256
 * ```
 *
 * `unit/codex/commitDiffSha.test.ts` is the standing witness against a real repository.
 *
 * @param mergeBase the resolved merge-base sha
 * @param commit the commit being judged
 * @returns the git command
 */
export function gitCommitDiffCommand({ mergeBase, commit }: { mergeBase: string; commit: string }): GitCommand {
  return { args: [...TRACKED_DIFF_FLAGS, mergeBase, commit, "--"] };
}

/**
 * List untracked, non-ignored files, NUL-separated so odd filenames survive.
 *
 * @returns the `ls-files --others` command; `--exclude-standard` keeps ignored files out of the review
 */
export function gitUntrackedCommand(): GitCommand {
  return { args: ["ls-files", "--others", "--exclude-standard", "-z"] };
}

/**
 * List unmerged paths; any hit means the tree is mid-conflict and must not be reviewed.
 *
 * @returns the `diff --diff-filter=U` command; any output at all is a refusal, not a warning
 */
export function gitUnmergedCommand(): GitCommand {
  return { args: ["diff", "--name-only", "--diff-filter=U"] };
}

/**
 * Diff a single untracked file against the null device, so a new file's content is reviewed rather than
 * silently omitted.
 *
 * @param path the untracked file's repo-relative path
 * @returns the git command
 */
export function gitUntrackedDiffCommand({ path }: { path: string }): GitCommand {
  return {
    args: ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-index", "--", nullDevice(), path],
  };
}

/**
 * The platform's null device. Split out so the Windows difference is stated rather than assumed.
 *
 * @returns `NUL` on Windows, else `/dev/null`
 */
export function nullDevice(): string {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

/**
 * Paths git reported as binary, parsed from a patch's own marker lines.
 *
 * A DELETED binary (`Binary files a/x and /dev/null differ`) is not one: the patch already says everything
 * there is to judge, that the file is gone, so nothing was omitted. Refusing it left a branch deleting an
 * icon with no review path at all, Codex or fallback.
 *
 * @param diff the whole patch text
 * @returns the binary paths, deduped — a binary change is refused, because a verdict over a diff that
 *   omitted its content would read the same as one over the whole thing
 */
export function binaryPathsIn({ diff }: { diff: string }): readonly string[] {
  const paths: string[] = [];
  const lines = diff.split("\n");
  lines.forEach((line, index) => {
    if (!line.startsWith("Binary files ") && line !== "GIT binary patch") {
      return;
    }
    if (line.startsWith("Binary files ") && line.endsWith(" and /dev/null differ")) {
      return;
    }
    // Walk back to the nearest `diff --git a/x b/y` header to name the file honestly.
    for (let i = index; i >= 0; i -= 1) {
      const header = lines[i]!;
      if (header.startsWith("diff --git ")) {
        const parts = header.split(" b/");
        const last = parts[parts.length - 1];
        if (last !== undefined && last.length > 0) {
          paths.push(last);
        }
        return;
      }
    }
  });
  return [...new Set(paths)];
}

/**
 * Paths that are submodule pointers — reviewing the pointer sha is not reviewing the change.
 *
 * Matches BOTH markers git uses: the gitlink file mode `160000`, and a `Subproject commit` line. The
 * latter arrives with the patch's own `+`/`-` prefix, which an earlier version of this function missed.
 *
 * @param diff the whole patch text
 * @returns the submodule paths, deduped
 */
export function submodulePathsIn({ diff }: { diff: string }): readonly string[] {
  const paths: string[] = [];
  const lines = diff.split("\n");
  lines.forEach((line, index) => {
    // ANCHORED, and this is not fussiness. An unanchored `includes(" 160000")` matched THIS FILE'S OWN
    // source when the tool reviewed its own diff, because the detector's source contains the marker it
    // looks for. A content scanner must only match git's own metadata lines, never arbitrary added code.
    const isSubprojectLine = /^[+-]Subproject commit [0-9a-f]{7,40}\s*$/.test(line);
    const isGitlinkMode = /^(?:new file mode|deleted file mode|index \S+) 160000$/.test(line);
    if (!isSubprojectLine && !isGitlinkMode) {
      return;
    }
    for (let i = index; i >= 0; i -= 1) {
      const header = lines[i]!;
      if (header.startsWith("diff --git ")) {
        const parts = header.split(" b/");
        const last = parts[parts.length - 1];
        if (last !== undefined && last.length > 0) {
          paths.push(last);
        }
        return;
      }
    }
  });
  return [...new Set(paths)];
}

/**
 * The sha256 of the exact bytes supplied to the model, so the artifact can prove what was judged.
 *
 * @param diff the exact bytes handed to the model, not the working tree
 * @returns the hex digest recorded on the pass artifact
 */
export function diffSha256({ diff }: { diff: string }): string {
  return createHash("sha256").update(diff, "utf8").digest("hex");
}

/**
 * Human-readable refusal text.
 *
 * @returns one line explaining what was refused and why, with the paths involved
 */
export function refusalMessage({ refusal }: { refusal: DiffRefusal }): string {
  switch (refusal.kind) {
    case "empty":
      return "the diff is empty — refusing to ask for a verdict over nothing (a CLEAN over no changes means nothing)";
    case "too-large":
      return (
        `the diff is ${String(refusal.bytes)} bytes, over the --max-diff-bytes cap of ` +
        `${String(refusal.maxBytes)}. Refusing rather than truncating: a verdict over part of a diff is ` +
        "indistinguishable from a verdict over all of it. Narrow the scope or raise the cap deliberately"
      );
    case "binary":
      return `the diff contains binary changes (${refusal.paths.join(", ")}) — refusing rather than sending encoded blobs`;
    case "submodule":
      return (
        `the diff contains submodule pointer changes (${refusal.paths.join(", ")}) — reviewing a pointer sha ` +
        "is not reviewing the submodule's change"
      );
    case "unmerged":
      return `the tree has unmerged paths (${refusal.paths.join(", ")}) — resolve the conflict before reviewing`;
    case "invalid-utf8":
      return "the diff is not valid UTF-8 — refusing rather than replacement-decoding bytes into a review";
  }
}

/**
 * The outcome of applying every refusal rule: an accepted diff, or the first rule that refused it.
 *
 * @internal — `checkDiff`'s return contract. Callers destructure it rather than naming it, and
 * `gitDiff.ts` now names {@link DiffRefusal} directly instead of extracting this union's failure arm.
 */
export type DiffCheck = Result<{ readonly text: string; readonly bytes: number; readonly sha256: string }, DiffRefusal>;

/**
 * Apply every refusal rule to a captured diff, in the cheapest-first order.
 *
 * Order matters for the message a caller sees: an unmerged tree explains an odd diff better than a size
 * complaint would, and "empty" is more useful than "no binary files found". The first rule that applies
 * wins, and nothing is ever truncated to make a rule pass.
 *
 * @param text the combined diff text
 * @param maxBytes the caller-supplied byte cap (required — no default exists anywhere)
 * @param unmergedPaths paths git reported as unmerged
 * @returns the accepted diff with its size and hash, or the refusal
 */
export function checkDiff({
  text,
  maxBytes,
  unmergedPaths,
}: {
  text: string;
  maxBytes: number;
  unmergedPaths: readonly string[];
}): DiffCheck {
  if (unmergedPaths.length > 0) {
    return err<never, DiffRefusal>({ kind: "unmerged", paths: unmergedPaths });
  }
  if (text.trim().length === 0) {
    return err<never, DiffRefusal>({ kind: "empty" });
  }
  const submodules = submodulePathsIn({ diff: text });
  if (submodules.length > 0) {
    return err<never, DiffRefusal>({ kind: "submodule", paths: submodules });
  }
  const binaries = binaryPathsIn({ diff: text });
  if (binaries.length > 0) {
    return err<never, DiffRefusal>({ kind: "binary", paths: binaries });
  }
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maxBytes) {
    return err<never, DiffRefusal>({ bytes, kind: "too-large", maxBytes });
  }
  return ok({ bytes, sha256: diffSha256({ diff: text }), text });
}
