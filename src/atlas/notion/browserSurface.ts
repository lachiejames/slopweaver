/**
 * Publish what the browser walk saw into the atlas's `page` kind and the `method` kind's browser channel.
 *
 * ## Neither channel can truncate the other, and that is a mechanism rather than a convention
 *
 * `sync.ts` publishes `method`'s `api` channel and omits `page`; this publishes `page` and merges only
 * `method`'s `browser` channel (`merge.ts`); and the kit's `publishAtlas` leaves an omitted kind's file
 * untouched. So a walk that runs while a sync is stale cannot blank the declared endpoints, and a sync
 * cannot blank the walk. Since the disjointness between those two sets is this atlas's central finding,
 * that is load-bearing rather than tidy.
 *
 * ## Coverage is graded against the DECLARED denominator, and photographing counts
 *
 * `page`'s coverage cell says how many declared pages the walk landed on AND photographed. A run that
 * reached only some of the declared pages reports `deferred` with the fraction in its reason rather than
 * `synced` because it wrote some rows — which is the failure the sibling Slack walk shipped once, reporting
 * its navigation surfaces while reaching only part of them. A run that landed on every page and photographed none of them is
 * likewise `deferred`: the owner asked for the screenshots by name, so a cell that called that a success
 * would be reporting the opposite of what happened.
 *
 * ## The routes share their kind and their surface with the settings tabs
 *
 * `settingsSurface.ts` publishes the declared settings TABS into this same `page` kind, under the same
 * `browser-walk` surface with a scope of its own. So this pass merges and stales only the ROUTE entities,
 * and carries every `settings/` entity and the tabs' coverage cell forward exactly as stored — a route walk
 * that ran after a tab walk must not make the photographed tabs read as vanished.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { sortedById } from "../kit/channelProjection.js";
import {
  assembleWalkKind,
  publishPageWalk,
  refuseUndeclaredWalk,
  stampedWalkKinds,
  walkTally,
} from "../kit/walkPublish.js";

import { inventoryGap, walkPageGaps, walkRechecks } from "./browserGaps.js";
import { NOTION_BROWSER_PAGES } from "./browserPages.js";
import type { NotionBrowserWalkResult, NotionPageObservation } from "./browserWalk.js";
import { failedNotionCoverageCell, succeededNotionCoverageCell } from "./coverage.js";
import { openNotionGap, reconcileNotionGaps } from "./gaps.js";
import { mergeNotionChannel } from "./merge.js";
import {
  emptyNotionKindFile,
  initialNotionManifest,
  type NotionAtlasEntity,
  type NotionAtlasGap,
  type NotionAtlasKindFile,
  type NotionAtlasManifest,
  type NotionCoverageCell,
} from "./model.js";
import { projectNotionBrowserMethods, projectNotionPages } from "./projection.js";
import { isSettingsTabProviderId, NOTION_SETTINGS_COVERAGE_SCOPE } from "./settingsWalk.js";
import { type NotionAtlasPaths, publishNotionAtlas, readNotionAtlas, withNotionPublishLock } from "./store.js";

/**
 * The surface name the page walk's coverage is reported under.
 *
 * @internal
 */
export const NOTION_WALK_SURFACE = "browser-walk";

/**
 * The surface name the operations observed during that walk are reported under.
 *
 * @internal
 */
export const NOTION_CLIENT_SURFACE = "web-client";

/**
 * The scope the declared ROUTES are graded under — one of the `browser-walk` surface's two cells, the other
 * being the settings tabs' ({@link NOTION_SETTINGS_COVERAGE_SCOPE}).
 */
const ROUTE_SCOPE = "declared-pages";

/**
 * What publishing a walk did.
 *
 * @internal
 */
export interface NotionBrowserSurfaceOutcome {
  readonly declaredCount: number;
  readonly reachedCount: number;
  readonly photographedCount: number;
  readonly operationCount: number;
  readonly written: readonly string[];
}

/** The stored declared-routes cell, which a partial walk keeps rather than erasing. */
function storedRouteCell({ stored }: { stored: NotionAtlasKindFile }): NotionCoverageCell | null {
  const prior = stored.coverage.find((cell) => cell.surface === NOTION_WALK_SURFACE && cell.scope === ROUTE_SCOPE);
  if (prior === undefined) {
    // No walk has graded the declared routes yet, so there is no prior success to carry.
    return null;
  }
  return prior;
}

/** The stored web-client cell, which a walk that lost its session keeps rather than erasing. */
function storedClientCell({ stored }: { stored: NotionAtlasKindFile }): NotionCoverageCell | null {
  const prior = stored.coverage.find((cell) => cell.surface === NOTION_CLIENT_SURFACE);
  if (prior === undefined) {
    // No walk has observed the web client yet, so there is no prior success to carry.
    return null;
  }
  return prior;
}

