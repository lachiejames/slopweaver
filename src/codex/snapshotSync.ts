/**
 * Moving a held snapshot-pool slot to a commit: a `reset --hard` + `clean -ffdx` when that reproduces a fresh
 * checkout, a rebuild when it might not, and a refusal when no reused slot can. The pool around it is
 * `./snapshotPool.ts`; which process may move a slot is `./snapshotLease.ts`.
 *
 * ## What a reused slot does and does not promise
 *
 * Equivalence to a fresh checkout of the same commit under stable, deterministic checkout configuration with
 * no concurrent writer — the same canonical-content promise `createTreeSnapshot` makes. Three measured
 * gaps in `reset --hard` are closed here rather than documented. A `.gitattributes` change between the old and
 * new commit leaves an unchanged blob's OLD checkout bytes in place (measured: LF surviving a switch to
 * `eol=crlf`), so any such change REBUILDS the slot. A checkout rule outside the commit — `core.autocrlf`, a
 * filter's config, `info/attributes` — does the same, so each slot records the
 * `./snapshotCheckout.ts` fingerprint its tree was written under and a different one rebuilds it too. A sparse
 * checkout left in the slot survives reset as skip-worktree and keeps a file absent, so a slot whose index
 * still flags any entry after the reset is rebuilt as well. Two trees
 * are refused outright and left to a fresh snapshot: one carrying a gitlink, because reset does not return an
 * initialised submodule to a fresh checkout's empty shape, and one routing files through a smudge or process
 * filter, because that program's output can change while every input the pool can see stays the same. So is
 * a repository setting `core.filemode` false, where reset keeps a mode someone changed in a free slot, and one
 * ignoring ctime (`core.trustctime` false or `core.checkstat` minimal), where a same-size rewrite with its old
 * mtime restored reads clean to reset. With ctime trusted, no unprivileged writer can forge a stat
 * the index matches.
 *
 * A slot that gained git state of its own — a `config.worktree`, a skip-worktree index entry — is rebuilt too.
 * A slot whose git resolves to some other worktree is rebuilt as well. Permission bits git does not record —
 * a tracked file chmodded 0600 — survive reset, so a reader that changes them hands them to the next holder. A
 * Codex pass is kept from being that reader by its sandbox, not by anything here: `workspace-write` opens the
 * temp folder this pool lives in by default, and two passes did write into the slot they were reading — one a
 * directory inside the tree, one beside it — until every pass closed the temp folder and moved its shell temp
 * into its scratch (`./passWorkspace.ts`). What is NOT defended is someone deliberately subverting a slot's git
 * beyond those — rewriting its `.git`, its index or the repository's own config to point the checks at a decoy:
 * a determined writer to the temp directory could as easily edit a fresh snapshot mid-pass. Each such case found
 * so far is closed here.
 */
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { GIT_TREE_WRITE_TIMEOUT_MS, runGitChecked } from "./gitRun.js";
import { snapshotGitPrefix } from "./snapshot.js";
import { checkoutFingerprint, readIfPresent, type SnapshotGit, smudgingDriver } from "./snapshotCheckout.js";
import type { HeldSlot } from "./snapshotLease.js";

/** The slot file recording the checkout fingerprint its tree was last written under. */
const CHECKOUT_FILE = "checkout";

/**
 * The slot file recording the commit the pool last wrote its tree from. The tree's own HEAD is not that record:
 * a reader can move it (`reset --soft`) without touching a byte.
 */
const SYNCED_FILE = "synced";

/**
 * Refuse a tree a reused slot cannot reproduce: one in a repository whose stat checks ignore modes or ctime,
 * one carrying a gitlink, since reset does not return a submodule to a fresh checkout's shape, or one whose
 * attributes route files through a smudging filter. Throws, naming why, so the caller takes a fresh snapshot.
 *
 * @param commit the frozen snapshot commit the slot would be moved to
 * @param commonGitDir the repository's real common git dir, which holds `info/attributes`
 * @param git how git is run — a unit test passes a scripted fake
 * @param staging the held slot directory, whose git prefix every command runs under
 */
