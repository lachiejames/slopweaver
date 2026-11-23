/**
 * Whether the doc's own `repo:` checkout may answer a merged park's finish.
 *
 * Finish resolves its probes against that checkout whenever it does not stand in a linked worktree of it
 * (`../../../handover/probeCheckout.ts`): in the state home once the seat's worktree is gone, and also from a
 * recorded worktree path that still exists but is no longer one — so the wake asks the same
 * classification (`deps.probeTreeOf`) rather than trusting a path that exists. It reads the WORKING TREE, not a
 * commit. So two things must hold before the wake asks it: `HEAD` contains the
 * merge commit GitHub reported — a tree predating the merge can pass a probe the merged change broke — and the tree
 * is clean, untracked files included, so no local edit answers a probe `HEAD` does not. A tree holding an
 * index-flagged file or a submodule is never proven at all, since status cannot vouch for either ({@link indexBlindSpot}). Anything short of that, git failing included, reseats the row exactly as `main` did.
 *
 * **Residue, stated.** A path git ignores is not part of "clean", so a probe on an ignored path reads whatever is on
 * disk; git's own ignore rules decide that, and a checkout's `.git/info/exclude` is one of them. Likewise git
 * compares a file to `HEAD` through the checkout's own content conversions — a clean filter or an end-of-line rule in
 * its local config or `.git/info/attributes` — while a probe reads raw bytes, so a checkout configured to rewrite
 * content is trusted as its owner configured it. What this proves is that the tree is `HEAD`'s, never what `HEAD`'s own
 * content means: a probe follows a symlink `HEAD` itself commits, out of the checkout, exactly as any finish in any
 * checkout does. Nor does git status report an untracked FIFO or socket, so one
 * made in the checkout on purpose answers a `path:` probe unseen: nothing the fleet
 * or a build does leaves one there, and a walk of the whole tree to find one would cost every row its tick. The
 * boundary is the same for history: replacement refs are ignored,
 * but a checkout whose `.git` was forged on purpose — a graft file, a rewritten object or
 * ref — is beyond what any read of it can prove, and anyone able to forge it could edit the tree a probe reads
 * directly. The `repo:` is the one the board scan read, so the child carries it as `--probed-repo` and refuses when the doc it re-reads names
 * another; the classification is the one this wake made, so the child carries it
 * as `--probed-tree` and reads every probe not-evaluated when its own differs. And the tree
 * is read once, before the
 * child launches: a reset or edit landing after that read, during the child's one minute, is the same exposure any
 * finish run in that checkout has.
 */
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { stripGitEnv } from "../../../codex/gitRun.js";
import { type ProbeCheckout, probeCheckout } from "../../../handover/probeCheckout.js";
import { removeScratch } from "../supervisor/scratchChild.js";
import {
  INDEX_HEAD_BYTES,
  indexBlindSpot,
  NEWLINE,
  NUL,
  recordHeads,
  STATUS_HEAD_BYTES,
  statusSnapshot,
} from "./wakeMergeScan.js";

/**
 * Each git read's budget — the same two minutes `../github/gitAncestry.ts` gives its own; a read past it is killed
 * and reads as git failing, so the row reseats rather than the wake stalling on a prompt nobody sees.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/**
 * What a checkout proves about a merge: `HEAD` holds it on a clean tree, `HEAD` lacks it, the tree is dirty, or its
 * cleanliness cannot be read at all — the index tells git not to check some tracked file, or the tree holds a
 * submodule whose own tree status never vouches for.
 */
export type MergeProof = "held" | "missing" | "dirty" | "hidden" | "nested";

/** Which tree a finish run from `cwd` would probe, in `probeCheckout`'s own terms. */
export type ReadProbeTree = (args: { cwd: string; docRepo: string }) => ProbeCheckout["kind"];

/**
 * The production classification: exactly the one `handover finish` itself makes from that directory.
 *
 * @param cwd the directory the finish child would stand in
 * @returns whether its probes read the seat's own worktree or the doc's repo
 */
export function productionProbeTree({ cwd, docRepo }: { cwd: string; docRepo: string }): ProbeCheckout["kind"] {
  return probeCheckout({ cwd, docRepo }).kind;
}

/**
 * The one status read: `HEAD`'s commit and every change, whatever the repository's config would hide.
 * `--ignore-submodules=none` overrides a setting that hides a moved gitlink,
 * `--untracked-files=all` overrides `status.showUntrackedFiles`, and `core.fsmonitor=false` makes git stat the tree
 * itself rather than trust a monitor's possibly stale answer. The stat-cache settings are pinned to git's defaults,
 * so a repository's own `core.checkStat=minimal` or `core.trustctime=false` cannot pass a same-size edit whose mtime
 * was put back — the ctime such an edit moves is the one field no unprivileged writer restores —
 * and `core.ignoreStat` and `core.untrackedCache` are off, so neither a stat-free index nor a cached directory scan
 * answers in place of the tree. `core.fileMode` and `core.symlinks` are on, so a mode or file-type change the
 * repository's own config would wave through reads dirty; on a filesystem that truly lacks
 * either, that reads every such entry dirty, and the row reseats as it did before. `core.ignoreCase` stays the
 * repository's own: it describes the filesystem rather than relaxing a comparison, and on a case-insensitive one a
 * case-only rename leaves every path a probe reads resolving to `HEAD`'s bytes.
 * The question pass's worktree read (`./wakeWorktreeCommit.ts`) asks the same status for the same reason.
 */
