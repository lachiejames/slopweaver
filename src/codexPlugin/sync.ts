/**
 * The writing half of `codex plugin-sync`: from a declared main checkout, export HEAD ONCE and bring every Codex
 * home the fleet runs in onto it — each registered home, paused ones included, and the ambient one
 * (`./homes.ts`). `./fleetPlan.ts` decides what each home needs and which writes a {@link SyncScope} allows,
 * `./plan.ts` carries the pure decisions and the measurements behind the route, `./syncEffects.ts` each
 * effect, `./marketplaceStore.ts` the personal marketplace, and `./syncLock.ts` the lock.
 *
 * ## One lock, one export, every home
 *
 * The export and the marketplace source are shared by every home, so the lock is the existing machine-wide one,
 * held from the marketplace write through the last home's read-back, and every decision is re-read under it. A
 * lock per home would let a second run replace the export while the first run's `codex plugin add` copies it.
 * One home's failure is recorded on its own line and the run goes on to the next.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { readJsonFile } from "#lib/jsonFile.js";
import type { Result } from "#lib/result.js";

import { type CodexPluginSyncError, CodexPluginSyncErrors } from "./errors.js";
import {
  type FleetSyncPlan,
  type HomeDecision,
  planFleetSync,
  publishableCheckout,
  type SyncPaths,
  type SyncScope,
} from "./fleetPlan.js";
import { type CodexPluginHome, homeOverlappingExport } from "./homes.js";
import { ensurePersonalMarketplace } from "./marketplaceStore.js";
import {
  CODEX_PLUGIN_NAME,
  type HomeSyncOutcome,
  SOURCE_STAMP_RELATIVE,
  type SyncOutcome,
  stampCommitOf,
} from "./plan.js";
import { type CodexAdd, exportHead, installedPathOf, pointSourceAt } from "./syncEffects.js";
import { takeSyncLock } from "./syncLock.js";

/** Have one home's Codex trust every Slopweaver hook of `pluginId`, failing unless all of them then run. */
export type TrustHooks = (input: {
  readonly codexHome: string;
  readonly cwd: string;
  readonly pluginId: string;
}) => Result<{ readonly trusted: number }, CodexPluginSyncError>;

/** The seams a test replaces with plain fakes. */
export interface SyncDeps {
  readonly codexAdd: CodexAdd;
  /** The wall clock, for the lock's acquired instant and the age of an earlier build's lock. */
  readonly nowMs: () => number;
  readonly trustHooks: TrustHooks;
}

/** Add the plugin into one home, prove the tree Codex installed carries HEAD, then trust its hooks. */
function installHome({
  decision,
  plan,
  paths,
  deps,
}: {
  decision: HomeDecision;
  plan: FleetSyncPlan;
  paths: SyncPaths;
  deps: SyncDeps;
}): HomeSyncOutcome {
  const { codexHome } = decision.home;
  const pluginId = `${CODEX_PLUGIN_NAME}@${plan.entry.marketplace}`;
  const installed = installedPathOf({ run: deps.codexAdd({ codexHome, pluginId }) });
  if (installed.isErr()) {
    return { codexHome, did: "failed", error: installed.error };
  }
  const found = stampCommitOf({ document: readJsonFile({ path: join(installed.value, SOURCE_STAMP_RELATIVE) }) });
  if (found !== plan.head) {
    return { codexHome, did: "failed", error: CodexPluginSyncErrors.stampMismatch({ expected: plan.head, found }) };
  }
  const trusted = deps.trustHooks({ codexHome, cwd: paths.checkout, pluginId });
  if (trusted.isErr()) {
    return { codexHome, did: "failed", error: trusted.error };
  }
  return {
    codexHome,
    did: "refreshed",
    installedPath: installed.value,
    trusted: trusted.value.trusted,
    why: decision.why,
  };
}

/** A home already on HEAD: in a foreground run its hook trust is re-checked, so a rerun can repair a failed pass. */
function currentHome({
  decision,
  plan,
  paths,
  deps,
  scope,
}: {
  decision: HomeDecision;
  plan: FleetSyncPlan;
  paths: SyncPaths;
  deps: SyncDeps;
  scope: SyncScope;
}): HomeSyncOutcome {
  const { codexHome } = decision.home;
  if (scope === "update-installed") {
    return { codexHome, did: "current", trusted: undefined, why: decision.why };
  }
  const pluginId = `${CODEX_PLUGIN_NAME}@${plan.entry.marketplace}`;
  const trusted = deps.trustHooks({ codexHome, cwd: paths.checkout, pluginId });
  if (trusted.isErr()) {
    return { codexHome, did: "failed", error: trusted.error };
  }
  return { codexHome, did: "current", trusted: trusted.value.trusted, why: decision.why };
}

