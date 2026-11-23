/**
 * The loop successor's boot: the tree it would land IN, and the `cmux spawn` line that boots it.
 *
 * Split out of `respawn.ts`, which owns whether a respawn is owed and what it records; this file owns only where
 * and how the successor starts, so both halves stay under the file-size cap.
 */
import { listWorktrees } from "../../../cmux/worktree.js";
import { runningCheckoutRoot } from "../../../lib/gitRepo.js";
import { productionStandingInspectDeps, readStandingTree, STANDING_UPSTREAM } from "../../../live/standing/inspect.js";
import { reusedWorktreeRefusal } from "../../../live/standing/respawn.js";
import { runCmuxSpawn } from "../cmux/run.js";
import { successorWorktree } from "./respawnWords.js";

/**
 * Boot the loop's successor from its dated doc.
 *
 * Delegates to `cmux spawn`'s own entrypoint rather than reimplementing a boot, so the successor gets the
 * fresh-remote worktree, the boot verification, the pickup delivery and — since `cmux/pluginDir.ts` —
 * a `--plugin-dir` pointing at its OWN tree rather than at whatever checkout ran this command.
 *
 * No `--driver` and no `--effort`: the spawn boots the host the plan register holds (`cmux/driverDefault.ts`),
 * and on the claude host its own door already boots an Opus seat at `high` (`cmux/spawnPins.ts`'s
 * `defaultSpawnEffort`) — the level a loop turn investigates at, because the `opus` alias landing on
 * `claude-opus-5-5` otherwise ran at `medium` (MEASURED in `cmux/modelPin.ts`). An explicit `--effort` here is
 * REFUSED on a Codex-only install (`codexEffortRefusal`), whose boot line has nowhere to put one, so passing it
 * would leave that install unable to respawn its loop at all.
 *
 * @param namedHome the `--home` this verb was given, passed through to the spawn, or `undefined` for the ambient one
 * @param successor the successor doc's slug
 * @returns the exit code
 */
export async function respawnLoop({
  namedHome,
  successor,
}: {
  readonly namedHome: string | undefined;
  readonly successor: string;
}): Promise<number> {
  return runCmuxSpawn(loopRespawnBootArgv({ namedHome, successor }));
}

/**
 * The `cmux spawn` argv a loop respawn boots its successor with — pure, so the boot line is tested without a spawn.
 *
 * @param namedHome the `--home` this verb was given, passed through to the spawn, or `undefined` for the ambient one
 * @param successor the successor doc's slug
 * @returns the argv the router hands `cmux spawn`: `[node, cli, cmux, spawn, …]`
 */
export function loopRespawnBootArgv({
  namedHome,
  successor,
}: {
  readonly namedHome: string | undefined;
  readonly successor: string;
}): readonly string[] {
  // The named home travels with the boot, so the `spawned` row phase one reads back lands in the home it reads.
  const homeArgs = namedHome === undefined ? [] : ["--home", namedHome];
  return ["node", "slopweaver", "cmux", "spawn", successor, "--model", "opus", ...homeArgs];
}

/**
 * The LAST gate, and the one that sits apart from the other three: it is about the tree the successor would
 * land IN, not about whether a respawn is owed.
 *
 * It fires because a loop successor's tree is keyed by a dated doc slug and so genuinely can already exist
 * and be behind — see {@link loopSuccessorRefusal}. A respawn named with no `--successor` has no tree to
 * measure and is refused earlier, by the caller, on that.
 *
 * @param successor the successor doc's slug, when the caller named one
 * @returns the refusal sentence, or `undefined` when the boot is worth making
 */
export function targetTreeRefusal({ successor }: { readonly successor: string | undefined }): string | undefined {
  if (successor === undefined) {
    return undefined;
  }
  return loopSuccessorRefusal({ successor });
}

/**
 * The loop's half of {@link targetTreeRefusal}: measure the worktree `cmux spawn` would REUSE for this
 * successor, and refuse when it is behind.
 *
 * It does NOT build the spawn's plan: `respawnWords.ts`'s `successorWorktree` reads the slug's branch and the
 * conventional path only, so a doc declaring another branch, or a parked run, can land the boot in a tree this
 * never measured. Phase one does not rely on it — the boot's own `spawned` row names the tree recorded.
 *
 * @param successor the successor doc's slug
 * @returns the refusal sentence, or `undefined` when the successor may boot
 */
function loopSuccessorRefusal({ successor }: { readonly successor: string }): string | undefined {
  const repoRoot = runningCheckoutRoot();
  const worktrees = listWorktrees({ repoRoot });
  // Two of the keys `cmux/plan.ts` resolves the spawn's own worktree with, in its order — not its declared-branch
  // or parked-checkpoint keys, so a doc declaring another branch is measured here by the slug's tree alone.
  const existing = successorWorktree({ repoRoot, successor, worktrees });
  if (existing === undefined) {
    return undefined;
  }
  const problems: string[] = [];
  const reading = readStandingTree({
    deps: productionStandingInspectDeps(),
    fetched: new Set(),
    path: existing.path,
    problems,
  });
  return reusedWorktreeRefusal({
    base: STANDING_UPSTREAM,
    behind: reading.behind,
    exists: true,
    path: existing.path,
  });
}
