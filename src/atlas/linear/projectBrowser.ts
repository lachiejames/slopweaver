/**
 * The browser channel's own projection: reached pages, observed operations, and the coverage and gaps the
 * walk earned. PURE.
 *
 * Split from `projection.ts` for the reason its sibling `projectApi.ts` gives. The judgements here are all
 * about a single-page application: what a redirect means, what a missing screenshot means, what a walk that
 * stopped partway may and may not claim.
 */
import { failedCoverageCell, succeededCoverageCell } from "../kit/coverage.js";
import { openGap } from "../kit/gaps.js";

import { foldObservationGaps } from "./browserObservationGaps.js";
import {
  LINEAR_ATLAS_KINDS,
  LINEAR_ATLAS_VISIBILITY_SCOPE,
  type LinearAtlasEntity,
  type LinearAtlasGap,
  type LinearAtlasKind,
  type LinearCoverageCell,
} from "./model.js";
import {
  BROWSER_SURFACE,
  byKind,
  type ChannelProjection,
  cell,
  gap,
  type LinearBrowserReading,
  oneChannelEntity,
  priorCoverageCell,
} from "./projectionKit.js";
import type { LinearPageObservation } from "./walk.js";

/**
 * A page's own document title, as a string a reader can hold.
 *
 * An `if` rather than `?? ""` or a ternary: the house rule bans the first and the linter prefers `??` over
 * the second, so a named function spelling out both cases is the only construction that satisfies both. The
 * empty string is a real state — the page settled and declared no title — and is not the same as a page
 * that was never reached, which never gets a record here at all.
 *
 * @param page the observation to read
 * @returns the title, or the empty string that means the page declared none
 */
function titleOf({ page }: { page: LinearPageObservation }): string {
  if (page.title === null) {
    return "";
  }
  return page.title;
}

/** Project the browser channel: pages, observed operations, and the coverage the walk earned.
 * @returns the entities, coverage and gaps the browser channel earned */
export function projectBrowserChannel({
  reading,
  at,
  plannedCount,
  previous,
}: {
  reading: LinearBrowserReading;
  at: string;
  plannedCount: number;
  previous: Readonly<Record<LinearAtlasKind, readonly LinearCoverageCell[]>>;
}): ChannelProjection {
  if (reading.unavailableBecause !== null) {
    return unreadableProjection({ at, previous, reason: reading.unavailableBecause });
  }
  const entities = byKind<LinearAtlasEntity[]>({ make: () => [] });
  const coverage = byKind<LinearCoverageCell[]>({ make: () => [] });
  const gaps = byKind<LinearAtlasGap[]>({ make: () => [] });
  const reached = reading.pages.filter((page) => page.outcome === "reached");
  foldReachedPages({ at, entities, reading });
  foldWalkGaps({ at, gaps, reached, reading });
  const walkReason = `${String(reached.length)} of ${String(plannedCount)} planned settings page(s) reached, ${String(reading.observations.graphqlResponses)} GraphQL response(s) observed`;
  // A bounded run is never complete, whatever its outcomes look like: a `--limit` at or above the current
  // plan leaves no `not-attempted` row, so the reached count alone would grade it `synced`.
  for (const kind of ["operation", "page"] as const) {
    coverage[kind].push(
      cell({
        built: succeededCoverageCell({
          artifacts: kind === "page" ? reached.flatMap((page) => page.artifacts) : [],
          at,
          reason: walkReason,
          role: "authoritative",
          scope: "settings-walk",
          state: reached.length === plannedCount && !reading.limited ? "synced" : "deferred",
          surface: BROWSER_SURFACE,
          visibilityScope: LINEAR_ATLAS_VISIBILITY_SCOPE,
        }),
        channel: "browser",
      }),
    );
  }

  return { coverage, entities, gaps };
}

