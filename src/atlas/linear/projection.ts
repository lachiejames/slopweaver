/**
 * Both channels' readings folded into the four kind files: entities, coverage cells and gaps. PURE.
 *
 * ## What "pure" buys here, and why it is not a style preference
 *
 * Every judgement this atlas makes about its own completeness is made in this file: whether a settings
 * group was read or refused, whether a page was reached or redirected somewhere else, whether the two
 * channels disagree about an operation. Each of those is a decision that a live run can only be watched
 * making once, and a unit test can make it make a hundred times. So the network lives in `apiSurface.ts`,
 * `schemaRead.ts` and `walk.ts`, and everything that decides what the atlas SAYS lives here where it can be pinned.
 *
 * ## One channel succeeding never erases the other
 *
 * A channel's entity slot is filled only by a reading from THAT channel. An API-only run leaves every
 * `browser` slot exactly as the previous generation left it, and vice versa — `kit/merge.ts`'s fold seam is
 * what makes that structural rather than remembered. This is the ruling that both records are kept, applied
 * one entity at a time.
 *
 * ## Coverage is per GROUP, not per atlas
 *
 * The configuration surface is many rows, and an account's entitlements can refuse some of them. A single
 * `settings: synced` cell would be true of the rows read and false of the rows refused while reading as true
 * of all of them — so each group gets its own cell, and each refusal carries the exact provider sentence that
 * refused it. That is the difference between an atlas that is honest about its gaps and one that says it
 * is.
 */
import { openDisagreementGap, openGap } from "../kit/gaps.js";
import type { LinearApiSurfaceReading } from "./apiSurface.js";
import {
  LINEAR_ATLAS_KINDS,
  type LinearAtlasEntity,
  type LinearAtlasGap,
  type LinearAtlasKind,
  type LinearCoverageCell,
} from "./model.js";
import { projectApiChannel } from "./projectApi.js";
import { projectBrowserChannel } from "./projectBrowser.js";
import { byKind, gap, type LinearBrowserReading, type LinearProjection } from "./projectionKit.js";
import { classifyRootFields, unclassifiedRootFields } from "./rootFieldCensus.js";

/**
 * Fold both channels' readings into the four kind files' contents.
 *
 * @param api what the API channel saw, or `null` when it was not read this run
 * @param browser what the browser channel saw, including the reason it saw nothing
 * @param plannedCount how many settings pages were planned, so partial coverage is a fraction
 * @param workspaceUrlBase the workspace's own settings root, for a `setting`'s deep link; `null` when unknown
 * @param previousCoverage the coverage the stored generation holds, so a failed look keeps its prior success
 * @param at this run's ISO timestamp
 * @returns the entities, coverage and gaps for every kind
 */
export function projectLinearAtlas({
  api,
  browser,
  plannedCount,
  workspaceUrlBase,
  previousCoverage,
  at,
}: {
  api: LinearApiSurfaceReading | null;
  browser: LinearBrowserReading;
  plannedCount: number;
  workspaceUrlBase: string | null;
  previousCoverage: Readonly<Record<LinearAtlasKind, readonly LinearCoverageCell[]>>;
  at: string;
}): LinearProjection {
  const entities = byKind<LinearAtlasEntity[]>({ make: () => [] });
  const coverage = byKind<LinearCoverageCell[]>({ make: () => [] });
  const gaps = byKind<LinearAtlasGap[]>({ make: () => [] });
  const rechecks = rechecksFor({ api, browser });

  foldChannels({ api, at, browser, coverage, entities, gaps, plannedCount, previousCoverage, workspaceUrlBase });

  foldStandingGaps({ api, at, browser, gaps });

  return {
    coverage,
    entities,
    gaps,
    // A recheck may only report a condition RESOLVED when this run raised no gap for it, so the two are
    // reconciled here rather than guessed above: whatever the run actually detected wins.
    rechecks: rechecks.map((recheck) => ({
      ...recheck,
      resolved:
        recheck.resolved &&
        !LINEAR_ATLAS_KINDS.some((kind) =>
          gaps[kind].some((raised) => raised.condition === recheck.condition && raised.scope === recheck.scope),
        ),
    })),
  };
}

