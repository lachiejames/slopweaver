/**
 * The core of the `codex plugin-sync` verb, behind one seam object so a test drives it with an in-memory plan
 * register and plain fakes. The verb's shell (`src/cli/commands/codex/pluginSyncRun.ts`) parses flags, builds
 * the production seams and prints; this module decides the order the run reads things in.
 *
 * The order is the contract. Whether this checkout may publish is read FIRST, so a feature-branch worktree's
 * post-merge hook says "skipped" without reading the plan register. The register is read next, and a read that
 * fails fails the whole run before any Codex home is touched: a fleet half-synced off a register we could not
 * read would look done while seats boot without the plugin.
 */

import type { Result } from "#lib/result.js";
import type { CodexDestination } from "../codex/destinations.js";
import type { PlanRegisterError } from "../plans/errors.js";

import { CodexPluginSyncErrors } from "./errors.js";
import { decidedOutcome, fleetSyncDue, planFleetSync, publishableCheckout, type SyncPaths } from "./fleetPlan.js";
import { type CodexPluginHome, codexPluginHomes } from "./homes.js";
import type { SyncOutcome } from "./plan.js";
import { performFleetSync, type SyncDeps, type TrustHooks } from "./sync.js";
import { spawnCodexAdd } from "./syncEffects.js";

/** Which half of the verb runs: the hook's two, or a foreground run someone started. */
export type SyncMode = "decide" | "log" | "foreground";

/** Everything the core reads or calls, so a test replaces each with a plain fake. */
export interface PluginSyncDeps {
  readonly paths: SyncPaths;
  readonly mainCheckouts: readonly string[];
  readonly ambientCodexHome: string;
  /** The background run's log, named in a `backgrounded` outcome. */
  readonly log: string;
  readonly readDestinations: () => Promise<Result<readonly CodexDestination[], PlanRegisterError>>;
  readonly sync: SyncDeps;
}

/**
 * The production seams: the real `codex plugin add`, the wall clock, and the caller's register read and trust pass.
 *
 * @param paths the directories involved
 * @param mainCheckouts the profile's declared main checkout paths
 * @param ambientCodexHome `$CODEX_HOME` when set, else Codex's own default
 * @param log the background run's log file
 * @param readDestinations reads the plan register's Codex homes
 * @param trustHooks has one home's Codex trust every Slopweaver hook
 * @returns the seams a real run uses
 */
export function productionPluginSyncDeps({
  paths,
  mainCheckouts,
  ambientCodexHome,
  log,
  readDestinations,
  trustHooks,
}: {
  paths: SyncPaths;
  mainCheckouts: readonly string[];
  ambientCodexHome: string;
  log: string;
  readDestinations: PluginSyncDeps["readDestinations"];
  trustHooks: TrustHooks;
}): PluginSyncDeps {
  return {
    ambientCodexHome,
    log,
    mainCheckouts,
    paths,
    readDestinations,
    sync: { codexAdd: spawnCodexAdd, nowMs: () => Date.now(), trustHooks },
  };
}

/** The `--decide` half: the decision alone, nothing written; a due fleet hands off to the background run. */
function decideOutcome({ deps, homes }: { deps: PluginSyncDeps; homes: readonly CodexPluginHome[] }): SyncOutcome {
  const plan = planFleetSync({
    homes,
    mainCheckouts: deps.mainCheckouts,
    paths: deps.paths,
    scope: "update-installed",
  });
  if (plan.isErr()) {
    return { did: "failed", error: plan.error };
  }
  if ("skip" in plan.value) {
    return { did: "skipped", why: plan.value.skip };
  }
  if (!fleetSyncDue({ plan: plan.value })) {
    return decidedOutcome({ plan: plan.value });
  }
  const due = plan.value.homes.filter((decision) => decision.action === "refresh").length;
  return { did: "backgrounded", log: deps.log, why: `${String(due)} Codex home(s) behind HEAD` };
}

/**
 * Run one mode of the verb to its outcome.
 *
 * @param deps the seams the run reads and calls
 * @param mode which half runs — `decide` and `log` only update an installed home, `foreground` installs everywhere
 * @returns the outcome; a failure is a `failed` arm, never a rejection
 */
export async function pluginSyncOutcome({
  deps,
  mode,
}: {
  deps: PluginSyncDeps;
  mode: SyncMode;
}): Promise<SyncOutcome> {
  const published = publishableCheckout({ mainCheckouts: deps.mainCheckouts, paths: deps.paths });
  if (published.isErr()) {
    return { did: "failed", error: published.error };
  }
  if ("skip" in published.value) {
    return { did: "skipped", why: published.value.skip };
  }
  const destinations = await deps.readDestinations();
  if (destinations.isErr()) {
    return {
      did: "failed",
      error: CodexPluginSyncErrors.destinationsUnreadable({ detail: destinations.error.message }),
    };
  }
  const homes = codexPluginHomes({ ambientCodexHome: deps.ambientCodexHome, destinations: destinations.value });
  if (mode === "decide") {
    return decideOutcome({ deps, homes });
  }
  return performFleetSync({
    deps: deps.sync,
    homes,
    mainCheckouts: deps.mainCheckouts,
    paths: deps.paths,
    scope: mode === "log" ? "update-installed" : "install-every-home",
  });
}
