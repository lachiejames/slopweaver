/**
 * WHICH checkouts the main-checkout guards protect — the second key, alongside the git-topology one in
 * `mainCheckoutBranchGuard.ts`.
 *
 * The topology key ({@link isMainWorktreeForRepository}) answers "is this the main worktree of the SAME
 * repository this session is standing in", which protects a checkout only from its own repository's
 * sessions. Measured in `child-must-not-touch-the-main-checkout`: the incident was a child that
 * was standing in a worktree and wrote into that worktree's own main checkout, so the topology key covered
 * it — but a session standing anywhere ELSE (another repository, a temp directory) reaches the identical
 * shared checkout with the identical damage and matches no topology key at all.
 *
 * `profile.json`'s `mainCheckouts[].path` already DECLARES every checkout this install is expected to keep
 * current — the same register `checkout status`, `doctor` and `worktree prune` read. Reusing it is what lets
 * a guard say "a declared main checkout" rather than "this repository's main checkout", with no new
 * configuration surface and no absolute home path in this public repository's source.
 *
 * Fails OPEN on everything ambiguous, exactly like the guards that call it: an absent or empty profile declares
 * nothing, and so does a corrupt one (after one stderr warning from `loadProfile`), and a `cwd` git cannot resolve protects nothing. Never a security boundary.
 */
import { realpathSync } from "node:fs";

import { resolveHome } from "../cli/optionParsers.js";
import { slopweaverHome } from "../homeDir.js";
import type { Profile } from "../profile.js";
import { mainCheckoutsFromProfile } from "../profileStore.js";
import { mainCheckoutRoot } from "../worktree/shell.js";
import { gitRemoteNames, isMainWorktree, isMainWorktreeForRepository } from "./mainWorktree.js";

/**
 * Resolve a path through symlinks, falling back to the path itself when it does not exist.
 *
 * Both sides of the comparison need this: `profile.json` records the path an operator typed, while
 * `git rev-parse` reports what git resolved, and on this machine those differ by a `/private` prefix on
 * every temp path — the same canonicalisation `worktree/inventory.ts`'s live-reference index already needs.
 */
function canonical({ path }: { path: string }): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Every main checkout `profile.json` declares, canonicalised.
 *
 * Memoised for the life of the process. A guard runs as a one-shot hook process, so this reads the profile
 * at most once per tool call; the memo exists so a compound command with many segments does not re-read and
 * re-`realpath` the same file once per segment.
 */
let declaredCache: readonly string[] | undefined;

/**
 * The canonical paths of every main checkout `profile.json` declares.
 *
 * @param home the state home holding `profile.json` (defaults to {@link slopweaverHome}; named so a test can
 *   point at a fixture home instead of the operator's real one)
 * @returns the declared paths, canonicalised; empty when the profile declares or resolves none
 */
export function declaredMainCheckoutPaths({ home }: { home?: string } = {}): readonly string[] {
  if (home === undefined && declaredCache !== undefined) {
    return declaredCache;
  }
  const paths = mainCheckoutsFromProfile({ home: resolveHome({ named: home }) }).map((checkout) =>
    canonical({ path: checkout.path }),
  );
  if (home === undefined) {
    declaredCache = paths;
  }
  return paths;
}

/**
 * Whether `cwd` sits inside a DECLARED main checkout's own main worktree.
 *
 * Resolves `cwd` to its repository's main checkout first, so a subdirectory (`<checkout>/packages/x`) is
 * recognised while a linked worktree of the same repository is NOT: `mainCheckoutRoot` reports the shared
 * `.git`'s parent for both, so {@link isMainWorktree} is what separates them.
 *
 * @param cwd the command or file target directory to check
 * @param declared the declared paths (defaults to {@link declaredMainCheckoutPaths}; injectable for tests).
 *   Canonicalised here rather than assumed canonical: an injected literal path is exactly where the two
 *   sides silently stop matching, and on macOS every temp path differs from its own `realpath`
 * @returns whether the target is a declared main checkout
 */
export function isDeclaredMainCheckout({
  cwd,
  declared = declaredMainCheckoutPaths(),
}: {
  cwd: string;
  declared?: readonly string[];
}): boolean {
  if (declared.length === 0 || !isMainWorktree({ cwd })) {
    return false;
  }
  const root = mainCheckoutRoot({ cwd });
  return root !== undefined && declared.some((path) => canonical({ path }) === canonical({ path: root }));
}

/**
 * Whether a target directory is a main checkout THIS install protects, by either key.
 *
 * Signature-compatible with {@link isMainWorktreeForRepository} on purpose: it is the default the three
 * `PreToolUse` guards inject, so widening what counts as protected changed one default rather than three
 * call shapes, and every existing test that injects a fixture result keeps working untouched.
 *
 * @param cwd the command or file target directory to check
 * @param repositoryCwd the session repository, for the topology key
 * @returns whether a write there disrupts a checkout other sessions read from
 */
