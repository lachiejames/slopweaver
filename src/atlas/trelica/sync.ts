/**
 * Publish the two API surfaces: the vendor's own published documents, and the first-party calls this atlas
 * makes with the owner's signed-in session.
 *
 * ## The published map and the published DATA are two different claims, and each gets its own cell
 *
 * MEASURED: the documents parse in full and the API they describe answers `403` to the session
 * cookie that authorises every first-party call, because it wants an OAuth2 client this installation does
 * not hold. A single cell could only have said one of those, and whichever it said would have been false
 * about the other — a complete map read as reachable data, or reachable data read as an unread map. So
 * `published-api` is `synced` for the declared surface and a second cell says `not-configured` for its
 * data, naming exactly what would fill it.
 *
 * ## Entities come from the first-party channel, which is the fallback ruling applied
 *
 * `docs/atlas-intent/07-browser-fallback.md`: the browser is the FALLBACK, so a surface an API can answer is ingested
 * through the API. Every entity kind here is fetched rather than scraped out of a walk's captured bodies,
 * and the walk's own rows stay `discovery` evidence about the surface.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { responseFieldPaths } from "../kit/responseShape.js";

import { trelicaAiGaps, trelicaAiKindFiles } from "./aiSync.js";
import { trelicaApiObservedGaps, trelicaApiRechecks } from "./apiGaps.js";
import { apiKindFiles, type TrelicaMergedChannels } from "./apiKindFiles.js";
import { TRELICA_PATH_CAP, TRELICA_PATH_DEPTH, TRELICA_SEGMENTS, trelicaSecretsPruned } from "./browserReduction.js";
import type { TrelicaCallResult } from "./client.js";
import type { TrelicaEntityKind } from "./entityList.js";
import { trelicaEntityKindFiles } from "./entitySync.js";
import type { TrelicaFirstPartyRun } from "./firstPartyRun.js";
import { reconcileTrelicaGaps } from "./gaps.js";
import { TRELICA_CALLS } from "./inventory.js";
import { storedTrelicaKindFile as storedKindFile, trelicaSyncManifest as syncManifest } from "./kindFiles.js";
import { mergeTrelicaChannel } from "./merge.js";
import type { TrelicaAtlasKindFile } from "./model.js";
import {
  projectTrelicaApps,
  projectTrelicaFirstPartyMethods,
  projectTrelicaPublishedMethods,
  projectTrelicaRoles,
} from "./projection.js";
import type { TrelicaPublishedSurface } from "./publishedSpec.js";
import {
  publishTrelicaAtlas,
  readTrelicaAtlas,
  type TrelicaAtlasPaths,
  type TrelicaAtlasSnapshot,
  withTrelicaPublishLock,
} from "./store.js";

/** What publishing the API surfaces did. */
export interface TrelicaSyncOutcome {
  readonly publishedOperations: number;
  readonly publishedDocumentsRead: number;
  readonly publishedDocumentsUnreadable: number;
  readonly apps: number;
  readonly roles: number;
  /** Cost-explorer rows held this run, across every dimension. */
  readonly aiUsage: number;
  readonly aiAlerts: number;
  /** Entities each 15-Oct kind read whole observed this run; a kind that kept what it held is absent. */
  readonly entities: Readonly<Partial<Record<TrelicaEntityKind, number>>>;
  /** Runs whose step detail was read fresh, reused unchanged, or could not be read. */
  readonly runSteps: { readonly read: number; readonly reused: number; readonly unread: number };
  readonly openGaps: number;
  readonly written: readonly string[];
}

/** The response field names each answered call returned, reduced to names before anything is stored. */
function fieldNamesByCall({ results }: { results: readonly TrelicaCallResult[] }): ReadonlyMap<string, string[]> {
  const byCall = new Map<string, string[]>();
  for (const result of results) {
    const fields = new Set<string>();
    for (const item of result.items.slice(0, 50)) {
      for (const path of responseFieldPaths({
        body: trelicaSecretsPruned({ value: item }),
        classify: TRELICA_SEGMENTS,
        depthCap: TRELICA_PATH_DEPTH,
      })) {
        fields.add(path);
      }
    }
    byCall.set(result.callId, [...fields].toSorted().slice(0, TRELICA_PATH_CAP));
  }
  return byCall;
}

/** The records one call returned, or an empty list when it did not answer. */
function itemsOf({ run, callId }: { run: TrelicaFirstPartyRun; callId: string }): readonly unknown[] {
  return run.results.find((result) => result.callId === callId)?.items ?? [];
}

/**
 * Compile the published documents and make the first-party calls, then publish both channels.
 *
 * @param paths the resolved atlas paths
 * @param surface every published document that parsed, and every one that did not
 * @param run what the first-party calls returned
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason it could not be
 */
export function publishTrelicaApiSurfaces({
  paths,
  surface,
  run,
  at,
}: {
  paths: TrelicaAtlasPaths;
  surface: TrelicaPublishedSurface;
  run: TrelicaFirstPartyRun;
  at: string;
}): Result<TrelicaSyncOutcome> {
  return withTrelicaPublishLock({
    nowIso: at,
    paths,
    publish: () => publishApiSurfaces({ at, paths, run, surface }),
  });
}