export function refuseUnpoolableTree({
  commit,
  commonGitDir,
  git = runGitChecked,
  repoRoot,
  staging,
}: {
  commit: string;
  commonGitDir: string;
  git?: SnapshotGit;
  repoRoot: string;
  staging: string;
}): void {
  const off = snapshotGitPrefix({ staging });
  const weak = weakStatCheck({ git, off, repoRoot });
  if (weak !== undefined) {
    throw new Error(`${weak} — use a fresh snapshot`);
  }
  // `-z`: one `<mode> <type> <id>\t<path>` entry per NUL, whatever a path holds.
  const entries = git({ args: [...off, "ls-tree", "-r", "-z", commit], cwd: repoRoot, label: "git ls-tree" })
    .split("\0")
    .filter((entry) => entry !== "");
  if (entries.some((entry) => entry.startsWith("160000 "))) {
    throw new Error("the tree carries a gitlink, which a pooled slot does not reproduce — use a fresh snapshot");
  }
  const attributeBlobs = entries
    .filter((entry) => basename(entry.slice(entry.indexOf("\t") + 1)) === ".gitattributes")
    .map((entry) => entry.slice(0, entry.indexOf("\t")).split(" ")[2]!);
  const driver = smudgingDriver({ attributeBlobs, commonGitDir, git, off, repoRoot });
  if (driver !== undefined) {
    throw new Error(
      `the tree routes files through the "${driver}" smudge filter, whose output a reused slot cannot vouch for — use a fresh snapshot`,
    );
  }
}

/**
 * Move a held slot to `commit`: incrementally when its tree is intact and was written under these same checkout
 * rules, by a rebuild otherwise. A rebuild that fails discards the slot and rethrows, so the caller falls back.
 *
 * @param checkout the checkout fingerprint as the source checkout reads it now
 * @param commit the frozen snapshot commit to move the slot to
 * @param commonGitDir the repository's real common git dir, which holds `info/attributes`
 * @param git how git is run — a unit test passes a scripted fake
 * @param held the slot this process holds the lease on
 * @param poolRoot the repository's pool directory, where a discarded slot is renamed aside
 * @param repoRoot the repository the snapshot is taken from
 */
export function syncHeldSlot({
  checkout,
  commit,
  commonGitDir,
  git = runGitChecked,
  held,
  poolRoot,
  repoRoot,
}: {
  checkout: string;
  commit: string;
  commonGitDir: string;
  git?: SnapshotGit;
  held: HeldSlot;
  poolRoot: string;
  repoRoot: string;
}): void {
  const off = snapshotGitPrefix({ staging: held.slot });
  const recorded = join(held.slot, CHECKOUT_FILE);
  const synced = join(held.slot, SYNCED_FILE);
  const sameRules = readIfPresent({ path: recorded }) === checkout;
  if (sameRules && incrementalSyncWorked({ checkout, commit, commonGitDir, git, held, off, repoRoot, synced })) {
    return;
  }
  try {
    // Forgotten first, so a rebuild cut short is never mistaken for one written under these rules.
    rmSync(recorded, { force: true });
    rmSync(synced, { force: true });
    rebuildHeldSlot({ commit, git, held, off, repoRoot });
    writeFileSync(recorded, checkout);
    writeFileSync(synced, commit);
  } catch (error) {
    discardHeldSlot({ git, held, off, poolRoot, repoRoot });
    throw error;
  }
}

/** A config value as git reads it, or `undefined` when the key is unset and git's default applies. */
function configValue({
  bool,
  git,
  key,
  off,
  repoRoot,
}: {
  bool: boolean;
  git: SnapshotGit;
  key: string;
  off: readonly string[];
  repoRoot: string;
}): string | undefined {
  try {
    return git({
      args: [...off, "config", ...(bool ? ["--type=bool"] : []), "--get", key],
      cwd: repoRoot,
      label: `git config ${key}`,
    }).trim();
  } catch {
    // `git config --get` exits 1 for an unset key.
    return undefined;
  }
}

