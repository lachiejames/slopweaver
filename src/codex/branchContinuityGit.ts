/**
 * The effectful half of branch continuity: read one repository's reflogs and worktree records, and hand the
 * evidence a branch's readers fold through `./branchContinuityView.ts`.
 *
 * ONE `git reflog show --all` covers every branch's reflog and every listed checkout's HEAD reflog, whichever
 * checkout it runs in, so a checkout that has since moved off the branch still proves the cut it made. A HEAD
 * reflog is mapped back to its checkout through the repository's own records: `HEAD` is the checkout the command
 * ran in, `main-worktree/HEAD` the main one, and `worktrees/<id>/HEAD` the one whose `gitdir` file
 * `<common dir>/worktrees/<id>` holds. A `git for-each-ref refs/remotes` read BEFORE it names each remote's
 * default branch, which is never a predecessor, and a remote HEAD on disk it did not list is read with
 * `git symbolic-ref`. The remotes go first because a broken remote ref can fail the reflog read as well, and the
 * error should name the remote.
 *
 * Any failure to RUN git, to list the worktree records, to read one of them or to read a remote HEAD is an error,
 * never an empty or a narrower continuity: a reader that judges a landing or the review cap must not under-count,
 * nor carry a default branch's rows, because a read failed.
 */

import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { safeFs } from "#lib/safeBoundary.js";
import {
  type BranchContinuity,
  type BranchContinuityError,
  BranchContinuityErrors,
  branchContinuations,
  carryWindows,
  defaultBranches,
  parseReflog,
  REFLOG_FORMAT,
  REMOTE_HEADS_FORMAT,
} from "./branchContinuity.js";
import { type BranchEvidence, evidenceForBranch, namesAnotherBranch } from "./branchContinuityView.js";
import type { FallbackReceiptScan } from "./fallbackDocuments.js";
import { runGitChecked } from "./gitRun.js";
import type { LedgerScan } from "./ledgerStore.js";

const DOT_GIT = "/.git";
const REMOTE_HEAD = "/HEAD";

/**
 * A path through its symlinks, as `git rev-parse --show-toplevel` reports a checkout, or the path itself when it
 * no longer exists — a removed checkout git still lists keeps the path its records were taken at.
 *
 * @param path an absolute path
 * @returns the canonical path
 */
function canonical({ path }: { path: string }): string {
  const real = safeFs({ execute: () => realpathSync(path), operation: "codex.branchContinuity.realpath", path });
  return real.isOk() ? real.value : path;
}

/**
 * The checkout one `worktrees/<id>` record names.
 *
 * @param entry the record's directory
 * @returns the checkout's canonical path, or why the record names none: an unmapped HEAD reflog would silently
 *   drop the cuts it proves
 */
function linkedCheckout({ entry }: { entry: string }): Result<string, BranchContinuityError> {
  const gitdir = safeFs({
    execute: () => readFileSync(join(entry, "gitdir"), "utf8"),
    operation: "codex.branchContinuity.gitdir",
  });
  if (gitdir.isErr()) {
    return err(BranchContinuityErrors.worktreesUnreadable({ cause: gitdir.error.message }));
  }
  const pointer = gitdir.value.replace(/[ \t\n\r]+$/u, "");
  if (!pointer.endsWith(DOT_GIT)) {
    return err(BranchContinuityErrors.worktreesUnreadable({ cause: `${entry}/gitdir names no ${DOT_GIT}` }));
  }
  const dotGit = isAbsolute(pointer) ? pointer : resolve(entry, pointer);
  return ok(canonical({ path: dotGit.slice(0, -DOT_GIT.length) }));
}

/**
 * Every HEAD reflog selector `git reflog show --all` prints, mapped to the checkout it belongs to.
 *
 * @param commonDir the repository's absolute common git directory
 * @param ownRoot the checkout the reflog command runs in
 * @returns the map, or the error that left the linked checkouts unlistable or one record unreadable
 */
function headSelectorRoots({
  commonDir,
  ownRoot,
}: {
  commonDir: string;
  ownRoot: string;
}): Result<ReadonlyMap<string, string>, BranchContinuityError> {
  const roots = new Map<string, string>([["HEAD", ownRoot]]);
  if (commonDir.endsWith(DOT_GIT)) {
    roots.set("main-worktree/HEAD", canonical({ path: dirname(commonDir) }));
  }
  const linked = join(commonDir, "worktrees");
  const ids = safeFs({ execute: () => readdirSync(linked), operation: "codex.branchContinuity.worktrees" });
  if (ids.isErr()) {
    // A repository that never added a worktree has no such directory, and that is no linked checkout at all.
    if (ids.error.code === "ENOENT") {
      return ok(roots);
    }
    return err(BranchContinuityErrors.worktreesUnreadable({ cause: ids.error.message }));
  }
  for (const id of ids.value) {
    const checkout = linkedCheckout({ entry: join(linked, id) });
    if (checkout.isErr()) {
      return err(checkout.error);
    }
    roots.set(`worktrees/${id}/HEAD`, checkout.value);
  }
  return ok(roots);
}

/** One git read in the repository being judged, returning its stdout and throwing on a non-zero exit. */
type GitRead = (call: { args: readonly string[] }) => string;