/**
 * Join this run's two channel projections into ONE entity per id.
 *
 * The two channels genuinely observe the same things — the schema declares `query.availableUsers` and the
 * first-party client calls it — so each produces an entity under that id, and pushing both would offer the
 * store two records for one thing. The kit's merge REFUSES that rather than silently double-counting, which
 * is how this was found: a live walk refused with `operation:query.availableUsers` named.
 *
 * The join fills each side's own channel slot and never overwrites the other's, which is the same rule the
 * store applies across generations, applied here within one.
 *
 * @param left the entities the API channel projected
 * @param right the entities the browser channel projected
 * @returns one entity per id, in the order the API channel produced them, browser-only entities last
 */
function joinChannels({
  left,
  right,
}: {
  left: readonly LinearAtlasEntity[];
  right: readonly LinearAtlasEntity[];
}): readonly LinearAtlasEntity[] {
  const byId = new Map(left.map((entity) => [entity.id, entity]));
  for (const entity of right) {
    const existing = byId.get(entity.id);
    if (existing === undefined) {
      byId.set(entity.id, entity);
      continue;
    }
    // Each side's entities come from `oneChannelEntity`, so an API-side one fills only `api` and a browser-side
    // one only `browser`: each side's own slot is the whole join, and the other side's is null by construction.
    byId.set(entity.id, { ...existing, channels: { api: existing.channels.api, browser: entity.channels.browser } });
  }
  return [...byId.values()];
}

/**
 * How deep the SCHEMA's own response paths go: a root field's return type, plus one level into it.
 *
 * `introspection.ts` resolves exactly that far and says why — a transitive closure would store this schema's
 * type graph under each of 627 root fields. The browser channel walks three levels, so anything deeper than
 * this is a path the schema was never asked about, and reporting it as undeclared says "the schema does not
 * declare this" when the truth is "this comparison cannot see that far".
 *
 * MEASURED, and it is why this constant exists: before it, `query.availableUsers` reported its
 * `users[].organization.*` paths as undeclared in this atlas's own first real report. Every one of them was
 * three levels down.
 */
const SCHEMA_PATH_DEPTH = 2;

/** How many named segments one normalised path has. */
function depthOf({ path }: { path: string }): number {
  return path.split(".").length;
}

/**
 * One response path with its array markers removed, so a browser path and a schema path are comparable.
 *
 * The schema describes a field's TYPE and never how many of it came back, so `nodes.key` and `nodes[].key`
 * are the same field seen through two surfaces. Normalising is therefore restoring the comparison rather
 * than loosening it.
 *
 * @param path one dotted response path
 * @returns the path with every `[]` marker removed
 */
function withoutListMarkers({ path }: { path: string }): string {
  // The segments are rebuilt rather than the markers merely deleted, because a LEADING marker is its own
  // segment: deleting the brackets in `[].browserType` leaves `.browserType`, which matches nothing and
  // silently keeps the false disagreement this function exists to remove.
  return path
    .split(".")
    .map((segment) => segment.replaceAll("[]", ""))
    .filter((segment) => segment !== "")
    .join(".");
}

