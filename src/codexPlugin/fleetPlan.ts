/**
 * The deciding half of `codex plugin-sync` across the fleet: may this checkout publish, where is Slopweaver's
 * marketplace entry, and what does each Codex home need. Reads only, so the post-merge hook's `--decide` calls
 * it in the foreground and `./sync.ts` calls it again under the lock before it writes anything.
 *
 * ## Two scopes, and the one write the hook never makes
 *
 * {@link SyncScope} `update-installed` is the post-merge hook's: it refreshes a home that ALREADY carries an
 * install stamp, and leaves a home with none — and a marketplace with no Slopweaver entry — untouched, printing
 * the foreground command instead. `install-every-home` is a foreground `codex plugin-sync`'s: it seeds or appends
 * the marketplace entry and makes the first install into every home. So the first write to each real home is
 * always a run someone chose to start and watched; the hook only ever keeps an existing install current.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { readJsonFile } from "#lib/jsonFile.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { isDeclaredMain, publishableHead } from "./checkout.js";
import { type CodexPluginSyncError, CodexPluginSyncErrors } from "./errors.js";
import type { CodexPluginHome } from "./homes.js";
import { type PluginInstallState, pluginInstallState } from "./installState.js";
import type { PersonalMarketplaceEntry } from "./marketplacePlan.js";
import { personalMarketplaceEntry, personalMarketplacePlan } from "./marketplaceStore.js";
import {
  CODEX_PLUGIN_NAME,
  FOREGROUND_SYNC_COMMAND,
  type HomeSyncOutcome,
  SOURCE_STAMP_RELATIVE,
  type SyncOutcome,
  stampCommitOf,
  syncDecision,
} from "./plan.js";

/** Slopweaver's own Codex manifest, relative to a checkout — what marks a checkout as publishable. */
const CODEX_MANIFEST_RELATIVE = ".codex-plugin/plugin.json";

/** The directories a run reads and writes, Codex homes aside — those are {@link CodexPluginHome}s. */
export interface SyncPaths {
  /** The checkout whose HEAD is exported — the git toplevel the verb runs in. */
  readonly checkout: string;
  /**
   * `codex-plugin/` under the cache root (`src/cacheHome.ts`), holding the export, the lock and the background log.
   * A move of this root needs no migration: the next sync re-exports and repoints the marketplace.
   */
  readonly exportRoot: string;
  /** The user's home, which Codex treats as the personal marketplace's root. */
  readonly userHome: string;
}

/** Which writes a run may make — see this module's header. */
export type SyncScope = "update-installed" | "install-every-home";

/** What one home needs, decided before anything is written. */
export interface HomeDecision {
  readonly home: CodexPluginHome;
  readonly action: "refresh" | "current" | "untouched" | "missing";
  readonly why: string;
}

/** Everything a run needs, resolved and decided, before anything is written. */
export interface FleetSyncPlan {
  readonly head: string;
  readonly entry: PersonalMarketplaceEntry;
  readonly exportDir: string;
  readonly homes: readonly HomeDecision[];
}

/**
 * Whether this checkout may publish, and the commit it would. Only a DECLARED main checkout of Slopweaver itself
 * publishes: a feature branch in a worktree must never become the fleet's Codex install, and another declared
 * main checkout (a different repository) carries no Slopweaver manifest at all. Reads only.
 *
 * @param paths the directories involved
 * @param mainCheckouts the profile's declared main checkout paths
 * @returns the commit to publish, a skip with its reason, or why git could not answer
 */
export function publishableCheckout({
  paths,
  mainCheckouts,
}: {
  paths: SyncPaths;
  mainCheckouts: readonly string[];
}): Result<{ readonly head: string } | { readonly skip: string }, CodexPluginSyncError> {
  if (!isDeclaredMain({ checkout: paths.checkout, mainCheckouts })) {
    return ok({ skip: `${paths.checkout} is not a declared main checkout, and only one publishes the Codex install` });
  }
  const manifest = readJsonFile({ path: join(paths.checkout, CODEX_MANIFEST_RELATIVE) });
  if (!isRecord(manifest) || manifest["name"] !== CODEX_PLUGIN_NAME) {
    return ok({ skip: `${paths.checkout} carries no ${CODEX_PLUGIN_NAME} Codex manifest` });
  }
  return publishableHead({ checkout: paths.checkout });
}

/** Slopweaver's marketplace entry as this scope may see it: the hook needs it present, a foreground run may add it. */
function plannedEntry({
  paths,
  scope,
}: {
  paths: SyncPaths;
  scope: SyncScope;
}): Result<PersonalMarketplaceEntry | { readonly skip: string }, CodexPluginSyncError> {
  if (scope === "update-installed") {
    return personalMarketplaceEntry({ userHome: paths.userHome }).map((entry) =>
      "skip" in entry ? { skip: `${entry.skip} — nothing is installed; run \`${FOREGROUND_SYNC_COMMAND}\`` } : entry,
    );
  }
  return personalMarketplacePlan({ userHome: paths.userHome }).map(({ plan }) =>
    plan.kind === "skip" ? { skip: plan.why } : plan.entry,
  );
}

