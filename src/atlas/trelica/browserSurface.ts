/**
 * Publish the BROWSER surface: what the walk reached, what it photographed, and what the client asked for.
 *
 * It writes the `page` kind and the `browser` channel of the `method` kind, and touches nothing else. The
 * kit's `publishAtlas` leaves an omitted kind's file untouched and `merge.ts`'s fold is channel-scoped, so
 * a walk cannot blank a row either API channel owns.
 *
 * ## Two declared pages that photograph the same bytes evidence nothing
 *
 * The check is `kit/indistinguishableShots.ts` and its history is there. It catches that whole class rather
 * than only the vendor-specific case an empty-shell constant covers.
 *
 * ## The cell is `synced` only when every declared page was reached AND photographed
 *
 * A run that landed everywhere and photographed nothing reports `deferred`. The owner asked for the
 * screenshots by name.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { withdrawIndistinguishableShots } from "../kit/indistinguishableShots.js";

import { kindFileWithCell } from "../kit/kindFileWithCell.js";
import { observedGaps, rechecks } from "./browserGaps.js";
import { TRELICA_BROWSER_PAGES } from "./browserPages.js";
import { projectTrelicaBrowserMethods, projectTrelicaPages } from "./browserProjection.js";
import type { TrelicaBrowserWalkResult, TrelicaPageObservation } from "./browserWalk.js";

import { succeededTrelicaCoverageCell } from "./coverage.js";
import { reconcileTrelicaGaps } from "./gaps.js";
import { mergeTrelicaChannel } from "./merge.js";
import {
  emptyTrelicaKindFile,
  initialTrelicaManifest,
  type TrelicaAtlasGap,
  type TrelicaAtlasKindFile,
  type TrelicaAtlasManifest,
} from "./model.js";
import { publishTrelicaAtlas, readTrelicaAtlas, type TrelicaAtlasPaths, withTrelicaPublishLock } from "./store.js";

/**
 * The surface name the browser channel's page coverage is reported under.
 *
 * @internal
 */
export const TRELICA_WEB_APP_SURFACE = "web-app";

/**
 * The surface name the browser channel's OBSERVED-operation coverage is reported under.
 *
 * A separate surface from the pages, because they answer different questions and one can succeed while the
 * other does not: a walk can reach every page and observe no call at all.
 *
 * @internal
 */
export const TRELICA_WEB_CLIENT_SURFACE = "web-client-operations";

/**
 * What publishing the browser surface did.
 *
 * @internal
 */
export interface TrelicaBrowserSurfaceOutcome {
  readonly pagesDeclared: number;
  readonly pagesReached: number;
  readonly pagesPhotographed: number;
  readonly operationsObserved: number;
  readonly openGaps: number;
  readonly written: readonly string[];
}

/**
 * Mark every page whose screenshot is byte-identical to another page's.
 *
 * Two declared pages cannot legitimately be the same picture: either the client rendered the same view for
 * both — in which case at most one of them is the page that was asked for — or the walk photographed
 * something that is not the page at all. Either way the shots evidence nothing, so both lose their
 * screenshot claim and each raises its own gap.
 *
 * @param pages every declared page's observation
 * @returns the observations, with any indistinguishable screenshot claim withdrawn
 *
 * @internal
 */
export function markIndistinguishablePages({
  pages,
}: {
  pages: readonly TrelicaPageObservation[];
}): readonly TrelicaPageObservation[] {
  return withdrawIndistinguishableShots({
    pages,
    reason:
      "this page's screenshot is byte-identical to another declared page's, so neither picture evidences the page it was taken for",
    withdraw: ({ page, reason }) => ({ ...page, artifacts: [], screenshotMissingBecause: reason }),
  });
}

/** Whether every declared page was both reached and photographed — the only `synced` condition. */
function isFullyWalked({ pages }: { pages: readonly TrelicaPageObservation[] }): boolean {
  return (
    pages.length === TRELICA_BROWSER_PAGES.length &&
    pages.every((page) => page.attempted && page.unreachableBecause === null && page.screenshotMissingBecause === null)
  );
}