/**
 * What the browser channel projects when it did not run at all: an `unreadable` cell on every kind, and one
 * gap naming why.
 *
 * A cell per KIND rather than one for the atlas, because a reader asking "what does this atlas know about
 * pages" must be told the browser never looked, and asking the same about operations must be told the same
 * thing — a single cross-kind cell answers neither question where it is asked.
 *
 * @param at this run's ISO timestamp
 * @param reason why the browser produced nothing, in the transport's own words
 * @param previous the coverage the stored generation holds, so a prior success survives this failure
 * @returns the projection, with no entity in it
 */
function unreadableProjection({
  at,
  reason,
  previous,
}: {
  at: string;
  reason: string;
  previous: Readonly<Record<LinearAtlasKind, readonly LinearCoverageCell[]>>;
}): ChannelProjection {
  const entities = byKind<LinearAtlasEntity[]>({ make: () => [] });
  const coverage = byKind<LinearCoverageCell[]>({ make: () => [] });
  const gaps = byKind<LinearAtlasGap[]>({ make: () => [] });
  for (const kind of LINEAR_ATLAS_KINDS) {
    coverage[kind].push(
      cell({
        built: failedCoverageCell({
          previous: priorCoverageCell({ cells: previous[kind], matches: (held) => held.channel === "browser" }),
          reason: reason,
          role: "authoritative",
          scope: "settings-walk",
          state: "unreadable",
          surface: BROWSER_SURFACE,
          unblockedBy: "a Playwright Extension relay that attaches to the owner's own Chrome",
          visibilityScope: LINEAR_ATLAS_VISIBILITY_SCOPE,
        }),
        channel: "browser",
      }),
    );
  }
  gaps.page.push(
    gap({
      built: openGap({
        at,
        condition: "browser-surface-unreadable",
        fields: [],
        kind: "page",
        reason: reason,
        scope: "settings-walk",
        surfaces: ["browser"],
      }),
      kind: "page",
    }),
  );
  return { coverage, entities, gaps };
}

/**
 * Fold every reached page and every observed operation into the entity accumulator.
 *
 * @param at this run's ISO timestamp
 * @param entities the accumulator to fill
 * @param reading what the walk saw
 */
function foldReachedPages({
  at,
  entities,
  reading,
}: {
  at: string;
  entities: Record<LinearAtlasKind, LinearAtlasEntity[]>;
  reading: LinearBrowserReading;
}): void {
  const reached = reading.pages.filter((page) => page.outcome === "reached");

  for (const page of reached) {
    entities.page.push(
      oneChannelEntity({
        at,
        channel: "browser",
        detail: {
          graphqlCallCount: page.graphqlCallCount,
          redirected: false,
          statusCode: page.statusCode,
          title: titleOf({ page }),
          url: page.finalUrl ?? page.requestedUrl,
        },
        kind: "page",
        providerId: page.providerId,
        source: {
          artifacts: [...page.artifacts],
          channel: "browser",
          deepLink: page.finalUrl,
          deepLinkStatus: "browser-discovered",
          endpoint: page.providerId,
          observedAt: page.observedAt ?? at,
        },
      }),
    );
  }

  for (const observation of reading.observations.observations) {
    entities.operation.push(
      oneChannelEntity({
        at,
        channel: "browser",
        detail: observation.detail,
        kind: "operation",
        providerId: observation.providerId,
        source: {
          artifacts: [],
          channel: "browser",
          deepLink: null,
          deepLinkStatus: "unavailable",
          endpoint: "POST /graphql — observed in the first-party web client",
          observedAt: at,
        },
      }),
    );
  }
}

/**
 * Fold every way this walk fell short into the gap accumulator: a route that went elsewhere, one it never
 * attempted, one it could not photograph, and every request it declined to attribute.
 *
 * @param at this run's ISO timestamp
 * @param gaps the accumulator to fill
 * @param reached the pages that were both reached and photographed
 * @param reading what the walk saw
 */