/** The one coverage cell a walk writes for the `page` kind, graded against the DECLARED denominator. */
function pageCoverageCell({
  pages,
  at,
  stored,
}: {
  pages: readonly NotionPageObservation[];
  at: string;
  stored: NotionAtlasKindFile;
}): NotionCoverageCell {
  const { reached, photographed } = walkTally({ pages });
  // The DECLARED constant, never `pages.length` — see `refuseUndeclaredWalk`.
  const declaredCount = NOTION_BROWSER_PAGES.length;
  const reason =
    `${String(reached)} of ${String(declaredCount)} declared page(s) reached, ` +
    `${String(photographed)} of those also photographed`;
  const whole = reached === declaredCount && photographed === declaredCount;
  if (whole) {
    return succeededNotionCoverageCell({
      artifacts: [],
      at,
      channel: "browser",
      reason,
      role: "authoritative",
      scope: ROUTE_SCOPE,
      state: "synced",
      surface: NOTION_WALK_SURFACE,
    });
  }
  return failedNotionCoverageCell({
    channel: "browser",
    previous: storedRouteCell({ stored }),
    reason,
    role: "authoritative",
    scope: ROUTE_SCOPE,
    state: "deferred",
    surface: NOTION_WALK_SURFACE,
    unblockedBy: "each unheld page carries its own gap naming what stopped it",
  });
}

/** The coverage cell the observed operations earn — discovery only, and never more than that. */
function methodCoverageCell({
  walk,
  operationCount,
  at,
  stored,
}: {
  walk: NotionBrowserWalkResult;
  operationCount: number;
  at: string;
  stored: NotionAtlasKindFile;
}): NotionCoverageCell {
  const { reached } = walkTally({ pages: walk.pages });
  const reason =
    `${String(operationCount)} distinct first-party operation(s) observed across ` +
    `${String(reached)} reached page(s)`;
  if (walk.sessionLost) {
    return failedNotionCoverageCell({
      channel: "browser",
      previous: storedClientCell({ stored }),
      reason: `${reason} — the walk stopped early because the browser session was lost`,
      role: "discovery",
      scope: "operations-on-declared-pages",
      state: "deferred",
      surface: NOTION_CLIENT_SURFACE,
      unblockedBy: "sign in to Notion in your own Chrome and run the walk again",
    });
  }
  // `discovery` rather than `corroborating`: seeing the client call an operation establishes that the
  // operation EXISTS. It establishes nothing about what an ordinary token may ask for, and a cell that
  // claimed otherwise would turn a lead into a capability.
  return succeededNotionCoverageCell({
    artifacts: [],
    at,
    channel: "browser",
    reason,
    role: "discovery",
    scope: "operations-on-declared-pages",
    state: "synced",
    surface: NOTION_CLIENT_SURFACE,
  });
}

/** Every gap this walk observed, including the standing one about its own denominator. */
function observedGaps({ walk, at }: { walk: NotionBrowserWalkResult; at: string }): readonly NotionAtlasGap[] {
  const gaps = [...walkPageGaps({ at, pages: walk.pages }), inventoryGap({ at })];
  if (!walk.sessionLost) {
    return gaps;
  }
  return [
    ...gaps,
    openNotionGap({
      at,
      condition: "browser-surface-unreadable",
      fields: [],
      kind: null,
      reason: "the browser session was lost part-way through the walk, so the pages after it were not attempted",
      scope: NOTION_WALK_SURFACE,
      surfaces: ["browser"],
    }),
  ];
}

/** The manifest the store held, or a fresh one stamped `at` when it held none. */
function heldManifest({ manifest, at }: { manifest: NotionAtlasManifest | null; at: string }): NotionAtlasManifest {
  if (manifest == null) {
    return initialNotionManifest({ updatedAt: at });
  }
  return manifest;
}

/** Stamp the two kinds this walk wrote, leaving anything else the manifest holds exactly as it was. */
function walkManifest({
  manifest,
  pageCount,
  methodCount,
  at,
}: {
  manifest: NotionAtlasManifest | null;
  pageCount: number;
  methodCount: number;
  at: string;
}): NotionAtlasManifest {
  const base = heldManifest({ at, manifest });
  return { ...base, kinds: { ...base.kinds, ...stampedWalkKinds({ at, methodCount, pageCount }) }, updatedAt: at };
}

/**
 * Publish one walk into the atlas's browser surface.
 *
 * @param walk what the walk observed
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason it could not be
 */
