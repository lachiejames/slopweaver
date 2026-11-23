/**
 * Publish what the browser walk saw into the atlas's `page` kind and the `method` kind's browser channel.
 *
 * ## Neither channel can truncate the other, and that is a mechanism rather than a convention
 *
 * `sync.ts` publishes `method`'s `api` channel and the whole `family` kind, and omits `page`; this publishes
 * `page` and merges only `method`'s `browser` channel (`merge.ts`); and the kit's `publishAtlas` leaves an
 * omitted kind's file untouched. So a walk that runs while a sync is stale cannot blank the declared
 * operations, and a sync cannot blank the walk. Since the disjointness between those two sets is this
 * atlas's central finding, that is load-bearing rather than tidy.
 *
 * ## Coverage is graded against the DECLARED denominator, and photographing counts
 *
 * `page`'s coverage cell says how many declared pages the walk landed on AND photographed. A run that
 * reached twelve of forty reports `deferred` with the fraction in its reason rather than `synced` because it
 * wrote some rows. A run that landed on every page and photographed none of them is likewise `deferred`: the
 * owner asked for the screenshots by name, so a cell that called that a success would be reporting the
 * opposite of what happened.
 */
import { err, ok, type Result } from "../../lib/result.js";
import {
  assembleWalkKind,
  publishPageWalk,
  refuseUndeclaredWalk,
  stampedWalkKinds,
  walkTally,
} from "../kit/walkPublish.js";

import { inventoryGap, walkPageGaps, walkRechecks } from "./browserGaps.js";
import { XERO_BROWSER_PAGES } from "./browserPages.js";
import type { XeroBrowserWalkResult, XeroPageObservation } from "./browserWalk.js";
import { failedXeroCoverageCell, storedXeroCoverageCell, succeededXeroCoverageCell } from "./coverage.js";
import { openXeroGap, reconcileXeroGaps } from "./gaps.js";
import { mergeXeroChannel } from "./merge.js";
import {
  emptyXeroKindFile,
  initialXeroManifest,
  type XeroAtlasEntity,
  type XeroAtlasGap,
  type XeroAtlasKindFile,
  type XeroAtlasManifest,
  type XeroCoverageCell,
} from "./model.js";
import { projectXeroBrowserMethods, projectXeroPages } from "./projection.js";
import { publishXeroAtlas, readXeroAtlas, withXeroPublishLock, type XeroAtlasPaths } from "./store.js";

/**
 * The surface name the page walk's coverage is reported under.
 *
 * @internal
 */
export const XERO_WALK_SURFACE = "browser-walk";

/**
 * The surface name the operations observed during that walk are reported under.
 *
 * @internal
 */
export const XERO_CLIENT_SURFACE = "web-client";

/**
 * What publishing a walk did.
 *
 * @internal
 */
export interface XeroBrowserSurfaceOutcome {
  readonly declaredCount: number;
  readonly reachedCount: number;
  readonly photographedCount: number;
  readonly operationCount: number;
  readonly written: readonly string[];
}

