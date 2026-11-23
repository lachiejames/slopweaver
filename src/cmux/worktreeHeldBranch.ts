/**
 * The branches a DETACHED worktree still holds, because git is rebasing or bisecting it there.
 *
 * MEASURED, on a landing-row spawn that was refused: a finished run's worktree stopped on an
 * interactive rebase conflict. `git worktree list --porcelain` printed it `detached` with no `branch` line, so
 * the spawn's branch lookup missed it, planned "create", and `git worktree add` refused with "is already used by
 * worktree" — git's wording for a branch held by a rebase or bisect, distinct from "already checked out at".
 * Repro: in a linked worktree, `git rebase <onto>` to a conflict, then `git worktree list --porcelain` and
 * `git worktree add --no-checkout <dir> <branch>` from the main checkout.
 *
 * This reads the same state git's own `is_shared_symref` does (`worktree.c`, via `wt-status.c`): a
 * `rebase-apply/` directory WITHOUT `rebase-apply/applying` (that is `git am`), else `rebase-merge/`, each naming
 * the branch in `head-name`; then, independently, a bisect, which needs `BISECT_LOG` and names its starting point
 * in `BISECT_START`. Both names pass through git's `get_branch`, mirrored by {@link gitBranchName}, and git compares
 * the result verbatim with the branch's short name. `rebase --update-refs` adds no hold: its ledger is deferred
 * updates, not this tree's branch.
 *
 * **Every read here is total: a path this process cannot read, whatever the reason, is no hold known.** This runs
 * inside EVERY operational worktree listing, so one unreadable tree throwing would empty the inventory and prune of
 * every other. Review found two such throws in a row (a `chmod 000` tree, a `head-name` that is a directory), each
 * by a different error code, so the class is closed rather than its codes listed. A hold missed that way leaves a
 * spawn exactly where it stood before this read existed: at git's own refusal, which names the tree. The one strict
 * reader is {@link heldBranchesAnywhere}, a deletion's question, where each state's single read reports "there but
 * unreadable" rather than no hold.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { gitEnv } from "../lib/gitRepo.js";

/** How one repository names its objects, as far as reading a held branch needs: git's own answers in production. */
export interface ObjectIds {
  /** Shortens a full object id the way git's `strbuf_add_unique_abbrev(DEFAULT_ABBREV)` does, or `null` when it cannot. */
  readonly abbreviate: (request: { objectId: string }) => string | null;
  /** A full object id's hex length there — 40 under SHA-1, 64 under SHA-256 — asked only when a name could be one. */
  readonly hexLength: () => number;
}

/**
 * The bound on each git read here, matching `src/lib/gitRepo.ts`'s `GIT_READ_TIMEOUT_MS`: local work that
 * answers in well under a second, ended rather than left to block a listing on a held lock.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/** A SHA-1 object id's hex length, the shortest any object format has; `get_oid_hex` ignores what follows it. */
const SHA1_HEX_LENGTH = 40;

/** A SHA-256 object id's hex length. */
const SHA256_HEX_LENGTH = 64;

/** A file's whole text, or `null` when it cannot be read as a file for any reason. */
function readText({ path }: { path: string }): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null; // Total by design, see the header: unreadable is no hold known.
  }
}

/** The entry names in a directory, or none when it cannot be listed for any reason. */
function readDirNames({ path }: { path: string }): readonly string[] {
  try {
    return readdirSync(path);
  } catch {
    return []; // Total by design, see the header.
  }
}

/**
 * The git directories git itself keeps for one listed worktree, found through the REPOSITORY's own records as git's
 * `get_worktrees` finds them: the common directory for the main checkout, else every `worktrees/<id>` entry whose
 * `gitdir` file names this worktree's `.git` — resolved against that entry when relative, as
 * `worktree.useRelativePaths` writes it. Never through the `.git` at the listed path: a moved checkout can leave
 * another repository's tree there, and a tree this process cannot read hides its own.
 * Every entry, not the first: `git worktree add --force` over a missing tree's path records a second one naming the
 * same path, git lists both, and its refusal reads each one's state.
 *
 * @param commonDir the repository's absolute common git directory, as `rev-parse --path-format=absolute` prints it
 * @param worktreePath the worktree's path exactly as `git worktree list --porcelain` printed it
 * @returns the worktree's own git directories, in directory order — empty when the repository records none there
 */