export function publishNotionBrowserWalk({
  walk,
  paths,
  at,
}: {
  walk: NotionBrowserWalkResult;
  paths: NotionAtlasPaths;
  at: string;
}): Result<NotionBrowserSurfaceOutcome> {
  const covers = refuseUndeclaredWalk({
    declaredSurfaces: NOTION_BROWSER_PAGES.map((declared) => declared.surface),
    pages: walk.pages,
  });
  if (covers.isErr()) {
    return err(covers.error);
  }
  // The read and the write are one critical section — see `withNotionPublishLock`.
  return withNotionPublishLock({ nowIso: at, paths, publish: () => publishWalkUnderLock({ at, paths, walk }) });
}

/** The critical section: read the generation, merge the browser channel onto it, and publish. */
function publishWalkUnderLock({
  walk,
  paths,
  at,
}: {
  walk: NotionBrowserWalkResult;
  paths: NotionAtlasPaths;
  at: string;
}): Result<NotionBrowserSurfaceOutcome> {
  return publishPageWalk({
    declaredCount: NOTION_BROWSER_PAGES.length,
    directory: paths.directory,
    emptyFile: ({ kind }) => emptyNotionKindFile({ kind, updatedAt: at }),
    manifestFor: ({ manifest, methodCount, pageCount }) => walkManifest({ at, manifest, methodCount, pageCount }),
    mergeMethodFile: ({ walk: checked, observed, stored }) => mergedMethodFile({ at, observed, stored, walk: checked }),
    mergePageFile: ({ walk: checked, stored }) => mergedPageFile({ at, stored, walk: checked }),
    projectMethods: ({ walk: checked }) => projectNotionBrowserMethods({ at, pages: checked.pages }),
    publish: ({ derivedFrom, files, manifest }) => publishNotionAtlas({ derivedFrom, files, manifest, paths }),
    read: () => readNotionAtlas({ paths }),
    walk,
  });
}

/** Merge this walk's page observations and gaps onto the stored page kind. */
function mergedPageFile({
  walk,
  stored,
  at,
}: {
  walk: NotionBrowserWalkResult;
  stored: NotionAtlasKindFile;
  at: string;
}): Result<NotionAtlasKindFile> {
  // The settings tabs share this kind and this surface — `settingsSurface.ts` publishes them. This pass
  // merges and stales only the routes, and carries the tabs' entities and coverage cell forward untouched.
  const tabs = stored.entities.filter((entity) => isSettingsTabProviderId({ providerId: entity.providerId }));
  const routes = stored.entities.filter((entity) => !isSettingsTabProviderId({ providerId: entity.providerId }));
  const tabCells = stored.coverage.filter(
    (cell) => cell.surface === NOTION_WALK_SURFACE && cell.scope === NOTION_SETTINGS_COVERAGE_SCOPE,
  );
  const fields = assembleWalkKind({
    at,
    cell: pageCoverageCell({ at, pages: walk.pages, stored }),
    merge: () => {
      const merged = mergeNotionChannel({
        at,
        channel: "browser",
        observed: projectNotionPages({ at, pages: walk.pages }),
        stored: routes,
      });
      if (merged.isErr()) {
        return err(merged.error);
      }
      return ok(sortedById({ entities: [...merged.value, ...tabs] }));
    },
    reconcile: () =>
      reconcileNotionGaps({
        at,
        observed: observedGaps({ at, walk }),
        rechecks: walkRechecks({ pages: walk.pages }),
        runFailed: walk.sessionLost,
        stored: stored.gaps,
      }),
    stored,
    surface: NOTION_WALK_SURFACE,
  });
  if (fields.isErr()) {
    return err(fields.error);
  }
  return ok({ ...stored, ...fields.value, coverage: [...fields.value.coverage, ...tabCells], kind: "page" });
}

/** Merge this walk's observed operations onto the stored method kind's BROWSER channel only. */
function mergedMethodFile({
  walk,
  observed,
  stored,
  at,
}: {
  walk: NotionBrowserWalkResult;
  observed: readonly NotionAtlasEntity[];
  stored: NotionAtlasKindFile;
  at: string;
}): Result<NotionAtlasKindFile> {
  const fields = assembleWalkKind({
    at,
    cell: methodCoverageCell({ at, operationCount: observed.length, stored, walk }),
    merge: () => mergeNotionChannel({ at, channel: "browser", observed, stored: stored.entities }),
    // The method kind's gaps are the sync's, not the walk's: this pass observes operations and raises no gap
    // of its own, so carrying them forward unchanged is the correct no-op rather than an omission.
    reconcile: () => ok(stored.gaps),
    stored,
    surface: NOTION_CLIENT_SURFACE,
  });
  return fields.isErr() ? err(fields.error) : ok({ ...stored, ...fields.value, kind: "method" });
}