function foldWalkGaps({
  at,
  gaps,
  reached,
  reading,
}: {
  at: string;
  gaps: Record<LinearAtlasKind, LinearAtlasGap[]>;
  reached: readonly LinearPageObservation[];
  reading: LinearBrowserReading;
}): void {
  foldPerPageGaps({ at, gaps, reading });
  foldShortfallGaps({ at, gaps, reached, reading });
  foldObservationGaps({ at, gaps, reading });
  const unphotographed = reading.pages.filter((page) => page.outcome === "unphotographed");
  if (unphotographed.length > 0) {
    gaps.page.push(
      gap({
        built: openGap({
          at,
          condition: "settings-page-unphotographed",
          fields: unphotographed.map((page) => page.providerId),
          kind: "page",
          reason: `${String(unphotographed.length)} page(s) opened but could not be photographed, and a page without its held screenshot is not evidence anybody can look at`,
          scope: "settings-walk",
          surfaces: ["browser"],
        }),
        kind: "page",
      }),
    );
  }
}

/**
 * A gap per route that did not become a reached page: one the browser sent somewhere else, and one it could
 * not open at all.
 *
 * Per ROUTE rather than one summary gap, because the whole value of a declared denominator is that a reader
 * can see WHICH route the table got wrong.
 *
 * @param at this run's ISO timestamp
 * @param gaps the accumulator to fill
 * @param reading what the walk saw
 */
function foldPerPageGaps({
  at,
  gaps,
  reading,
}: {
  at: string;
  gaps: Record<LinearAtlasKind, LinearAtlasGap[]>;
  reading: LinearBrowserReading;
}): void {
  for (const page of reading.pages.filter((candidate) => candidate.outcome === "redirected")) {
    gaps.page.push(
      gap({
        built: openGap({
          at,
          condition: "settings-page-unreachable",
          fields: [],
          kind: "page",
          reason: `this route answered by moving the browser to ${page.finalUrl ?? "somewhere else"}, so it was not reached`,
          scope: page.providerId,
          surfaces: ["browser"],
        }),
        kind: "page",
      }),
    );
  }
  for (const page of reading.pages.filter((candidate) => candidate.outcome === "failed")) {
    gaps.page.push(
      gap({
        built: openGap({
          at,
          condition: "settings-page-unreachable",
          fields: [],
          kind: "page",
          reason: "the browser could not open this route at all",
          scope: page.providerId,
          surfaces: ["browser"],
        }),
        kind: "page",
      }),
    );
  }
}

/**
 * The two ways a walk can be incomplete without any single route failing: routes it never attempted because
 * the session was lost, and pages it reached whose capture lost a response body.
 *
 * Each names every affected route in `fields`, because "the walk was incomplete" is a notification and
 * "these named routes were never attempted" is a finding.
 *
 * @param at this run's ISO timestamp
 * @param gaps the accumulator to fill
 * @param reached the pages that were both reached and photographed
 * @param reading what the walk saw
 */
function foldShortfallGaps({
  at,
  gaps,
  reached,
  reading,
}: {
  at: string;
  gaps: Record<LinearAtlasKind, LinearAtlasGap[]>;
  reached: readonly LinearPageObservation[];
  reading: LinearBrowserReading;
}): void {
  const notAttempted = reading.pages.filter((page) => page.outcome === "not-attempted");
  if (notAttempted.length > 0) {
    gaps.page.push(
      gap({
        built: openGap({
          at,
          condition: "settings-walk-incomplete",
          fields: notAttempted.map((page) => page.providerId),
          kind: "page",
          reason: `the walk stopped partway and ${String(notAttempted.length)} route(s) were never attempted`,
          scope: "settings-walk",
          surfaces: ["browser"],
        }),
        kind: "page",
      }),
    );
  }
  const incomplete = reached.filter((page) => !page.captureComplete);
  if (incomplete.length > 0) {
    gaps.page.push(
      gap({
        built: openGap({
          at,
          condition: "settings-page-capture-incomplete",
          fields: incomplete.map((page) => page.providerId),
          kind: "page",
          reason: `${String(incomplete.length)} page(s) lost at least one response body, so their call census understates what was asked for`,
          scope: "settings-walk",
          surfaces: ["browser"],
        }),
        kind: "page",
      }),
    );
  }
}