export function worktreeAdminDirs({
  commonDir,
  worktreePath,
}: {
  commonDir: string;
  worktreePath: string;
}): readonly string[] {
  // `get_main_worktree` strips a trailing `/.git` from the common directory, else lists that directory itself — a
  // `--separate-git-dir` checkout. Never an early return: a linked record naming the main
  // checkout's own path is listed too, and git reads its state.
  const main = listedPathOf({ record: commonDir }) === worktreePath ? [commonDir] : [];
  const linked = join(commonDir, "worktrees");
  const records = readDirNames({ path: linked })
    .filter((id) => {
      const record = recordedDotGit({ entry: join(linked, id) });
      return record !== null && listedPathOf({ record }) === worktreePath;
    })
    .map((id) => join(linked, id));
  return [...main, ...records];
}

/**
 * The path git LISTS for a recorded `.git` location: the record with one trailing `/.git` stripped, else the record
 * itself, compared as text. Never through `join`, which collapses `..`: git keeps an absolute record verbatim and
 * prints `/outside/x/../wt`, so a normalised comparison matched no record and hid its hold.
 */
function listedPathOf({ record }: { record: string }): string {
  return record.endsWith("/.git") ? record.slice(0, -"/.git".length) : record;
}

/** The `.git` path one `worktrees/<id>` entry's `gitdir` file records, absolute, or `null` when it records none. */
function recordedDotGit({ entry }: { entry: string }): string | null {
  // `get_linked_worktree` reads this record with `strbuf_rtrim`, so all trailing whitespace goes
  // — git's own `isspace` (`ctype.c`): space, tab, LF and CR, never a Unicode space.
  const pointer = readText({ path: join(entry, "gitdir") })?.replace(/[ \t\n\r]+$/u, "");
  if (pointer === undefined || pointer.length === 0) {
    return null;
  }
  if (isAbsolute(pointer)) {
    return pointer;
  }
  // A RELATIVE record is canonicalised (`strbuf_realpath_forgiving`), so a symlink on its way lists the tree at the
  // real path, while an absolute record is taken as written.
  return forgivingRealpath({ path: resolve(entry, pointer) });
}

/**
 * `path` with every symlink resolved, as git's `strbuf_realpath_forgiving` does: when the tail is missing (a prunable
 * tree's record still names it) the longest existing prefix is resolved and the rest kept as written.
 */
function forgivingRealpath({ path }: { path: string }): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    if (parent === path) {
      return path;
    }
    return join(forgivingRealpath({ path: parent }), basename(path));
  }
}

/**
 * The name git's `get_branch` (`wt-status.c`) reads out of a rebase's `head-name` or a bisect's `BISECT_START`, which
 * `is_shared_symref` then compares verbatim with a branch's short name.
 *
 * Trailing LF only is stripped, and an empty file holds nothing. `refs/heads/<b>` is `<b>`; any other `refs/` name is
 * kept whole, so it can only ever equal a branch literally called that. A value whose first full-id-length characters
 * are hex (forty under SHA-1, sixty-four under SHA-256) is an object id, which git SHORTENS to its unique abbreviation
 * (reproduced on git 2.54.0: a bisect started on a detached HEAD held `aaaaaaa`, never the forty-character
 * name) — so a full id holds only the branch named by its abbreviation, and one git cannot abbreviate holds nothing
 * known. `detached HEAD` holds nothing; anything else is kept verbatim, which is how a hex-named branch shorter than
 * an id stays held, a forty-hex one in a SHA-256 repository included.
 *
 * Residue, stated: git abbreviates an id its object store does not have, and `rev-parse --short` refuses one, so a
 * hand-written `BISECT_START` naming a missing object holds nothing known here — git itself only ever records a
 * commit it has.
 *
 * @param text the state file's whole contents, or `null` when it could not be read
 * @param objectIds how the repository's object ids are measured and shortened
 * @returns the held name, or `null` when the file holds no branch
 */