/** Every operation the browser saw that the schema does not declare, and every path it saw that it does not. */
function disagreementGaps({
  api,
  browser,
  at,
}: {
  api: LinearApiSurfaceReading;
  browser: LinearBrowserReading;
  at: string;
}): readonly LinearAtlasGap[] {
  const declared = new Map(api.operations.map((record) => [record.providerId, record.detail]));
  const out: LinearAtlasGap[] = [];
  for (const observation of browser.observations.observations) {
    const key = observation.providerId;
    const detail = declared.get(key);
    if (detail === undefined) {
      out.push(
        gap({
          built: openDisagreementGap({
            at,
            fields: [key],
            kind: "operation",
            reason:
              "the first-party web client selected this root field and the published schema declares no such field — an undocumented surface, which is the finding both surfaces exist to produce",
            scope: key,
            surfaces: ["api", "browser"],
          }),
          kind: "operation",
        }),
      );
      continue;
    }
    // Compared with array markers REMOVED, because the schema's own paths carry none: introspection
    // describes a field's type, not how many of it a response happened to hold. A Codex review pass caught
    // that comparing `nodes[].key` against `nodes.key` reports every list field in the API as undeclared —
    // which is not a finding, it is the comparison being wrong, and it was live in this atlas's own first
    // report before this line existed.
    const declaredPaths = new Set(detail.responsePaths.map((path) => withoutListMarkers({ path })));
    const undeclared = observation.detail.responsePaths.filter((path) => {
      const normalised = withoutListMarkers({ path });
      return depthOf({ path: normalised }) <= SCHEMA_PATH_DEPTH && !declaredPaths.has(normalised);
    });
    if (undeclared.length > 0) {
      out.push(
        gap({
          built: openDisagreementGap({
            at,
            fields: undeclared,
            kind: "operation",
            reason: `the client got back ${String(undeclared.length)} response field path(s) the schema does not declare within one level of this field's return type`,
            scope: key,
            surfaces: ["api", "browser"],
          }),
          kind: "operation",
        }),
      );
    }
  }
  return out;
}

/**
 * What this run genuinely RECHECKED, and whether each is now answered.
 *
 * Split out because it is the half that must be read against `kit/gaps.ts`'s own contract: a run may close
 * a gap only for a condition and scope it actually looked at. Everything here is therefore gated on the
 * channel having run, and a page the walk never attempted contributes no recheck at all.
 *
 * @param api what the API channel read, or `null` when it did not run
 * @param browser what the browser channel read
 * @returns the rechecks, before they are reconciled against what this run actually raised
 */
function rechecksFor({
  api,
  browser,
}: {
  api: LinearApiSurfaceReading | null;
  browser: LinearBrowserReading;
}): readonly { readonly condition: string; readonly scope: string; readonly resolved: boolean }[] {
  const rechecks: { condition: string; scope: string; resolved: boolean }[] = [];

  if (api !== null) {
    for (const outcome of api.settings) {
      rechecks.push({
        condition: "settings-surface-refused",
        resolved: outcome.refusedBecause === null,
        scope: outcome.group,
      });
      rechecks.push({
        condition: "settings-paging-bound-reached",
        resolved: !outcome.pageBoundReached,
        scope: outcome.group,
      });
    }
    rechecks.push({
      condition: "unclassified-root-field",
      resolved:
        unclassifiedRootFields({
          classified: classifyRootFields({ operationProviderIds: api.operations.map((record) => record.providerId) }),
        }).length === 0,
      scope: "schema",
    });
  }
  rechecks.push(...browserRechecks({ browser }));
  return rechecks;
}

/**
 * Run both channel projections and accumulate them, joining any entity both channels saw into ONE record.
 *
 * @param api what the API channel read, or `null` when it did not run
 * @param at this run's ISO timestamp
 * @param browser what the browser channel read
 * @param coverage the coverage accumulator to fill
 * @param entities the entity accumulator to fill
 * @param gaps the gap accumulator to fill
 * @param plannedCount how many settings pages were planned
 * @param previousCoverage the coverage the stored generation holds
 * @param workspaceUrlBase the workspace's settings root, for a `setting`'s deep link
 */
function foldChannels({
  api,
  at,
  browser,
  coverage,
  entities,
  gaps,
  plannedCount,
  previousCoverage,
  workspaceUrlBase,
}: {
  api: LinearApiSurfaceReading | null;
  at: string;
  browser: LinearBrowserReading;
  coverage: Record<LinearAtlasKind, LinearCoverageCell[]>;
  entities: Record<LinearAtlasKind, LinearAtlasEntity[]>;
  gaps: Record<LinearAtlasKind, LinearAtlasGap[]>;
  plannedCount: number;
  previousCoverage: Readonly<Record<LinearAtlasKind, readonly LinearCoverageCell[]>>;
  workspaceUrlBase: string | null;
}): void {
  if (api !== null) {
    const projected = projectApiChannel({ at, previous: previousCoverage, reading: api, workspaceUrlBase });
    for (const kind of LINEAR_ATLAS_KINDS) {
      entities[kind].push(...projected.entities[kind]);
      coverage[kind].push(...projected.coverage[kind]);
      gaps[kind].push(...projected.gaps[kind]);
    }
  }

  const projectedBrowser = projectBrowserChannel({ at, plannedCount, previous: previousCoverage, reading: browser });
  for (const kind of LINEAR_ATLAS_KINDS) {
    entities[kind] = [...joinChannels({ left: entities[kind], right: projectedBrowser.entities[kind] })];
    coverage[kind].push(...projectedBrowser.coverage[kind]);
    gaps[kind].push(...projectedBrowser.gaps[kind]);
  }
}