export const STATUS_ARGS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.fileMode=true",
  "-c",
  "core.symlinks=true",
  "-c",
  "core.checkStat=default",
  "-c",
  "core.trustctime=true",
  "-c",
  "core.ignoreStat=false",
  "-c",
  "core.untrackedCache=false",
  "status",
  "--porcelain=v2",
  "--branch",
  "--untracked-files=all",
  "--ignore-submodules=none",
] as const;

/**
 * Every index entry with its tag and mode (`<tag> <mode> <object> <stage>\t<path>`), NUL-separated, so a flag telling
 * git not to look at a file, and a submodule, are both visible.
 */
const INDEX_ARGS = ["ls-files", "-v", "-s", "-z"] as const;

/** How much of git's output file one read takes: a bounded chunk, never the whole listing (`./wakeMergeScan.ts`). */
const SCAN_CHUNK_BYTES = 64 * 1024;

/** How much of a failed git read's stderr its error carries; git's own refusals are one or two lines. */
const GIT_STDERR_MAX_BYTES = 64 * 1024;

/**
 * What in the checkout's index stops status vouching for its tree, read now.
 *
 * @param dir the checkout
 * @returns the blind spot, `undefined` for none, or what git said when it could not list the index
 */
export function indexBlind({ dir }: { dir: string }): Result<"hidden" | "nested" | undefined, { message: string }> {
  return gitScan({
    args: INDEX_ARGS,
    dir,
    scan: ({ chunks }) =>
      indexBlindSpot({ entries: recordHeads({ chunks, delimiter: NUL, headBytes: INDEX_HEAD_BYTES }) }),
  });
}

/**
 * The output file read one bounded chunk at a time.
 *
 * @param fd the open output file
 * @returns each chunk, in order
 */
function* fileChunks({ fd }: { fd: number }): Generator<Uint8Array> {
  const buffer = Buffer.alloc(SCAN_CHUNK_BYTES);
  for (;;) {
    const read = readSync(fd, buffer, 0, SCAN_CHUNK_BYTES, null);
    if (read === 0) {
      return;
    }
    yield buffer.subarray(0, read);
  }
}

/**
 * One git read in `dir`, with the caller's git environment stripped and its stdout streamed to a private file rather
 * than a string, so the read is as large as the checkout needs (`./wakeMergeScan.ts` carries the measurement). The
 * file is scanned once git has exited, and removed whatever happened.
 *
 * @param args git's arguments
 * @param scan what the read is for, over git's stdout as bounded chunks
 * @returns the scan's verdict, or what git said when it failed
 */
function gitScan<T>({
  args,
  dir,
  scan,
}: {
  args: readonly string[];
  dir: string;
  scan: (input: { chunks: Iterable<Uint8Array> }) => T;
}): Result<T, { message: string }> {
  let scratch: string;
  try {
    scratch = mkdtempSync(join(tmpdir(), "slopweaver-merge-proof-"));
  } catch (cause) {
    return err({ message: cause instanceof Error ? cause.message : `git ${args.join(" ")} had no scratch directory` });
  }
  const path = join(scratch, "stdout");
  try {
    const out = openSync(path, "wx");
    let result: ReturnType<typeof spawnSync>;
    try {
      result = spawnSync("git", [...args], {
        cwd: dir,
        env: stripGitEnv({ env: process.env }),
        killSignal: "SIGKILL",
        maxBuffer: GIT_STDERR_MAX_BYTES,
        stdio: ["ignore", out, "pipe"],
        timeout: GIT_READ_TIMEOUT_MS,
      });
    } finally {
      closeSync(out);
    }
    const failed = gitFailure({ args, result });
    if (failed !== undefined) {
      return err({ message: failed });
    }
    const input = openSync(path, "r");
    try {
      return ok(scan({ chunks: fileChunks({ fd: input }) }));
    } finally {
      closeSync(input);
    }
  } catch (cause) {
    return err({ message: cause instanceof Error ? cause.message : `git ${args.join(" ")} failed` });
  } finally {
    removeScratch({ dir: scratch });
  }
}

/**
 * Why a finished git read failed: a launch error, a signal, or a non-zero
 * exit with git's stderr.
 *
 * @param result the finished child
 * @returns the failure, or `undefined` on exit 0
 */
function gitFailure({
  args,
  result,
}: {
  args: readonly string[];
  result: ReturnType<typeof spawnSync>;
}): string | undefined {
  if (result.error !== undefined) {
    return result.error.message;
  }
  if (result.status === 0) {
    return undefined;
  }
  const how = result.status === null ? `killed by ${String(result.signal)}` : `exit ${String(result.status)}`;
  const stderr = String(result.stderr).trim();
  return `git ${args.join(" ")} ended ${how}${stderr === "" ? "" : `: ${stderr}`}`;
}