/** Export once when any home is due, then bring each home along in order, one outcome each. */
function syncHomes({
  plan,
  paths,
  deps,
  scope,
}: {
  plan: FleetSyncPlan;
  paths: SyncPaths;
  deps: SyncDeps;
  scope: SyncScope;
}): SyncOutcome {
  if (plan.homes.some((decision) => decision.action === "refresh")) {
    const exported = exportHead({
      checkout: paths.checkout,
      exportDir: plan.exportDir,
      exportRoot: paths.exportRoot,
      head: plan.head,
    }).andThen(() => pointSourceAt({ exportDir: plan.exportDir, sourcePath: plan.entry.sourcePath }));
    if (exported.isErr()) {
      return { did: "failed", error: exported.error };
    }
  }
  const homes = plan.homes.map((decision): HomeSyncOutcome => {
    const { codexHome } = decision.home;
    if (decision.action === "missing") {
      return { codexHome, did: "failed", error: CodexPluginSyncErrors.codexHomeMissing({ codexHome }) };
    }
    if (decision.action === "untouched") {
      return { codexHome, did: "untouched", why: decision.why };
    }
    if (decision.action === "refresh") {
      return installHome({ decision, deps, paths, plan });
    }
    return currentHome({ decision, deps, paths, plan, scope });
  });
  return { did: "synced", homes };
}

/** A failed run when a home overlaps the export root, refused before that root exists: creating it is the write. */
function overlapRefusal({
  exportRoot,
  homes,
}: {
  exportRoot: string;
  homes: readonly CodexPluginHome[];
}): SyncOutcome | undefined {
  const overlapping = homeOverlappingExport({ exportRoot, homes });
  if (overlapping === undefined) {
    return undefined;
  }
  const error = CodexPluginSyncErrors.codexHomeOverlapsExport({ codexHome: overlapping.codexHome, exportRoot });
  return { did: "failed", error };
}

/**
 * Under the fleet-wide lock: re-decide, seed the marketplace when the scope allows, export once, and bring every
 * home onto HEAD — each home's failure its own outcome, never a reason to stop before the next.
 *
 * @param paths the directories involved
 * @param mainCheckouts the profile's declared main checkout paths
 * @param homes every Codex home to keep
 * @param scope which writes this run may make
 * @param deps the `codex`, trust and clock seams
 * @returns the run's outcome; a failure is a `failed` arm, never a throw
 */
export function performFleetSync({
  paths,
  mainCheckouts,
  homes,
  scope,
  deps,
}: {
  paths: SyncPaths;
  mainCheckouts: readonly string[];
  homes: readonly CodexPluginHome[];
  scope: SyncScope;
  deps: SyncDeps;
}): SyncOutcome {
  const overlap = overlapRefusal({ exportRoot: paths.exportRoot, homes });
  if (overlap !== undefined) {
    return overlap;
  }
  mkdirSync(paths.exportRoot, { recursive: true });
  const lock = takeSyncLock({ nowMs: deps.nowMs(), paths });
  if (lock.isErr()) {
    return lock.error;
  }
  try {
    // A checkout that may not publish writes nothing, the marketplace seed included.
    const published = publishableCheckout({ mainCheckouts, paths });
    if (published.isErr()) {
      return { did: "failed", error: published.error };
    }
    if ("skip" in published.value) {
      return { did: "skipped", why: published.value.skip };
    }
    // Each home is judged before the marketplace write, which can create a directory a missing home names.
    const plan = planFleetSync({ homes, mainCheckouts, paths, scope });
    if (plan.isErr()) {
      return { did: "failed", error: plan.error };
    }
    if ("skip" in plan.value) {
      return { did: "skipped", why: plan.value.skip };
    }
    if (scope === "install-every-home") {
      const ensured = ensurePersonalMarketplace({ userHome: paths.userHome });
      if (ensured.isErr()) {
        return { did: "failed", error: ensured.error };
      }
      if ("skip" in ensured.value) {
        return { did: "skipped", why: ensured.value.skip };
      }
    }
    return syncHomes({ deps, paths, plan: plan.value, scope });
  } finally {
    lock.value.release();
  }
}