/**
 * What a completed walk rechecked. Empty when the browser did not run, because a run that did not look may
 * not close anything — including a page it never attempted.
 *
 * @param browser what the browser channel read
 * @returns the rechecks the walk earned
 */
function browserRechecks({
  browser,
}: {
  browser: LinearBrowserReading;
}): readonly { readonly condition: string; readonly scope: string; readonly resolved: boolean }[] {
  const rechecks: { condition: string; scope: string; resolved: boolean }[] = [];
  if (browser.unavailableBecause === null) {
    rechecks.push({ condition: "browser-surface-unreadable", resolved: true, scope: "settings-walk" });
    // A page this run never attempted was not rechecked, so its own gap must not be allowed to close on the
    // strength of a run that did not look at it.
    const attempted = new Set(
      browser.pages.filter((page) => page.outcome !== "not-attempted").map((page) => page.providerId),
    );
    for (const condition of [
      "settings-walk-incomplete",
      "settings-page-capture-incomplete",
      "settings-page-unphotographed",
      "request-shape-unresolved",
      "browser-response-key-unexplained",
    ]) {
      rechecks.push({
        condition,
        resolved: true,
        scope: "settings-walk",
      });
    }
    for (const page of browser.pages.filter((candidate) => attempted.has(candidate.providerId))) {
      rechecks.push({
        condition: "settings-page-unreachable",
        resolved: page.outcome === "reached" || page.outcome === "unphotographed",
        scope: page.providerId,
      });
    }
  }
  return rechecks;
}

/**
 * The two gaps that belong to the atlas rather than to a run: the permanently open provenance gap on the
 * declared route table, and the census gap for any root field nothing places.
 *
 * @param api what the API channel read, or `null` when it did not run
 * @param at this run's ISO timestamp
 * @param browser what the browser channel read, so a disagreement can be computed against it
 * @param gaps the accumulator to fill
 */
function foldStandingGaps({
  api,
  at,
  browser,
  gaps,
}: {
  api: LinearApiSurfaceReading | null;
  at: string;
  browser: LinearBrowserReading;
  gaps: Record<LinearAtlasKind, LinearAtlasGap[]>;
}): void {
  gaps.page.push(
    gap({
      built: openGap({
        at,
        condition: "page-inventory-is-declared",
        fields: [],
        kind: "page",
        reason:
          "Linear publishes no sitemap for its settings surface, so this walk's denominator is the route table declared in routes.ts. A declared route that is wrong shows up as an unreached page; a route that is MISSING cannot be detected from here at all",
        scope: "settings-walk",
        surfaces: ["browser"],
      }),
      kind: "page",
    }),
  );

  if (api !== null) {
    for (const disagreement of disagreementGaps({ api, at, browser })) {
      gaps.operation.push(disagreement);
    }
    const unplaced = unclassifiedRootFields({
      classified: classifyRootFields({ operationProviderIds: api.operations.map((record) => record.providerId) }),
    });
    if (unplaced.length > 0) {
      gaps.operation.push(
        gap({
          built: openGap({
            at,
            condition: "unclassified-root-field",
            fields: [...unplaced],
            kind: "operation",
            reason: `${String(unplaced.length)} root field(s) are neither read into configuration nor deliberately excluded by rootFieldCensus.ts — a decision is owed on each, and until one is made the atlas is silent about them`,
            scope: "schema",
            surfaces: ["api"],
          }),
          kind: "operation",
        }),
      );
    }
  }
}