/** Why this repository's stat checks let reset keep a slot's rewritten file, or undefined when they hold. */
function weakStatCheck({
  git,
  off,
  repoRoot,
}: {
  git: SnapshotGit;
  off: readonly string[];
  repoRoot: string;
}): string | undefined {
  if (configValue({ bool: true, git, key: "core.filemode", off, repoRoot }) === "false") {
    // Reset then trusts the index's mode over the disk's, so an executable bit changed in a free slot stays
    // changed where a fresh checkout writes the committed mode.
    return "core.filemode is false, so a pooled slot cannot restore a file's mode";
  }
  const ctimeIgnored =
    configValue({ bool: true, git, key: "core.trustctime", off, repoRoot }) === "false" ||
    configValue({ bool: false, git, key: "core.checkstat", off, repoRoot }) === "minimal";
  if (ctimeIgnored) {
    // A same-size rewrite with its mtime put back still moves ctime, which no unprivileged writer can set back.
    // Without ctime, reset reads that file clean and keeps its bytes.
    return "core.trustctime is false or core.checkstat is minimal, so a pooled slot cannot tell a rewritten file from a clean one";
  }
  return undefined;
}

/**
 * Reset the slot's tree to `commit` and remove everything else in it, when that is safe. False — never a throw —
 * when the tree is missing or broken, no synced commit is recorded, git refused, a `.gitattributes` changed
 * between the recorded commit and this one, or the reset index still flags an entry.
 */