export function gitBranchName({ objectIds, text }: { objectIds: ObjectIds; text: string | null }): string | null {
  if (text === null) {
    return null;
  }
  const name = text.replace(/\n+$/u, "");
  if (name.length === 0) {
    return null;
  }
  if (name.startsWith("refs/heads/")) {
    return name.slice("refs/heads/".length);
  }
  if (name.startsWith("refs/")) {
    return name;
  }
  const objectId = leadingObjectId({ name, objectIds });
  if (objectId !== null) {
    return objectIds.abbreviate({ objectId });
  }
  if (name === "detached HEAD") {
    return null;
  }
  return name;
}

/**
 * The full object id a held name opens with, as `get_oid_hex` parses it in this repository's object format — or
 * `null`. The format is asked only once a name opens with forty hex digits, the shortest any format's id is.
 */
function leadingObjectId({ name, objectIds }: { name: string; objectIds: ObjectIds }): string | null {
  if (!new RegExp(`^[0-9a-fA-F]{${SHA1_HEX_LENGTH}}`, "u").test(name)) {
    return null;
  }
  const length = objectIds.hexLength();
  if (!new RegExp(`^[0-9a-fA-F]{${length}}`, "u").test(name)) {
    return null;
  }
  return name.slice(0, length);
}

/**
 * The branches git holds for a worktree while it is rebasing or bisecting there, read from its git directory.
 *
 * Git asks the rebase and the bisect INDEPENDENTLY, so both are read: a rebase started from the HEAD a
 * bisect detached holds nothing itself and leaves the bisect's branch held, and a rebase of ANOTHER branch started
 * mid-bisect holds two at once, each of which git refuses elsewhere.
 *
 * @param gitDir the worktree's own git directory, one of those {@link worktreeAdminDirs} resolves
 * @param objectIds how the repository's object ids are measured and shortened, git's own answers in production
 * @returns every branch held there, the rebase's first, deduplicated — empty when no rebase or bisect holds one
 */
export function heldBranchesInGitDir({
  gitDir,
  objectIds,
}: {
  gitDir: string;
  objectIds: ObjectIds;
}): readonly string[] {
  return branchesOf({ holds: holdReads({ gitDir, objectIds }) });
}

/** What one hold read found: the branch held, `null` for none, or `unknown` when its state was there but unreadable. */
type HoldRead = { readonly kind: "branch"; readonly branch: string | null } | { readonly kind: "unknown" };

/** The read of a state that is there but cannot be read. */
const UNKNOWN_HOLD: HoldRead = { kind: "unknown" };

/** The read of no hold at all. */
const NO_HOLD: HoldRead = { branch: null, kind: "branch" };

/** A git directory's rebase hold, then its bisect hold, each read exactly once. */
function holdReads({ gitDir, objectIds }: { gitDir: string; objectIds: ObjectIds }): readonly HoldRead[] {
  return [rebaseHold({ gitDir, objectIds }), bisectHold({ gitDir, objectIds })];
}

/** The branches some hold reads name, deduplicated, reading an unknown one as no hold — the listing's total reading. */
function branchesOf({ holds }: { holds: readonly HoldRead[] }): readonly string[] {
  const held = holds.flatMap((hold) => (hold.kind === "branch" && hold.branch !== null ? [hold.branch] : []));
  return [...new Set(held)];
}

/** Whether a state path is there, absent, or there in a way `stat` cannot answer. */
function statePath({ path }: { path: string }): "present" | "absent" | "unknown" {
  try {
    statSync(path);
    return "present";
  } catch (error) {
    return isAbsence({ error }) ? "absent" : "unknown";
  }
}

