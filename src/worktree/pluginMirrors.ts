/**
 * The per-root plugin mirrors a removed worktree leaves behind — finding them, judging them, and freeing them.
 *
 * ## Why this is the disk
 *
 * `scripts/plugin-mirror-sync.sh` copies the hook surface into `<plugin data>/mirror/by-root<plugin root>/` on
 * every SessionStart, two alternating `.slot-a`/`.slot-b` copies of ~100 MB each, real bytes with no hardlinks.
 * Its own prune frees a root only once its `.last-sync` is SEVEN DAYS old, because an absent root proves nothing
 * about a session still running on it — and at this fleet's rate of a new worktree per seat that holds hundreds of
 * roots. MEASURED, the morning macOS warned the disk was full: 501 of 524 marked roots named a worktree
 * that no longer existed, holding 740 slots, on a volume with 2.6 GiB free. Reproduce a slot's size and that it
 * shares nothing: `du -sk <root>/.slot-a` (~98–104 MB) and `find <root>/.slot-a -type f -links +1 | wc -l` (0).
 *
 * ## The evidence that replaces the age
 *
 * The seven days stand in for "no session is running on this root". For a root that is a WORKTREE of a declared
 * main checkout that fact is directly readable: the tree is gone, and neither live register — the cmux workspace
 * list and the session ledger, the ones `worktree prune` reads before every removal — names a session at or under
 * it. A root anywhere else (a versioned cache install, a scratch fixture) is left to the script's own age rule,
 * because a session on a pruned cache version is exactly what that rule protects and no register here sees it.
 *
 * ## What a removal touches
 *
 * Exactly what the script's own prune does: the two slots, `current` and the `.last-sync` marker — never the
 * directory, because roots NEST (a worktree root sits inside its checkout root's mirror directory), and never the
 * `.sync.lock`, which may belong to a build in flight. A root whose lock is fresh is kept outright. A `current`
 * that is a real directory rather than the script's link is left standing, as the script's `rm -f` leaves it.
 *
 * ## An abandoned lock is not a build
 *
 * A lock older than the script's own `LOCK_STALE_SECONDS` belongs to a holder that died — a build runs inside a
 * 60s hook and its EXIT trap removes the lock on a TERM, so only a SIGKILL or a crash leaves one standing. The
 * script breaks such a lock on that root's NEXT boot, and a removed worktree never boots again. MEASURED:
 * 16 old locks pinned their slots, ten of them on gone worktrees this pass kept "a mirror
 * build holds its lock" every hour. Reproduce: `find ~/.claude/plugins/data/<plugin>/mirror/by-root \( -name .slot-a
 * -o -name .slot-b \) -prune -o -name .sync.lock -type d -exec stat -f '%Sm %N' {} +`.
 */
import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";

import { type FseventsdCpu, readFseventsdCpu } from "./fseventsdGauge.js";
import { worktreesDir, worktreesLink } from "./location.js";
import { deleteGently } from "./prunePacing.js";

/** The two slot directories, the lock and the marker, spelled as `scripts/plugin-mirror-sync.sh` spells them. */
const SLOT_NAMES = [".slot-a", ".slot-b"] as const;
const LOCK_NAME = ".sync.lock";
const MARKER_NAME = ".last-sync";
const CURRENT_NAME = "current";

/**
 * How old a `.sync.lock` must be to prove its holder died: `LOCK_STALE_SECONDS` in `scripts/plugin-mirror-sync.sh`,
 * the threshold that script's own contender breaks a lock at. Changing one without the other is the defect.
 */
export const LOCK_STALE_MS = 120_000;

/**
 * Whether a RESOLVED directory is one of the script's mirror slots, `<…>/mirror/by-root<root>/.slot-a|b`.
 * Positive identity, read from the layout the script builds rather than inferred from what the directory
 * lacks. A link into the mirror, `<plugin data>/mirror/current` included, resolves to such a slot, or, while
 * `scripts/plugin-mirror-sync.sh` holds a SEED, to the plugin root itself, which this rightly rejects: that tree is
 * the real plugin, manifest and skills included. Pure: pass a path already through `realpathSync`, since
 * `current` is a link.
 *
 * @param dir an absolute, symlink-resolved directory
 * @returns true when `dir` is a mirror slot
 */