function incrementalSyncWorked({
  checkout,
  commit,
  commonGitDir,
  git,
  held,
  off,
  repoRoot,
  synced,
}: {
  /** The checkout fingerprint as the source checkout reads it. */
  checkout: string;
  commit: string;
  commonGitDir: string;
  git: SnapshotGit;
  held: HeldSlot;
  off: readonly string[];
  repoRoot: string;
  /** The slot's record of the commit its tree was last written from. */
  synced: string;
}): boolean {
  const previous = readIfPresent({ path: synced });
  if (previous === undefined || !existsSync(join(held.tree, ".git"))) {
    return false;
  }
  try {
    if (!slotResettable({ checkout, commit, commonGitDir, git, off, previous, repoRoot, tree: held.tree })) {
      return false;
    }
    // Forgotten first, so a reset cut short is never mistaken for a tree written from `previous`.
    rmSync(synced, { force: true });
    const timeoutMs = GIT_TREE_WRITE_TIMEOUT_MS;
    git({ args: [...off, "reset", "--hard", "-q", commit], cwd: held.tree, label: "git reset --hard", timeoutMs });
    git({ args: [...off, "clean", "-ffdxq"], cwd: held.tree, label: "git clean", timeoutMs });
    // Reset honours skip-worktree left in the slot by a sparse checkout and leaves that file absent, so any
    // entry not tagged plain `H` rebuilds the slot.
    const entries = git({ args: [...off, "ls-files", "-v", "-z"], cwd: held.tree, label: "git ls-files" });
    if (!entries.split("\0").every((entry) => entry === "" || entry.startsWith("H "))) {
      return false;
    }
    writeFileSync(synced, commit);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a reset of `tree` from `previous` to `commit` reproduces a fresh checkout: no `.gitattributes` changed
 * between them, the slot has no config of its own, its git acts on this tree, and the checkout rules read inside
 * it are the source checkout's. Throws when git refuses, which the caller reads as no.
 */
function slotResettable({
  checkout,
  commit,
  commonGitDir,
  git,
  off,
  previous,
  repoRoot,
  tree,
}: {
  /** The checkout fingerprint as the source checkout reads it. */
  checkout: string;
  commit: string;
  commonGitDir: string;
  git: SnapshotGit;
  off: readonly string[];
  /** The commit the pool last wrote the tree from. */
  previous: string;
  repoRoot: string;
  tree: string;
}): boolean {
  const changed = git({
    // `-z`: unquoted, NUL-separated paths. Without it a path holding a newline or a non-ASCII byte arrives
    // quoted and its basename never reads `.gitattributes`.
    args: [...off, "diff", "--name-only", "--no-renames", "-z", previous, commit],
    cwd: repoRoot,
    label: "git diff --name-only",
  });
  if (changed.split("\0").some((path) => basename(path) === ".gitattributes")) {
    return false;
  }
  // A fresh worktree has no config of its own, so a slot that gained one — `core.autocrlf` set with
  // `--worktree`, a sparse checkout — is rebuilt rather than reset under rules the fingerprint never read.
  const ownConfig = git({
    args: [...off, "rev-parse", "--git-path", "config.worktree"],
    cwd: tree,
    label: "git rev-parse --git-path",
  }).trim();
  if (existsSync(resolve(tree, ownConfig))) {
    return false;
  }
  // Every command after this must act on this tree, not one a redirected `.git` or `core.worktree` names.
  const toplevel = git({ args: [...off, "rev-parse", "--show-toplevel"], cwd: tree, label: "git rev-parse" }).replace(
    /\n$/,
    "",
  );
  if (realpathSync(toplevel) !== realpathSync(tree)) {
    return false;
  }
  // Conditional config (`includeIf "gitdir:…"`) can apply inside a slot and not in the source checkout, so
  // the rules reset runs under are read where it runs too.
  return (
    weakStatCheck({ git, off, repoRoot: tree }) === undefined &&
    checkoutFingerprint({ commonGitDir, git, off, repoRoot: tree }) === checkout
  );
}

/**
 * Replace the slot's tree with a fresh checkout of `commit`. The old tree is deregistered and moved aside
 * first: `worktree add` will not check out over a non-empty directory just because its `.git` is gone.
 */
function rebuildHeldSlot({
  commit,
  git,
  held,
  off,
  repoRoot,
}: {
  commit: string;
  git: SnapshotGit;
  held: HeldSlot;
  off: readonly string[];
  repoRoot: string;
}): void {
  if (existsSync(held.tree)) {
    removeRegistration({ git, off, repoRoot, tree: held.tree });
  }
  if (existsSync(held.tree)) {
    const trash = join(held.slot, `.trash-${randomUUID()}`);
    renameSync(held.tree, trash);
    rmSync(trash, { force: true, recursive: true });
  }
  // `--force` twice: a registration whose directory is gone, or a locked one, refuses a single force.
  git({
    args: [...off, "worktree", "add", "--force", "--force", "--detach", "-q", held.tree, commit],
    cwd: repoRoot,
    label: "git worktree add",
    timeoutMs: GIT_TREE_WRITE_TIMEOUT_MS,
  });
}

/** Deregister a slot's tree, swallowing failure — it may never have been registered at all. */
function removeRegistration({
  git,
  off,
  repoRoot,
  tree,
}: {
  git: SnapshotGit;
  off: readonly string[];
  repoRoot: string;
  tree: string;
}): void {
  try {
    git({
      args: [...off, "worktree", "remove", "--force", "--force", tree],
      cwd: repoRoot,
      label: "git worktree remove",
      timeoutMs: GIT_TREE_WRITE_TIMEOUT_MS,
    });
  } catch {
    // Unregistered, or already gone. A later `worktree add --force --force` of the same path overrides it.
  }
}

/** Throw a broken slot away whole, renamed aside first so no remint of the same name is ever deleted. */
function discardHeldSlot({
  git,
  held,
  off,
  poolRoot,
  repoRoot,
}: {
  git: SnapshotGit;
  held: HeldSlot;
  off: readonly string[];
  poolRoot: string;
  repoRoot: string;
}): void {
  removeRegistration({ git, off, repoRoot, tree: held.tree });
  try {
    const trash = join(poolRoot, `.trash-${randomUUID()}`);
    renameSync(held.slot, trash);
    rmSync(trash, { force: true, recursive: true });
  } catch {
    // Left in place, the slot still carries this lease's busy marker, so it reads as a dead holder's once this
    // process exits and the next acquirer rebuilds it.
  }
}