/**
 * The branch a naming file holds, from ONE read, asked only once its state path is present: unknown when that read
 * fails for ANY reason, a missing file included. The state path is there, so a name that cannot be read is a state
 * that cannot be read, not one that is not running (`ENOTDIR`, then `ENOENT`) — git itself
 * would hold nothing there, and a deletion keeping the branch is the cheap side of that disagreement.
 */
function namedHold({ objectIds, path }: { objectIds: ObjectIds; path: string }): HoldRead {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return UNKNOWN_HOLD;
  }
  return { branch: gitBranchName({ objectIds, text }), kind: "branch" };
}

/**
 * The branch a rebase in a git directory holds: `rebase-apply` unless it is `git am`, else `rebase-merge`. Git's
 * `wt_status_check_rebase` makes the two EXCLUSIVE, and asks each with a bare `stat`, so ANY `rebase-apply` path —
 * a `git am`'s, which holds nothing, or not even a directory — shadows a `rebase-merge` beside it.
 */
function rebaseHold({ gitDir, objectIds }: { gitDir: string; objectIds: ObjectIds }): HoldRead {
  const apply = join(gitDir, "rebase-apply");
  const applyState = statePath({ path: apply });
  if (applyState === "unknown") {
    return UNKNOWN_HOLD;
  }
  if (applyState === "present") {
    const applying = statePath({ path: join(apply, "applying") });
    if (applying === "unknown") {
      return UNKNOWN_HOLD;
    }
    if (applying === "present") {
      return NO_HOLD;
    }
    return namedHold({ objectIds, path: join(apply, "head-name") });
  }
  const merge = join(gitDir, "rebase-merge");
  const mergeState = statePath({ path: merge });
  if (mergeState === "unknown") {
    return UNKNOWN_HOLD;
  }
  if (mergeState === "present") {
    return namedHold({ objectIds, path: join(merge, "head-name") });
  }
  return NO_HOLD;
}

/** The name a bisect in a git directory holds: `BISECT_START`, only while `BISECT_LOG` says one is running. */
function bisectHold({ gitDir, objectIds }: { gitDir: string; objectIds: ObjectIds }): HoldRead {
  const log = statePath({ path: join(gitDir, "BISECT_LOG") });
  if (log === "unknown") {
    return UNKNOWN_HOLD;
  }
  if (log === "absent") {
    return NO_HOLD;
  }
  return namedHold({ objectIds, path: join(gitDir, "BISECT_START") });
}

/** One bounded git read run from a directory, its trimmed stdout, or `null` when git fails for any reason. */
function gitRead({ args, cwd }: { args: readonly string[]; cwd: string }): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: gitEnv(),
      killSignal: "SIGKILL",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_READ_TIMEOUT_MS,
    }).trim();
  } catch {
    return null; // Total by design, see the header: a git that cannot answer is no hold known.
  }
}

/**
 * Git's own answers, asked from the directory whose git would refuse the branch: `rev-parse --short` calls the same
 * `find_unique_abbrev` at the same `DEFAULT_ABBREV`, reading that worktree's `core.abbrev`, a worktree-specific one
 * included — and abbreviates the RAW id even when a ref shares its full-length name, since
 * `get_oid_basic` reads full-length hex as an id first and only warns, on the stderr discarded here (MEASURED on
 * git 2.54.0, `subprocess/cmux/worktree.test.ts`'s abbreviation case). `rev-parse --show-object-format` names the
 * format whose `get_oid_hex` reads the state files, read at most once and only when a name could be an id.
 */
function gitObjectIds({ cwd }: { cwd: string }): ObjectIds {
  let hexLength: number | undefined;
  return {
    abbreviate: ({ objectId }) => {
      const short = gitRead({ args: ["rev-parse", "--short", objectId], cwd });
      if (short === null || short.length === 0) {
        return null; // A missing object is no hold known.
      }
      return short;
    },
    hexLength: () => {
      if (hexLength === undefined) {
        const format = gitRead({ args: ["rev-parse", "--show-object-format"], cwd });
        // A git that cannot say reads as SHA-1, git's default; its abbreviate then fails too, so no hold is known.
        hexLength = format === "sha256" ? SHA256_HEX_LENGTH : SHA1_HEX_LENGTH;
      }
      return hexLength;
    },
  };
}

