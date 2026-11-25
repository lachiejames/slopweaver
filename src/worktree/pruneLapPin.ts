/**
 * The two effectful reads the `lap` class makes: the scan's provenance read over the real cache root and the real
 * process table, and the pin `--apply` takes right before a lap tree goes. The decision itself is
 * `./pruneLapClass.ts`, pure; the marker and the witness namespaces are `./lapTreeProvenance.ts`.
 *
 * The pin re-reads everything the verdict was earned on, because the scan can be `--scan-budget` + `--budget` old:
 * the provenance must be the same kind, a marked tree's marker the same marker and its minter still gone, an
 * unmarked tree's HEAD still inside a kept ref, HEAD the commit the scan read, and the tree's private gitdir naming
 * nothing outside it — the removal deletes that gitdir. Only then is HEAD kept under `refs/slopweaver/pruned-lap/`,
 * so the commit outlives its tree whatever happens to the ref that kept it before.
 */
import { liveStartOf } from "../admit/lockHolder.js";
import { cachePaths } from "../cacheHome.js";
import { holderRunning } from "../talk/relayLease.js";
import {
  LAP_TREE_MARKER_FILE,
  type LapTreeFacts,
  lapTreeRoots,
  PINNED_LAP_REFS,
  readLapTreeFacts,
} from "./lapTreeProvenance.js";
import type { GitRunner } from "./pruneGit.js";
import { realGit } from "./pruneGit.js";
import type { LapVerdictEvidence } from "./pruneLapClass.js";
import { privateHistoryWithinHead } from "./snapshotPrivateHistory.js";

/** The one file a lap adds to a tree's private gitdir beyond what `git worktree add --detach` writes. */
export const LAP_GITDIR_FILES: readonly string[] = [LAP_TREE_MARKER_FILE];

/**
 * A tree's lap provenance read against this machine's lap-trees directory and its live process table.
 *
 * @param git how to run git
 * @param path the worktree path git registered
 * @returns the provenance, or `undefined` when the path is not lap-shaped
 */
function scanLapTree({ git, path }: { git: GitRunner; path: string }): LapTreeFacts | undefined {
  return readLapTreeFacts({
    git,
    holderLive: (holder) => holderRunning({ holder, startOf: liveStartOf }),
    path,
    roots: lapTreeRoots({ lapTrees: cachePaths().lapTrees }),
  });
}

/**
 * A tree's lap provenance in the shape its scanned facts spread: read whether the tree is detached or on a branch,
 * because prune's salvage loop switches a lap tree onto a `salvage/` branch.
 *
 * @param git how to run git
 * @param path the worktree path git registered
 * @returns `{ lapTree }`, or nothing for a tree that is not a lap tree
 */
export function scanLapFacts({ git, path }: { git: GitRunner; path: string }): { readonly lapTree?: LapTreeFacts } {
  const lapTree = scanLapTree({ git, path });
  if (lapTree === undefined) {
    return {};
  }
  return { lapTree };
}

/**
 * Why the provenance read now no longer earns the verdict the scan gave, or `null` when it still does. PURE.
 *
 * @param evidence what the verdict was earned on
 * @param now the provenance read just now
 * @returns the reason the tree is kept, or `null`
 */
export function lapEvidenceChanged({
  evidence,
  now,
}: {
  evidence: LapVerdictEvidence;
  now: LapTreeFacts | undefined;
}): string | null {
  if (now === undefined || now.kind !== evidence.kind) {
    return "its lap provenance is not what the scan read — kept";
  }
  if (now.kind === "marked" && evidence.kind === "marked") {
    const same =
      now.marker.pid === evidence.marker.pid &&
      now.marker.processStart === evidence.marker.processStart &&
      now.marker.mintedHead === evidence.marker.mintedHead;
    if (!same) {
      return "its lap marker changed since the scan — kept";
    }
    if (now.holderLive) {
      return `its minting lap, pid ${String(now.marker.pid)}, is running now — kept`;
    }
    return null;
  }
  if (now.kind === "unmarked" && (now.witness === null || now.witness === undefined)) {
    return "no kept ref contains its HEAD now, or which do could not be read — kept";
  }
  return null;
}

/**
 * Pin a spent lap tree's HEAD for the removal, after re-reading what earned it the `lap` verdict.
 *
 * @param path the lap tree
 * @param repoRoot the repository the keep ref is written into
 * @param evidence the provenance the verdict carried
 * @param scannedHead the HEAD the scan read; absent, nothing is pinned
 * @returns the pinned sha, or why the tree is kept
 */
export function pinLap({
  path,
  repoRoot,
  evidence,
  scannedHead,
}: {
  path: string;
  repoRoot: string;
  evidence: LapVerdictEvidence | undefined;
  scannedHead: string | undefined;
}): { headSha: string } | { declined: string } {
  if (evidence === undefined || scannedHead === undefined) {
    return { declined: "its verdict carries no lap evidence to re-read — kept" };
  }
  const now = scanLapTree({ git: realGit, path });
  const changed = lapEvidenceChanged({ evidence, now });
  if (changed !== null) {
    return { declined: changed };
  }
  const headSha = realGit({ args: ["rev-parse", "--verify", "--quiet", "HEAD"], cwd: path });
  if (headSha !== scannedHead) {
    return { declined: "its HEAD is not the one the scan read, or could not be read — kept" };
  }
  if (!privateHistoryWithinHead({ alsoAllowed: LAP_GITDIR_FILES, git: realGit, path, rev: headSha })) {
    return { declined: "its own gitdir names a commit its HEAD does not contain, or could not be read — kept" };
  }
  if (realGit({ args: ["update-ref", `${PINNED_LAP_REFS}${headSha}`, headSha], cwd: repoRoot }) === null) {
    return { declined: "its HEAD could not be kept under a local ref, so nothing was removed" };
  }
  return { headSha };
}