/**
 * The branch names the remotes mark as their default.
 *
 * `git for-each-ref` silently skips a dangling or unreadable ref, so a remote HEAD on disk that it did not list
 * is read with `git symbolic-ref`, which reports a dangling target as it stands and fails on an unreadable one.
 *
 * @param commonDir the repository's absolute common git directory, where the loose remote refs live
 * @param listed `git for-each-ref --format=` {@link REMOTE_HEADS_FORMAT} `refs/remotes` stdout
 * @param run a git read in the repository
 * @returns the default names, or why a remote HEAD could not be read: a narrower set would carry a default's rows
 */
function remoteDefaults({
  commonDir,
  listed,
  run,
}: {
  commonDir: string;
  listed: string;
  run: GitRead;
}): Result<ReadonlySet<string>, BranchContinuityError> {
  const onDisk = safeFs({
    execute: () => readdirSync(join(commonDir, "refs", "remotes"), { encoding: "utf8", recursive: true }),
    operation: "codex.branchContinuity.remoteRefs",
  });
  if (onDisk.isErr()) {
    // A repository that never fetched or set a remote ref has no such directory: nothing on disk to miss.
    if (onDisk.error.code === "ENOENT") {
      return ok(defaultBranches({ text: listed }));
    }
    return err(BranchContinuityErrors.remotesUnreadable({ cause: onDisk.error.message }));
  }
  const shown = new Set(listed.split("\n").map((line) => line.split("\u0000")[0]));
  const unlisted = onDisk.value
    .filter((path) => path.endsWith(REMOTE_HEAD))
    .map((path) => `refs/remotes/${path}`)
    .filter((ref) => !shown.has(ref));
  const read = safeFs({
    execute: () => unlisted.map((ref) => `${ref}\u0000${run({ args: ["symbolic-ref", ref] }).trim()}`),
    operation: "codex.branchContinuity.symbolicRef",
  });
  if (read.isErr()) {
    return err(BranchContinuityErrors.remotesUnreadable({ cause: read.error.message }));
  }
  return ok(defaultBranches({ text: [listed, ...read.value].join("\n") }));
}

/**
 * Read which recorded branch names `target` continues, from the repository `cwd` is a checkout of.
 *
 * @internal exported so the real-git test reads the continuity itself; every reader goes through
 *   {@link readBranchEvidence}.
 *
 * @param cwd any checkout of the repository
 * @param target the branch being judged
 * @returns the continuity, or why the reflogs or the worktree records could not be read
 */
export function readBranchContinuity({
  cwd,
  target,
}: {
  cwd: string;
  target: string;
}): Result<BranchContinuity, BranchContinuityError> {
  const run: GitRead = ({ args }) => runGitChecked({ args, cwd, label: `git ${args.join(" ")}` });
  const paths = safeFs({
    execute: () => ({
      commonDir: run({ args: ["rev-parse", "--path-format=absolute", "--git-common-dir"] }).trim(),
      ownRoot: canonical({ path: run({ args: ["rev-parse", "--show-toplevel"] }).trim() }),
    }),
    operation: "codex.branchContinuity.paths",
  });
  if (paths.isErr()) {
    return err(BranchContinuityErrors.reflogUnreadable({ cause: paths.error.message }));
  }
  const { commonDir, ownRoot } = paths.value;
  // A broken remote ref can fail `reflog show --all` too, so the remotes are read first and name that cause.
  return safeFs({
    execute: () => run({ args: ["for-each-ref", `--format=${REMOTE_HEADS_FORMAT}`, "refs/remotes"] }),
    operation: "codex.branchContinuity.remoteHeads",
  })
    .mapErr((error) => BranchContinuityErrors.remotesUnreadable({ cause: error.message }))
    .andThen((listed) => remoteDefaults({ commonDir, listed, run }))
    .andThen((bases) =>
      safeFs({
        execute: () => run({ args: ["reflog", "show", "--all", "--date=unix", `--format=${REFLOG_FORMAT}`] }),
        operation: "codex.branchContinuity.reflog",
      })
        .mapErr((error) => BranchContinuityErrors.reflogUnreadable({ cause: error.message }))
        .andThen((text) => parseReflog({ text }))
        .andThen((entries) =>
          headSelectorRoots({ commonDir, ownRoot }).map((rootOfHead) => ({
            roots: new Set(rootOfHead.values()),
            target,
            windows: carryWindows({ bases, continuations: branchContinuations({ entries, rootOfHead }), target }),
          })),
        ),
    );
}

/**
 * The evidence `branch`'s readers fold: both scans, with every proven predecessor's rows shown under its name.
 *
 * @param cwd any checkout of the repository the branch belongs to
 * @param branch the branch being judged
 * @param scan every pass record that could be read
 * @param receipts every Claude fallback receipt the scan classified
 * @returns the evidence to fold, or why the continuity could not be read; with no row under another branch name
 *   there is nothing to relabel, so git is not asked
 */
export function readBranchEvidence({
  cwd,
  branch,
  scan,
  receipts,
}: {
  cwd: string;
  branch: string;
  scan: LedgerScan;
  receipts: FallbackReceiptScan;
}): Result<BranchEvidence, BranchContinuityError> {
  if (!namesAnotherBranch({ branch, receipts, scan })) {
    return ok({ receipts, scan });
  }
  return readBranchContinuity({ cwd, target: branch }).map((continuity) =>
    evidenceForBranch({ continuity, receipts, scan }),
  );
}