/** Reads what a checkout proves about one merge commit. */
export type ReadMergeProof = (args: { dir: string; oid: string }) => Result<MergeProof, { readonly message: string }>;

/**
 * The production read. `HEAD`'s commit and the tree's cleanliness come from ONE `git status` document, and the
 * ancestry is then asked of that commit rather than of `HEAD`: a commit never moves, so a reset landing between
 * the two commands cannot pair a clean tree with a `HEAD` that never held the merge. The index
 * flags are read on BOTH sides of that status read: a file git is told not to check makes the tree unprovable
 * (`hidden`), whatever status says, and a flag set while status ran is still there for the second read. Only a flag set and cleared again inside that window escapes, the edit-after-the-read residue above.
 *
 * @param dir the checkout the finish would probe
 * @param oid the merge commit GitHub reported
 * @returns the proof, or what git said when it could not answer
 */
export function productionMergeProof({
  dir,
  oid,
}: {
  dir: string;
  oid: string;
}): Result<MergeProof, { message: string }> {
  const before = indexBlind({ dir });
  if (before.isErr() || before.value !== undefined) {
    return before.map((blind): MergeProof => blind!);
  }
  const snapshot = gitScan({
    args: STATUS_ARGS,
    dir,
    scan: ({ chunks }) =>
      statusSnapshot({ lines: recordHeads({ chunks, delimiter: NEWLINE, headBytes: STATUS_HEAD_BYTES }) }),
  });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const after = indexBlind({ dir });
  if (after.isErr() || after.value !== undefined) {
    return after.map((blind): MergeProof => blind!);
  }
  const { clean, headOid } = snapshot.value;
  if (!clean) {
    return ok("dirty");
  }
  if (headOid === undefined) {
    return ok("missing");
  }
  return headHolds({ dir, headOid, oid }).map((held): MergeProof => (held ? "held" : "missing"));
}

/**
 * Whether `headOid`'s real history holds `oid`, with replacement refs ignored: a `refs/replace/` entry can give a
 * commit a parent it never had, and git's ordinary ancestry read follows it. Exit 1 is git's
 * "not an ancestor"; any other failure is a fault, never read as one, and carries git's own stderr — a merge commit
 * the checkout does not have is `fatal: Not a valid object name …`, which is the reason the row has to name.
 *
 * @param headOid the commit the status read saw `HEAD` on
 * @param oid the merge commit GitHub reported
 * @returns whether the merge is in that commit's history, or what git said when it could not answer
 */
function headHolds({
  dir,
  headOid,
  oid,
}: {
  dir: string;
  headOid: string;
  oid: string;
}): Result<boolean, { message: string }> {
  const args = ["--no-replace-objects", "merge-base", "--is-ancestor", `${oid}^{commit}`, `${headOid}^{commit}`];
  const result = spawnSync("git", args, {
    cwd: dir,
    env: stripGitEnv({ env: process.env }),
    killSignal: "SIGKILL",
    maxBuffer: GIT_STDERR_MAX_BYTES,
    stdio: ["ignore", "ignore", "pipe"],
    timeout: GIT_READ_TIMEOUT_MS,
  });
  if (result.error === undefined && result.status === 1) {
    return ok(false);
  }
  const failed = gitFailure({ args, result });
  return failed === undefined ? ok(true) : err({ message: failed });
}

/**
 * Why a finish whose probes would read the doc's own `repo:` would read a tree not proven to hold the merge: the read
 * carried no merge commit, the checkout lacks it or is dirty, or git could not say.
 *
 * @param docRepo the doc's `repo:`, the checkout that finish's probes resolve against
 * @param mergeCommitOid the merge commit the checks read reported
 * @param mergeProof reads what that checkout proves about the merge
 * @returns the reason the finish is not asked, or `undefined` when the checkout holds the merge on a clean tree
 */
export function docRepoUnproven({
  docRepo,
  mergeCommitOid,
  mergeProof,
}: {
  docRepo: string;
  mergeCommitOid: string | undefined;
  mergeProof: ReadMergeProof;
}): string | undefined {
  if (mergeCommitOid === undefined) {
    return `its probes would read ${docRepo}, and the read carried no merge commit to find there`;
  }
  const proof = mergeProof({ dir: docRepo, oid: mergeCommitOid });
  if (proof.isErr()) {
    return `its probes would read ${docRepo}, which could not say whether it holds ${mergeCommitOid}: ${proof.error.message}`;
  }
  if (proof.value === "missing") {
    return `its probes would read ${docRepo}, which does not hold the merge ${mergeCommitOid} yet`;
  }
  if (proof.value === "dirty") {
    return `its probes would read ${docRepo}, which holds uncommitted changes a probe could read`;
  }
  if (proof.value === "hidden") {
    return `its probes would read ${docRepo}, which marks tracked files assume-unchanged or skip-worktree, so git cannot say they are clean`;
  }
  if (proof.value === "nested") {
    return `its probes would read ${docRepo}, which holds a submodule whose own tree its status does not vouch for`;
  }
  return undefined;
}