/**
 * Publish what a walk saw.
 *
 * @param paths the resolved atlas paths
 * @param walk what the walk produced
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason it could not be
 */
export function publishTrelicaBrowserSurface({
  paths,
  walk,
  at,
}: {
  paths: TrelicaAtlasPaths;
  walk: TrelicaBrowserWalkResult;
  at: string;
}): Result<TrelicaBrowserSurfaceOutcome> {
  // The read and the write are one critical section: another publisher landing between them would have its
  // rows replaced by files derived from the generation this one read.
  return withTrelicaPublishLock({
    nowIso: at,
    paths,
    publish: () => publishWalk({ at, paths, walk }),
  });
}

/** The critical section: read the generation, merge the browser channel onto it, and publish. */
// The steps below are each a named function beside this one; these lines are the error checks that make
// each of them a `Result` rather than a throw, which is what a publish shell IS.
// max-lines-exempt: one publish shell over one snapshot, the same shape as `sync.ts`'s
function publishWalk({
  paths,
  walk,
  at,
}: {
  paths: TrelicaAtlasPaths;
  walk: TrelicaBrowserWalkResult;
  at: string;
}): Result<TrelicaBrowserSurfaceOutcome> {
  const snapshot = readTrelicaAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const pages = markIndistinguishablePages({ pages: walk.pages });
  const storedPages = snapshot.value.files.page ?? emptyTrelicaKindFile({ kind: "page", updatedAt: at });
  const storedMethods = snapshot.value.files.method ?? emptyTrelicaKindFile({ kind: "method", updatedAt: at });
  const observedMethods = projectTrelicaBrowserMethods({ at, pages });
  const merged = mergeWalkChannel({ at, observedMethods, pages, storedMethods, storedPages, walk });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const { entities: mergedPages, methods: mergedMethods, gaps } = merged.value;

  const reached = pages.filter((page) => page.attempted && page.unreachableBecause === null);
  const photographed = reached.filter((page) => page.artifacts.length > 0);
  const pageFile = pageFileWith({
    at,
    entities: mergedPages,
    gaps,
    photographed,
    reached,
    sessionLost: walk.sessionLost,
    stored: storedPages,
    walked: isFullyWalked({ pages }),
  });
  const methodFile = browserMethodFileWith({
    at,
    entities: mergedMethods,
    observedCount: observedMethods.length,
    reachedCount: reached.length,
    stored: storedMethods,
  });

  const published = publishTrelicaAtlas({
    derivedFrom: snapshot.value.manifest,
    files: { method: methodFile, page: pageFile },
    manifest: walkManifest({
      at,
      manifest: snapshot.value.manifest,
      methodCount: methodFile.entities.length,
      pageCount: pageFile.entities.length,
      sessionLost: walk.sessionLost,
    }),
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({
    openGaps: gaps.filter((gap) => gap.status === "open").length,
    operationsObserved: observedMethods.length,
    pagesDeclared: TRELICA_BROWSER_PAGES.length,
    pagesPhotographed: photographed.length,
    pagesReached: reached.length,
    written: published.value,
  });
}

/** Merge the browser channel onto both kinds this walk writes, and reconcile the page kind's gaps. */
function mergeWalkChannel({
  storedPages,
  storedMethods,
  pages,
  observedMethods,
  walk,
  at,
}: {
  storedPages: TrelicaAtlasKindFile;
  storedMethods: TrelicaAtlasKindFile;
  pages: readonly TrelicaPageObservation[];
  observedMethods: readonly TrelicaAtlasKindFile["entities"][number][];
  walk: TrelicaBrowserWalkResult;
  at: string;
}): Result<{
  entities: readonly TrelicaAtlasKindFile["entities"][number][];
  methods: readonly TrelicaAtlasKindFile["entities"][number][];
  gaps: readonly TrelicaAtlasGap[];
}> {
  const mergedPages = mergeTrelicaChannel({
    at,
    channel: "browser",
    observed: projectTrelicaPages({ at, pages }),
    stored: storedPages.entities,
  });
  if (mergedPages.isErr()) {
    return err(mergedPages.error);
  }
  const mergedMethods = mergeTrelicaChannel({
    at,
    channel: "browser",
    observed: observedMethods,
    stored: storedMethods.entities,
  });
  if (mergedMethods.isErr()) {
    return err(mergedMethods.error);
  }
  const gaps = reconcileTrelicaGaps({
    at,
    observed: observedGaps({ at, pages }),
    rechecks: rechecks({ pages }),
    runFailed: walk.sessionLost,
    stored: storedPages.gaps,
  });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  return ok({ entities: mergedPages.value, gaps: gaps.value, methods: mergedMethods.value });
}

/** The page kind with the walk's own cell replaced and every other surface's left alone. */
function pageFileWith({
  stored,
  entities,
  gaps,
  reached,
  photographed,
  walked,
  sessionLost,
  at,
}: {
  stored: TrelicaAtlasKindFile;
  entities: readonly TrelicaAtlasKindFile["entities"][number][];
  gaps: readonly TrelicaAtlasGap[];
  reached: readonly TrelicaPageObservation[];
  photographed: readonly TrelicaPageObservation[];
  walked: boolean;
  sessionLost: boolean;
  at: string;
}): TrelicaAtlasKindFile {
  const reason =
    `${String(reached.length)} of ${String(TRELICA_BROWSER_PAGES.length)} declared page(s) reached, ` +
    `${String(photographed.length)} photographed` +
    (sessionLost ? " — the walk stopped early because the session was lost" : "");
  return kindFileWithCell({
    at,
    cell: succeededTrelicaCoverageCell({
      artifacts: photographed.flatMap((page) => page.artifacts),
      at,
      channel: "browser",
      reason,
      role: "corroborating",
      scope: "declared-pages",
      state: walked ? "synced" : "deferred",
      surface: TRELICA_WEB_APP_SURFACE,
    }),
    entities,
    gaps,
    stored,
  });
}

/** The method kind with the walk's observed-operation cell replaced and both API cells left alone. */
function browserMethodFileWith({
  stored,
  entities,
  observedCount,
  reachedCount,
  at,
}: {
  stored: TrelicaAtlasKindFile;
  entities: readonly TrelicaAtlasKindFile["entities"][number][];
  observedCount: number;
  reachedCount: number;
  at: string;
}): TrelicaAtlasKindFile {
  return kindFileWithCell({
    at,
    cell: succeededTrelicaCoverageCell({
      artifacts: [],
      at,
      channel: "browser",
      reason:
        `${String(observedCount)} distinct first-party operation(s) observed across ` +
        `${String(reachedCount)} reached page(s). Observing a call establishes that the operation EXISTS, ` +
        "never that an ordinary credential may make it",
      role: "discovery",
      scope: "observed-operations",
      state: reachedCount > 0 ? "synced" : "deferred",
      surface: TRELICA_WEB_CLIENT_SURFACE,
    }),
    entities,
    stored,
  });
}

/** Stamp the two kinds this walk wrote, leaving `app` and `role` exactly as the sync left them. */
function walkManifest({
  manifest,
  pageCount,
  methodCount,
  sessionLost,
  at,
}: {
  manifest: TrelicaAtlasManifest | null;
  pageCount: number;
  methodCount: number;
  sessionLost: boolean;
  at: string;
}): TrelicaAtlasManifest {
  const base = manifest ?? initialTrelicaManifest({ updatedAt: at });
  const outcome = sessionLost ? "failed" : "ok";
  const reasons = sessionLost ? ["the signed-in session was lost part-way through the walk"] : [];
  const lastSuccessAt = sessionLost ? base.kinds.page.lastSuccessAt : at;
  return {
    ...base,
    kinds: {
      ...base.kinds,
      method: {
        digest: null,
        entityCount: methodCount,
        lastAttempt: { at, outcome, reasons },
        lastSuccessAt: sessionLost ? base.kinds.method.lastSuccessAt : at,
      },
      page: { digest: null, entityCount: pageCount, lastAttempt: { at, outcome, reasons }, lastSuccessAt },
    },
    updatedAt: at,
  };
}