export function isMirrorSlotDir({ dir }: { dir: string }): boolean {
  const parts = dir.split(sep);
  const last = parts.at(-1);
  if (last === undefined || !(SLOT_NAMES as readonly string[]).includes(last)) {
    return false;
  }
  // ANY `mirror/by-root` pair, not the last `mirror`: the key is a whole plugin root path, which may itself
  // carry a component named `mirror`. The key is at least one component, so the pair sits at least two above the
  // slot: `by-root/.slot-a` with nothing between is no layout the script builds.
  const lastPairIndex = parts.length - 4;
  return parts.some((part, index) => index <= lastPairIndex && part === "mirror" && parts[index + 1] === "by-root");
}

/** What the walk never descends into: what the script creates INSIDE a mirror root, and its `current` link. */
const SKIPPED: ReadonlySet<string> = new Set([...SLOT_NAMES, LOCK_NAME, CURRENT_NAME]);

/** One mirror root on disk: the plugin root it is keyed by, and what of the script's it still holds. */
export interface MirrorRoot {
  /** The absolute plugin root this mirror was built for — the directory path below `by-root`. */
  readonly key: string;
  /** The mirror directory itself. */
  readonly dir: string;
  /** The slot directories present, which are all the disk a root holds. */
  readonly slots: readonly string[];
  /** The `.sync.lock`'s mtime in epoch ms when one stands, else `null` — a build may be running if it is fresh. */
  readonly lockMtimeMs: number | null;
}

/**
 * Every `by-root` directory on this machine: one per plugin data root under `~/.claude/plugins/data`.
 *
 * Every data root rather than one named, because a verb run from a shell or the hourly row has no
 * `CLAUDE_PLUGIN_DATA`, and seats have booted under several plugin names (`slopweaver-inline` among them).
 *
 * @param pluginsData `~/.claude/plugins/data`, or a fixture standing in for it
 * @returns the `mirror/by-root` directories that exist
 */
export function mirrorByRootDirs({ pluginsData }: { pluginsData: string }): readonly string[] {
  let names: readonly string[];
  try {
    names = readdirSync(pluginsData);
  } catch {
    return [];
  }
  return names.map((name) => join(pluginsData, name, "mirror", "by-root")).filter((dir) => existsSync(dir));
}

/**
 * The machine's own plugin data directory.
 *
 * @returns `~/.claude/plugins/data`
 */
export function defaultPluginsData(): string {
  return join(homedir(), ".claude", "plugins", "data");
}

/**
 * Every mirror root under one `by-root` directory that still holds a slot.
 *
 * The walk descends PAST a root, because roots nest, and never into a slot, the lock or `current` — the same
 * bound the script's prune measured from 864,565 entries down to ~200. It never follows a symlink, and a
 * directory that cannot be read is skipped.
 *
 * @param byRoot `<plugin data>/mirror/by-root`
 * @returns one entry per directory holding at least one slot
 */
export function findMirrorRoots({ byRoot }: { byRoot: string }): readonly MirrorRoot[] {
  const found: MirrorRoot[] = [];
  const pending = [byRoot];
  while (pending.length > 0) {
    const dir = pending.pop()!;
    let names: readonly string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    const slots = SLOT_NAMES.filter((slot) => names.includes(slot)).map((slot) => join(dir, slot));
    if (slots.length > 0) {
      found.push({ dir, key: dir.slice(byRoot.length), lockMtimeMs: lockMtimeMs({ dir }), slots });
    }
    names
      .filter((name) => !SKIPPED.has(name))
      .map((name) => join(dir, name))
      .filter((child) => isRealDirectory({ path: child }))
      .forEach((child) => pending.push(child));
  }
  return found;
}

/**
 * Whether a path is a directory itself, never a symlink to one.
 *
 * @param path the entry to test
 * @returns true for a real directory
 */
function isRealDirectory({ path }: { path: string }): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * A mirror root's `.sync.lock` mtime, read without following a link.
 *
 * @param dir the mirror directory
 * @returns epoch ms, or `null` when no lock stands — absence by design, since most roots are not building
 */
function lockMtimeMs({ dir }: { dir: string }): number | null {
  try {
    return lstatSync(join(dir, LOCK_NAME)).mtimeMs;
  } catch {
    return null;
  }
}

/** What to do with one mirror root, and the sentence that says why. */
export type MirrorVerdict =
  { readonly kind: "remove"; readonly reason: string } | { readonly kind: "keep"; readonly reason: string };