/** Every kind's merged entity list for one run, or the first reason a merge could not be made. */
function mergeAllChannels({
  snapshot,
  surface,
  run,
  at,
}: {
  snapshot: TrelicaAtlasSnapshot;
  surface: TrelicaPublishedSurface;
  run: TrelicaFirstPartyRun;
  at: string;
}): Result<TrelicaMergedChannels> {
  const storedMethods = storedKindFile({ at, kind: "method", snapshot });
  const storedApps = storedKindFile({ at, kind: "app", snapshot });
  const storedRoles = storedKindFile({ at, kind: "role", snapshot });

  const publishedMethods = projectTrelicaPublishedMethods({ at, surface });
  const withPublished = mergeTrelicaChannel({
    at,
    channel: "published-api",
    observed: publishedMethods,
    stored: storedMethods.entities,
  });
  if (withPublished.isErr()) {
    return err(withPublished.error);
  }
  const withFirstParty = mergeTrelicaChannel({
    at,
    channel: "first-party-api",
    observed: projectTrelicaFirstPartyMethods({
      at,
      fieldNames: fieldNamesByCall({ results: run.results }),
      results: run.results,
    }),
    stored: withPublished.value,
  });
  if (withFirstParty.isErr()) {
    return err(withFirstParty.error);
  }
  const entities = mergeEntityKinds({ at, run, storedApps: storedApps.entities, storedRoles: storedRoles.entities });
  if (entities.isErr()) {
    return err(entities.error);
  }
  return ok({
    ...entities.value,
    methods: withFirstParty.value,
    publishedMethods: publishedMethods.length,
  });
}

/** Merge the two entity kinds this sync fetches, both onto the first-party channel. */
function mergeEntityKinds({
  storedApps,
  storedRoles,
  run,
  at,
}: {
  storedApps: readonly TrelicaAtlasKindFile["entities"][number][];
  storedRoles: readonly TrelicaAtlasKindFile["entities"][number][];
  run: TrelicaFirstPartyRun;
  at: string;
}): Result<{
  apps: readonly TrelicaAtlasKindFile["entities"][number][];
  roles: readonly TrelicaAtlasKindFile["entities"][number][];
  freshApps: number;
  freshRoles: number;
}> {
  const apps = projectTrelicaApps({
    at,
    catalog: itemsOf({ callId: TRELICA_CALLS.appCatalog.id, run }),
    inventory: itemsOf({ callId: TRELICA_CALLS.appInventory.id, run }),
  });
  const mergedApps = mergeTrelicaChannel({ at, channel: "first-party-api", observed: apps, stored: storedApps });
  if (mergedApps.isErr()) {
    return err(mergedApps.error);
  }
  const roles = projectTrelicaRoles({ at, records: itemsOf({ callId: TRELICA_CALLS.roles.id, run }) });
  const mergedRoles = mergeTrelicaChannel({ at, channel: "first-party-api", observed: roles, stored: storedRoles });
  if (mergedRoles.isErr()) {
    return err(mergedRoles.error);
  }
  return ok({ apps: mergedApps.value, freshApps: apps.length, freshRoles: roles.length, roles: mergedRoles.value });
}

/** The critical section: read the generation, merge both API channels onto it, and publish. */
// The merge, the gap reconciliation, the three kind files and the manifest stamp are each a named function
// in this module or a sibling one; these lines are the error checks that make each of them a `Result`.
// max-lines-exempt: one publish shell over one snapshot
function publishApiSurfaces({
  paths,
  surface,
  run,
  at,
}: {
  paths: TrelicaAtlasPaths;
  surface: TrelicaPublishedSurface;
  run: TrelicaFirstPartyRun;
  at: string;
}): Result<TrelicaSyncOutcome> {
  const snapshot = readTrelicaAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const merged = mergeAllChannels({ at, run, snapshot: snapshot.value, surface });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const storedMethods = storedKindFile({ at, kind: "method", snapshot: snapshot.value });
  const ai = trelicaAiKindFiles({
    at,
    run,
    storedAlerts: storedKindFile({ at, kind: "ai-alert", snapshot: snapshot.value }),
    storedUsage: storedKindFile({ at, kind: "ai-usage", snapshot: snapshot.value }),
  });
  if (ai.isErr()) {
    return err(ai.error);
  }
  const aiGaps = trelicaAiGaps({ at, run, unprojected: ai.value.unprojected });
  const owned = trelicaEntityKindFiles({ at, entities: run.entities, snapshot: snapshot.value });
  if (owned.isErr()) {
    return err(owned.error);
  }
  const gaps = reconcileTrelicaGaps({
    at,
    observed: [...trelicaApiObservedGaps({ at, run, surface }), ...aiGaps.observed, ...owned.value.observed],
    rechecks: [...trelicaApiRechecks({ run, surface }), ...aiGaps.rechecks, ...owned.value.rechecks],
    runFailed: false,
    stored: storedMethods.gaps,
  });
  if (gaps.isErr()) {
    return err(gaps.error);
  }

  const { methodFile, appFile, roleFile } = apiKindFiles({
    at,
    gaps: gaps.value,
    merged: merged.value,
    run,
    snapshot: snapshot.value,
    storedMethods,
    surface,
  });

  const files = {
    ...owned.value.files,
    "ai-alert": ai.value.alertFile,
    "ai-usage": ai.value.usageFile,
    app: appFile,
    method: methodFile,
    role: roleFile,
  };
  const { counts, deferred } = owned.value;
  const published = publishTrelicaAtlas({
    derivedFrom: snapshot.value.manifest,
    files,
    manifest: syncManifest({ at, deferred, files, manifest: snapshot.value.manifest }),
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  const { read, reused, unread } = run.entities.steps;
  return ok({
    aiAlerts: ai.value.freshAlerts,
    aiUsage: ai.value.freshUsage,
    apps: merged.value.freshApps,
    entities: counts,
    runSteps: { read, reused, unread },
    openGaps: gaps.value.filter((gap) => gap.status === "open").length,
    publishedDocumentsRead: surface.documents.length,
    publishedDocumentsUnreadable: surface.unreadable.length,
    publishedOperations: merged.value.publishedMethods,
    roles: merged.value.freshRoles,
    written: published.value,
  });
}