/** The repository a worktree listing was read in: where its records live, and where its git ran. */
export interface ListingRepository {
  /** The absolute common git directory, as `rev-parse --path-format=absolute --git-common-dir` prints it. */
  readonly commonDir: string;
  /** The directory the listing's git ran in — the one whose `git worktree add` would refuse a held branch. */
  readonly cwd: string;
}

/**
 * The branches a detached worktree still holds, because a rebase or bisect in it holds them.
 *
 * @param repository where the worktree's records live and whose git configuration abbreviates an id
 * @param worktreePath the worktree's path exactly as `git worktree list --porcelain` printed it
 * @returns every held branch across every record naming the path, a rebase's first — empty when none is held or the
 * repository records no such tree
 */
export function readHeldBranches({
  repository,
  worktreePath,
}: {
  repository: ListingRepository;
  worktreePath: string;
}): readonly string[] {
  const gitDirs = worktreeAdminDirs({ commonDir: repository.commonDir, worktreePath });
  if (gitDirs.length === 0) {
    return [];
  }
  return heldBranchesIn({ gitDirs, repository });
}

/**
 * Every branch a rebase or bisect holds ANYWHERE in a repository: the common directory and each `worktrees/<id>`
 * entry, read without mapping a listed path to its entry. The question a branch DELETION asks, since `update-ref`
 * skips git's refusal: a path lookup misses a snapshot slot the operational listing hides, and two records naming
 * one path. A leftover state in a tree on a branch, which git ignores, keeps a branch too. Unlike
 * the listing's reads this one is not total, because a delete must not read "cannot tell" as "free": a `worktrees`
 * directory that is there but cannot be listed is unknown, and so is any record whose rebase or bisect state is
 * there but unreadable — a `chmod 000` `head-name` hid a live rebase's branch.
 *
 * @param repository where the records live and whose git configuration abbreviates an id
 * @returns every held branch, deduplicated, in no promised order — `null` when a record or its state cannot be read
 */
export function heldBranchesAnywhere({ repository }: { repository: ListingRepository }): readonly string[] | null {
  const linked = join(repository.commonDir, "worktrees");
  let ids: readonly string[] = [];
  try {
    ids = readdirSync(linked);
  } catch (error) {
    // No `worktrees` directory is a repository with no linked tree; anything else is unknown.
    if (!isAbsence({ error })) {
      return null;
    }
  }
  const gitDirs = [repository.commonDir, ...ids.map((id) => join(linked, id))];
  const objectIds = gitObjectIds({ cwd: repository.cwd });
  // Each state is read ONCE and its own read says whether it was unreadable: a separate check before the value read
  // left a window in which a file turned unreadable between the two read as no hold.
  const holds = gitDirs.flatMap((gitDir) => holdReads({ gitDir, objectIds }));
  if (holds.some((hold) => hold.kind === "unknown")) {
    return null;
  }
  return branchesOf({ holds });
}

/** Every branch held across some git directories, deduplicated, a rebase's before a bisect's within each. */
function heldBranchesIn({
  gitDirs,
  repository,
}: {
  gitDirs: readonly string[];
  repository: ListingRepository;
}): readonly string[] {
  const objectIds = gitObjectIds({ cwd: repository.cwd });
  return [...new Set(gitDirs.flatMap((gitDir) => heldBranchesInGitDir({ gitDir, objectIds })))];
}

/** Whether a filesystem error says the path is simply not there: a missing entry, or a file where a directory was. */
function isAbsence({ error }: { error: unknown }): boolean {
  const code = error instanceof Error && "code" in error ? error.code : null;
  return code === "ENOENT" || code === "ENOTDIR";
}