/**
 * Judge one mirror root against the facts that stand in for the script's seven days.
 *
 * Pure: every fact is read by the caller, so each rail is pinned by a case rather than by a filesystem.
 *
 * @param root the mirror root
 * @param worktreeHomes every declared checkout's worktrees directory, in both its spellings
 * @param keyExists whether the plugin root it is keyed by still exists
 * @param held why a live register holds that path, or `null` when nothing does
 * @param nowMs the instant the lock's age is judged at — a lock older than `LOCK_STALE_MS` is abandoned
 * @returns remove, or keep with the rail that kept it
 */
export function mirrorVerdict({
  root,
  worktreeHomes,
  keyExists,
  held,
  nowMs,
}: {
  root: MirrorRoot;
  worktreeHomes: readonly string[];
  keyExists: boolean;
  held: string | null;
  nowMs: number;
}): MirrorVerdict {
  if (!worktreeHomes.some((home) => root.key.startsWith(`${home}/`))) {
    return {
      kind: "keep",
      reason: "not a worktree of a declared main checkout — the mirror script's own age rule governs it",
    };
  }
  if (keyExists) {
    return { kind: "keep", reason: "its worktree still exists" };
  }
  if (root.lockMtimeMs !== null && nowMs - root.lockMtimeMs <= LOCK_STALE_MS) {
    return { kind: "keep", reason: "a mirror build holds its lock" };
  }
  if (held !== null) {
    return { kind: "keep", reason: held };
  }
  return { kind: "remove", reason: "its worktree is gone and no live session or workspace stands in it" };
}

/**
 * Every declared checkout's worktree homes, in both the physical and the alias spelling a plugin root may carry.
 *
 * @param checkouts the declared main checkouts
 * @returns `<checkout>/.claude/worktrees.noindex` and `<checkout>/.claude/worktrees` for each
 */
export function worktreeHomesOf({ checkouts }: { checkouts: readonly string[] }): readonly string[] {
  return checkouts.flatMap((repoRoot) => [worktreesDir({ repoRoot }), worktreesLink({ repoRoot })]);
}

/**
 * One root as it stands NOW: its lock is re-read rather than carried from the walk.
 *
 * A pass may free its last root most of an hour after the walk that found it, and in that time a seat may have
 * re-created the same worktree and started building its mirror — so the verdict is taken again on this, right
 * before the free, never on the walk's snapshot.
 *
 * @param root the root as the walk found it
 * @returns the same root with `lockMtimeMs` read from disk
 */
export function rereadMirrorRoot({ root }: { root: MirrorRoot }): MirrorRoot {
  return { ...root, lockMtimeMs: lockMtimeMs({ dir: root.dir }) };
}

/**
 * Free one mirror root the way the script's own prune does: the slots, `current` and the marker, never the
 * directory or the lock. The slots go through a bounded `rm -rf`, because an interrupted one costs nothing —
 * nothing references a gone worktree's slot, and the next pass finishes it.
 *
 * A `current` that is a REAL directory is not the script's link, so it stays, exactly as the script's own
 * `rm -f … || true` leaves it. MEASURED: the hourly prune threw `Path is a directory: <root>/current`
 * from Node's native `rmSync` and the store held the whole row. Reproduce the refusal: `mkdir /tmp/c && node -e
 * 'require("fs").rmSync("/tmp/c",{force:true})'` throws `ERR_FS_EISDIR`.
 *
 * @param root the mirror root to free
 * @param timeoutMs how long the slot deletion may run before it is stopped
 * @param gauge fseventsd's CPU for the governed slot delete; the machine's live read unless a test passes a fixed
 *   one, so the delete can be proven without the machine's load deciding the outcome
 * @param now the epoch millisecond the deadline is read against, here and inside the governed delete; the wall clock
 *   unless a test passes a fixed one
 * @returns whether every slot is gone
 */
export function freeMirrorRoot({
  root,
  timeoutMs,
  gauge = readFseventsdCpu,
  now = Date.now,
}: {
  root: MirrorRoot;
  timeoutMs: number;
  gauge?: (input: { remainingMs: number }) => FseventsdCpu;
  now?: () => number;
}): boolean {
  const current = join(root.dir, CURRENT_NAME);
  if (!isRealDirectory({ path: current })) {
    rmSync(current, { force: true });
  }
  rmSync(join(root.dir, MARKER_NAME), { force: true });
  // At background priority and governed by fseventsd, like every bulk delete a prune makes (`./prunePacing.ts`).
  const deadline = now() + timeoutMs;
  for (const slot of root.slots) {
    if (now() >= deadline) {
      break;
    }
    deleteGently({ dir: slot, gauge, now, timeoutMs: deadline - now() });
  }
  return root.slots.every((slot) => !existsSync(slot));
}