export function isProtectedMainCheckout({ cwd, repositoryCwd }: { cwd: string; repositoryCwd: string }): boolean {
  return isMainWorktreeForRepository({ cwd, repositoryCwd }) || isDeclaredMainCheckout({ cwd });
}

/**
 * The branch a protected main checkout is pinned to when its `profile.json` entry declares no rebase target.
 *
 * A DEFAULT rather than the pinned constant it replaced: `mainCheckoutBranchGuard.ts` once held
 * `PINNED_TRUNK_BRANCH = "main"` as a module literal, which made the branch guard wrong in both directions
 * for any declared checkout whose trunk is something else. MEASURED on a second declared checkout
 * whose `rebaseOnto` is `origin/staging`: `git -C <that checkout> checkout staging` was refused as
 * "switching a protected main checkout off main", while nothing had ever been refused for moving it OFF
 * `staging`, since every non-`main` branch read the same to a literal comparison against `main`.
 */
export const DEFAULT_TRUNK_BRANCH = "main";

/**
 * The branch name a declared `rebaseOnto` ref points at, with any remote or full-ref prefix removed.
 *
 * Pure, and `remotes` is passed in rather than read here, because the whole edge this has to get right is
 * WHICH leading segment is a remote name: `origin/staging` is the branch `staging` only because `origin` is
 * a remote, while a local `release/2.0` is a branch whose own name contains a slash. A ref this cannot
 * confidently strip is returned unchanged — the guard fails open on a trunk it cannot resolve, exactly as it
 * does on a target it cannot resolve.
 *
 * @param ref the declared rebase target, e.g. `origin/staging`, `refs/remotes/origin/staging`, `staging`
 * @param remotes the repository's own configured remote names, from {@link gitRemoteNames}
 * @returns the branch name the ref denotes
 */
export function trunkBranchFromRef({ ref, remotes }: { ref: string; remotes: readonly string[] }): string {
  const trimmed = ref.trim();
  if (trimmed.startsWith("refs/heads/")) {
    return trimmed.slice("refs/heads/".length);
  }
  if (trimmed.startsWith("refs/remotes/")) {
    const rest = trimmed.slice("refs/remotes/".length);
    const remote = remotes.find((name) => rest.startsWith(`${name}/`));
    // A `refs/remotes/` ref always carries a remote segment, so drop the first one even when `git remote`
    // reported nothing (an unreadable repository) rather than returning a name no branch ever has.
    return remote === undefined ? rest.slice(rest.indexOf("/") + 1) : rest.slice(remote.length + 1);
  }
  const remote = remotes.find((name) => trimmed.startsWith(`${name}/`));
  return remote === undefined ? trimmed : trimmed.slice(remote.length + 1);
}

/**
 * The trunk branch a protected main checkout at `cwd` is pinned to.
 *
 * Resolves `cwd` to its repository's main checkout and reads THAT checkout's own `profile.json` entry, so
 * each declared checkout is judged against its own trunk rather than against one module constant. Falls back
 * to {@link DEFAULT_TRUNK_BRANCH} for a checkout the profile does not declare (one protected by the topology
 * key alone) and for a declared entry carrying no `rebaseOnto`.
 *
 * @param cwd the command target directory whose checkout's trunk is wanted
 * @param checkouts the declared entries (defaults to `profile.json`'s; injectable for tests)
 * @param remotes the target repository's remote names (defaults to a live `git remote`; injectable for tests)
 * @returns the trunk branch name
 */
export function protectedTrunkBranch({
  cwd,
  checkouts = mainCheckoutsFromProfile({ home: slopweaverHome() }),
  remotes,
}: {
  cwd: string;
  checkouts?: Profile["mainCheckouts"];
  remotes?: readonly string[];
}): string {
  const root = mainCheckoutRoot({ cwd });
  if (root === undefined) {
    return DEFAULT_TRUNK_BRANCH;
  }
  const declared = checkouts.find((checkout) => canonical({ path: checkout.path }) === canonical({ path: root }));
  const ref = declared?.rebaseOnto;
  if (ref === undefined) {
    return DEFAULT_TRUNK_BRANCH;
  }
  return trunkBranchFromRef({ ref, remotes: remoteNamesOf({ remotes, root }) });
}

/**
 * The remote names a `rebaseOnto` ref is read against. A test injects them; a live call leaves them out, and
 * they are then read from `git remote` in the main checkout itself.
 */
function remoteNamesOf({ remotes, root }: { remotes: readonly string[] | undefined; root: string }): readonly string[] {
  if (remotes === undefined) {
    return gitRemoteNames({ cwd: root });
  }
  return remotes;
}