/**
 * The commit a home's stamp records, or undefined for every state that is not a readable install. Absent,
 * invalid and unreadable are each named so a new state cannot inherit one of their meanings silently: the hook
 * leaves all three untouched and a foreground run installs over all three, exactly as for no stamp.
 */
function installedCommitOf({ state }: { state: PluginInstallState }): string | undefined {
  switch (state.kind) {
    case "installed":
      return state.commit;
    case "absent":
    case "invalid":
    case "unreadable":
      return undefined;
    default: {
      const unhandled: never = state;
      return unhandled;
    }
  }
}

/** What one home needs: a refresh, nothing, or — in the hook's scope or for a missing home — no write at all. */
function decideHome({
  home,
  head,
  exported,
  marketplace,
  scope,
}: {
  home: CodexPluginHome;
  head: string;
  exported: string | undefined;
  marketplace: string;
  scope: SyncScope;
}): HomeDecision {
  if (!existsSync(home.codexHome)) {
    return home.registered
      ? { action: "missing", home, why: "the registered Codex home has no directory" }
      : { action: "untouched", home, why: "no Codex home here" };
  }
  const installed = installedCommitOf({ state: pluginInstallState({ codexHome: home.codexHome, marketplace }) });
  if (installed === undefined && scope === "update-installed") {
    return { action: "untouched", home, why: `not installed here — run \`${FOREGROUND_SYNC_COMMAND}\`` };
  }
  const decision = syncDecision({ exported, head, installed });
  return { action: decision.refresh ? "refresh" : "current", home, why: decision.why };
}

/**
 * Resolve what this checkout would publish and what each home needs — reads only, so `--decide` can call it.
 *
 * @param paths the directories involved
 * @param mainCheckouts the profile's declared main checkout paths
 * @param homes every Codex home to keep
 * @param scope which writes the run that follows may make
 * @returns the plan, a skip with its reason, or why it could not be resolved
 */
export function planFleetSync({
  paths,
  mainCheckouts,
  homes,
  scope,
}: {
  paths: SyncPaths;
  mainCheckouts: readonly string[];
  homes: readonly CodexPluginHome[];
  scope: SyncScope;
}): Result<FleetSyncPlan | { readonly skip: string }, CodexPluginSyncError> {
  const published = publishableCheckout({ mainCheckouts, paths });
  if (published.isErr()) {
    return err(published.error);
  }
  if ("skip" in published.value) {
    return ok({ skip: published.value.skip });
  }
  const { head } = published.value;
  const entry = plannedEntry({ paths, scope });
  if (entry.isErr()) {
    return err(entry.error);
  }
  if ("skip" in entry.value) {
    return ok({ skip: entry.value.skip });
  }
  const marketplace = entry.value.marketplace;
  const exportDir = join(paths.exportRoot, CODEX_PLUGIN_NAME);
  const exported = stampCommitOf({ document: readJsonFile({ path: join(exportDir, SOURCE_STAMP_RELATIVE) }) });
  const decided = homes.map((home) => decideHome({ exported, head, home, marketplace, scope }));
  return ok({ entry: entry.value, exportDir, head, homes: decided });
}

/**
 * Whether a planned run has anything to write — the post-merge hook's `--decide` question.
 *
 * @param plan what {@link planFleetSync} resolved
 * @returns true when at least one home needs a refresh
 */
export function fleetSyncDue({ plan }: { plan: FleetSyncPlan }): boolean {
  return plan.homes.some((decision) => decision.action === "refresh");
}

/**
 * The outcome of a run that only decided and found nothing due: each home's decision as its line, nothing
 * written. Only called when {@link fleetSyncDue} is false, so no decision here is a refresh.
 *
 * @param plan what {@link planFleetSync} resolved
 * @returns one outcome per home, a missing registered home a failure
 */
export function decidedOutcome({ plan }: { plan: FleetSyncPlan }): SyncOutcome {
  const homes = plan.homes.map((decision): HomeSyncOutcome => {
    const { codexHome } = decision.home;
    if (decision.action === "missing") {
      return { codexHome, did: "failed", error: CodexPluginSyncErrors.codexHomeMissing({ codexHome }) };
    }
    if (decision.action === "current") {
      return { codexHome, did: "current", trusted: undefined, why: decision.why };
    }
    return { codexHome, did: "untouched", why: decision.why };
  });
  return { did: "synced", homes };
}