/** The one coverage cell a walk writes for the `page` kind, graded against the DECLARED denominator. */
function pageCoverageCell({
  pages,
  at,
  stored,
}: {
  pages: readonly XeroPageObservation[];
  at: string;
  stored: XeroAtlasKindFile;
}): XeroCoverageCell {
  const { reached, photographed } = walkTally({ pages });
  // The DECLARED constant, never `pages.length` — see `refuseUndeclaredWalk`.
  const declaredCount = XERO_BROWSER_PAGES.length;
  const reason =
    `${String(reached)} of ${String(declaredCount)} declared page(s) reached, ` +
    `${String(photographed)} of those also photographed`;
  if (reached === declaredCount && photographed === declaredCount) {
    return succeededXeroCoverageCell({
      artifacts: [],
      at,
      channel: "browser",
      reason,
      role: "authoritative",
      scope: "declared-pages",
      state: "synced",
      surface: XERO_WALK_SURFACE,
    });
  }
  return failedXeroCoverageCell({
    channel: "browser",
    previous: storedXeroCoverageCell({ coverage: stored.coverage, surface: XERO_WALK_SURFACE }),
    reason,
    role: "authoritative",
    scope: "declared-pages",
    state: "deferred",
    surface: XERO_WALK_SURFACE,
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
  walk: XeroBrowserWalkResult;
  operationCount: number;
  at: string;
  stored: XeroAtlasKindFile;
}): XeroCoverageCell {
  const { reached } = walkTally({ pages: walk.pages });
  const reason = `${String(operationCount)} distinct first-party operation(s) observed across ${String(reached)} reached page(s)`;
  if (walk.sessionLost) {
    return failedXeroCoverageCell({
      channel: "browser",
      previous: storedXeroCoverageCell({ coverage: stored.coverage, surface: XERO_CLIENT_SURFACE }),
      reason: `${reason} — the walk stopped early because the browser session was lost`,
      role: "discovery",
      scope: "operations-on-declared-pages",
      state: "deferred",
      surface: XERO_CLIENT_SURFACE,
      unblockedBy: "sign in to Xero in your own Chrome and run the walk again",
    });
  }
  // `discovery` rather than `corroborating`: seeing the client call an operation establishes that the
  // operation EXISTS. It establishes nothing about what an OAuth connection may ask for, and a cell that
  // claimed otherwise would turn a lead into a capability.
  return succeededXeroCoverageCell({
    artifacts: [],
    at,
    channel: "browser",
    reason,
    role: "discovery",
    scope: "operations-on-declared-pages",
    state: "synced",
    surface: XERO_CLIENT_SURFACE,
  });
}

/** Every gap this walk observed, including the standing one about its own denominator. */
function observedGaps({ walk, at }: { walk: XeroBrowserWalkResult; at: string }): readonly XeroAtlasGap[] {
  const gaps = [...walkPageGaps({ at, pages: walk.pages }), inventoryGap({ at })];
  if (!walk.sessionLost) {
    return gaps;
  }
  return [
    ...gaps,
    openXeroGap({
      at,
      condition: "browser-surface-unreadable",
      fields: [],
      kind: null,
      reason: "the browser session was lost part-way through the walk, so the pages after it were not attempted",
      scope: XERO_WALK_SURFACE,
      surfaces: ["browser"],
    }),
  ];
}

/**
 * Publish one walk into the atlas's browser surface.
 *
 * @param walk what the walk observed
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason it could not be
 */
export function publishXeroBrowserWalk({
  walk,
  paths,
  at,
}: {
  walk: XeroBrowserWalkResult;
  paths: XeroAtlasPaths;
  at: string;
}): Result<XeroBrowserSurfaceOutcome> {
  const covers = refuseUndeclaredWalk({
    declaredSurfaces: XERO_BROWSER_PAGES.map((declared) => declared.surface),
    pages: walk.pages,
  });
  if (covers.isErr()) {
    return err(covers.error);
  }
  // The read and the write are one critical section — see `withXeroPublishLock`.
  return withXeroPublishLock({ nowIso: at, paths, publish: () => publishWalkUnderLock({ at, paths, walk }) });
}

/** The manifest the store held, or a fresh one stamped `at` when it held none. */
function heldManifest({ manifest, at }: { manifest: XeroAtlasManifest | null; at: string }): XeroAtlasManifest {
  if (manifest == null) {
    return initialXeroManifest({ updatedAt: at });
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
  manifest: XeroAtlasManifest | null;
  pageCount: number;
  methodCount: number;
  at: string;
}): XeroAtlasManifest {
  const base = heldManifest({ at, manifest });
  return { ...base, kinds: { ...base.kinds, ...stampedWalkKinds({ at, methodCount, pageCount }) }, updatedAt: at };
}

/** The critical section: read the generation, merge the browser channel onto it, and publish. */
function publishWalkUnderLock({
  walk,
  paths,
  at,
}: {
  walk: XeroBrowserWalkResult;
  paths: XeroAtlasPaths;
  at: string;
}): Result<XeroBrowserSurfaceOutcome> {
  return publishPageWalk({
    declaredCount: XERO_BROWSER_PAGES.length,
    directory: paths.directory,
    emptyFile: ({ kind }) => emptyXeroKindFile({ kind, updatedAt: at }),
    manifestFor: ({ manifest, methodCount, pageCount }) => walkManifest({ at, manifest, methodCount, pageCount }),
    mergeMethodFile: ({ walk: checked, observed, stored }) => mergedMethodFile({ at, observed, stored, walk: checked }),
    mergePageFile: ({ walk: checked, stored }) => mergedPageFile({ at, stored, walk: checked }),
    projectMethods: ({ walk: checked }) => projectXeroBrowserMethods({ at, pages: checked.pages }),
    publish: ({ derivedFrom, files, manifest }) => publishXeroAtlas({ derivedFrom, files, manifest, paths }),
    read: () => readXeroAtlas({ paths }),
    walk,
  });
}

/** Merge this walk's page observations and gaps onto the stored page kind. */
function mergedPageFile({
  walk,
  stored,
  at,
}: {
  walk: XeroBrowserWalkResult;
  stored: XeroAtlasKindFile;
  at: string;
}): Result<XeroAtlasKindFile> {
  const fields = assembleWalkKind({
    at,
    cell: pageCoverageCell({ at, pages: walk.pages, stored }),
    merge: () =>
      mergeXeroChannel({
        at,
        channel: "browser",
        observed: projectXeroPages({ at, pages: walk.pages }),
        stored: stored.entities,
      }),
    reconcile: () =>
      reconcileXeroGaps({
        at,
        observed: observedGaps({ at, walk }),
        rechecks: walkRechecks({ pages: walk.pages }),
        runFailed: walk.sessionLost,
        stored: stored.gaps,
      }),
    stored,
    surface: XERO_WALK_SURFACE,
  });
  return fields.isErr() ? err(fields.error) : ok({ ...stored, ...fields.value, kind: "page" });
}

/** Merge this walk's observed operations onto the stored method kind's BROWSER channel only. */
function mergedMethodFile({
  walk,
  observed,
  stored,
  at,
}: {
  walk: XeroBrowserWalkResult;
  observed: readonly XeroAtlasEntity[];
  stored: XeroAtlasKindFile;
  at: string;
}): Result<XeroAtlasKindFile> {
  const fields = assembleWalkKind({
    at,
    cell: methodCoverageCell({ at, operationCount: observed.length, stored, walk }),
    merge: () => mergeXeroChannel({ at, channel: "browser", observed, stored: stored.entities }),
    // The method kind's gaps are the sync's, not the walk's: this pass observes operations and raises no gap
    // of its own, so carrying them forward unchanged is the correct no-op rather than an omission.
    reconcile: () => ok(stored.gaps),
    stored,
    surface: XERO_CLIENT_SURFACE,
  });
  return fields.isErr() ? err(fields.error) : ok({ ...stored, ...fields.value, kind: "method" });
}
