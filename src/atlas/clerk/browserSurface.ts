/**
 * `atlas clerk walk` — publish the DASHBOARD surface: every declared page the browser reached, the
 * screenshot proving each, and every first-party operation the client was seen calling.
 *
 * ## The two guards this publisher owes are the kit's, and neither is optional
 *
 * The denominator is `CLERK_BROWSER_PAGES`, never the array a caller hands in — a publisher comparing
 * `reached` against `pages.length` publishes `synced` for a walk carrying an EMPTY array, because nought of
 * nought is all of them. And the evidence is the BYTES: every screenshot is re-read off disk and re-hashed
 * before anything is graded, because a caller can hand over an artifact reference with no file behind it.
 * `kit/walkPublish.ts` carries both, and this module is the place they are applied.
 *
 * ## The walk writes `page` and the `operation` kind's browser channel, and nothing else
 *
 * `webhook-event` is the sync's alone. `operation` is shared, which is the whole design — the corroboration
 * between what a document declares and what the client calls is the output — and is why both publishers
 * take the store's publish lock rather than trusting `publishAtlas`'s omitted-kind rule on its own.
 *
 * ## An undocumented operation becomes a GAP as well as a row
 *
 * A row says the dashboard called it. A gap says no pinned document declares it, which is a question the
 * atlas could not answer from the API surface alone — `docs/atlas-intent/04-corroboration.md`'s corroboration output,
 * carried in the generation so it survives rather than living only in a report. Both are written; neither
 * replaces the other.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { foldObservedOperations, type ObservedOperation } from "../kit/observedOperations.js";
import type { PageObservation } from "../kit/pageWalk.js";
import {
  assembleWalkKind,
  refuseUndeclaredWalk,
  stampedKindStatus,
  verifyArtifactsOnDisk,
  type WalkTally,
  walkTally,
} from "../kit/walkPublish.js";

import { CLERK_BROWSER_PAGES, clerkDeclaredPageSurfaces } from "./browserPages.js";
import type { ClerkObservedCall } from "./browserReduction.js";
import { failedClerkCoverageCell, succeededClerkCoverageCell } from "./coverage.js";
import { openClerkGap, reconcileClerkGaps } from "./gaps.js";
import { mergeClerkChannel } from "./merge.js";
import {
  CLERK_OPERATION_KIND,
  CLERK_PAGE_KIND,
  type ClerkAtlasEntity,
  type ClerkAtlasGap,
  type ClerkAtlasKindFile,
  type ClerkAtlasManifest,
  emptyClerkKindFile,
  initialClerkManifest,
} from "./model.js";
import { projectClerkObservedOperations, projectClerkPages } from "./projection.js";
import { type ClerkAtlasPaths, publishClerkAtlas, readClerkAtlas, withClerkPublishLock } from "./store.js";
import { CLERK_DASHBOARD_SURFACE } from "./surfaceFill.js";
import { clerkProviderId } from "./surfaceNaming.js";

/** What a walk publication did, which is what `--json` prints. */
export interface ClerkWalkOutcome {
  readonly declared: number;
  readonly reached: number;
  readonly photographed: number;
  readonly operationsObserved: number;
  readonly undocumented: number;
  readonly sessionLost: boolean;
  readonly written: readonly string[];
}

/**
 * Fold every page's calls into one accumulator per operation.
 *
 * The provider key is the same `<METHOD> <api>:<wire path>` a compiled row projects to, byte-exactly, which
 * is the only reason the two channels can land on one entity.
 *
 * @param pages every declared page's observation
 * @returns one entry per distinct operation
 *
 * @internal
 */
export function foldClerkOperations({
  pages,
}: {
  pages: readonly PageObservation<ClerkObservedCall>[];
}): readonly ObservedOperation<ClerkObservedCall>[] {
  const folded = foldObservedOperations({
    fieldsOf: ({ call }) => call.responseFields,
    keyOf: ({ call }) => clerkProviderId({ api: call.api, method: call.method, wirePath: call.wirePath }),
    pages: pages.map((page) => ({ calls: page.calls, finalUrl: page.finalUrl, surface: page.surface })),
  });
  return [...folded.values()];
}

/**
 * Publish one walk's results.
 *
 * @param paths the resolved atlas paths
 * @param pages every declared page's observation, exactly covering the declared list
 * @param sessionLost whether the walk stopped early because the browser session was lost
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason it was refused
 */
export function publishClerkWalk({
  paths,
  pages,
  sessionLost,
  at,
}: {
  paths: ClerkAtlasPaths;
  pages: readonly PageObservation<ClerkObservedCall>[];
  sessionLost: boolean;
  at: string;
}): Result<ClerkWalkOutcome> {
  const covered = refuseUndeclaredWalk({ declaredSurfaces: clerkDeclaredPageSurfaces(), pages });
  if (covered.isErr()) {
    return err(covered.error);
  }
  const proven = verifyArtifactsOnDisk({ directory: paths.directory, pages });
  return withClerkPublishLock({
    nowIso: at,
    paths,
    publish: () => publishProven({ at, paths, pages: proven, sessionLost }),
  });
}

/** Read the generation, merge the browser channel onto it, and publish. */
function publishProven({
  paths,
  pages,
  sessionLost,
  at,
}: {
  paths: ClerkAtlasPaths;
  pages: readonly PageObservation<ClerkObservedCall>[];
  sessionLost: boolean;
  at: string;
}): Result<ClerkWalkOutcome> {
  const snapshot = readClerkAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const tally = walkTally({ pages });
  const observed = foldClerkOperations({ pages });
  const storedPages =
    snapshot.value.files[CLERK_PAGE_KIND] ?? emptyClerkKindFile({ kind: CLERK_PAGE_KIND, updatedAt: at });
  const storedOperations =
    snapshot.value.files[CLERK_OPERATION_KIND] ?? emptyClerkKindFile({ kind: CLERK_OPERATION_KIND, updatedAt: at });
  const undocumented = undocumentedOperations({ observed, stored: storedOperations });
  const pageFile = assemblePageKind({ at, pages, sessionLost, stored: storedPages, tally });
  if (pageFile.isErr()) {
    return err(pageFile.error);
  }
  const operationFile = assembleOperationKind({ at, observed, stored: storedOperations, undocumented });
  if (operationFile.isErr()) {
    return err(operationFile.error);
  }
  const nextPages: ClerkAtlasKindFile = { ...storedPages, ...pageFile.value };
  const nextOperations: ClerkAtlasKindFile = { ...storedOperations, ...operationFile.value };
  const published = publishClerkAtlas({
    derivedFrom: snapshot.value.manifest,
    files: { [CLERK_OPERATION_KIND]: nextOperations, [CLERK_PAGE_KIND]: nextPages },
    manifest: walkManifest({
      at,
      manifest: snapshot.value.manifest,
      operationCount: nextOperations.entities.length,
      pageCount: nextPages.entities.length,
    }),
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({
    declared: CLERK_BROWSER_PAGES.length,
    operationsObserved: observed.length,
    photographed: tally.photographed,
    reached: tally.reached,
    sessionLost,
    undocumented: undocumented.length,
    written: published.value,
  });
}

/**
 * The `page` kind's next fields: the browser channel merged on, its gaps reconciled, its own cell replaced.
 *
 * @param pages every declared page's observation
 * @param stored the kind file as the store holds it
 * @param tally how many pages this walk reached and photographed
 * @param sessionLost whether the walk stopped early
 * @param at this run's ISO timestamp
 * @returns the fields to spread onto the stored file, or the first reason they cannot be assembled
 */
function assemblePageKind({
  pages,
  stored,
  tally,
  sessionLost,
  at,
}: {
  pages: readonly PageObservation<ClerkObservedCall>[];
  stored: ClerkAtlasKindFile;
  tally: WalkTally;
  sessionLost: boolean;
  at: string;
}): ReturnType<typeof assembleWalkKind<ClerkAtlasKindFile["coverage"][number], ClerkAtlasEntity, ClerkAtlasGap>> {
  return assembleWalkKind({
    at,
    cell: pageCoverageCell({ at, pages, sessionLost, stored, tally }),
    merge: () =>
      mergeClerkChannel({
        at,
        channel: "browser",
        observed: projectClerkPages({ at, observations: pages }),
        stored: stored.entities,
      }),
    reconcile: () =>
      reconcileClerkGaps({
        at,
        observed: walkGaps({ at, pages }),
        rechecks: pageRechecks({ pages }),
        runFailed: false,
        stored: stored.gaps,
      }),
    stored,
    surface: CLERK_DASHBOARD_SURFACE,
  });
}

/**
 * The `operation` kind's next fields, for the BROWSER channel alone — the compiled channel is the sync's.
 *
 * @param observed this walk's folded operations
 * @param undocumented the ones no compiled row declares
 * @param stored the kind file as the store holds it
 * @param at this run's ISO timestamp
 * @returns the fields to spread onto the stored file, or the first reason they cannot be assembled
 */
function assembleOperationKind({
  observed,
  undocumented,
  stored,
  at,
}: {
  observed: readonly ObservedOperation<ClerkObservedCall>[];
  undocumented: readonly string[];
  stored: ClerkAtlasKindFile;
  at: string;
}): ReturnType<typeof assembleWalkKind<ClerkAtlasKindFile["coverage"][number], ClerkAtlasEntity, ClerkAtlasGap>> {
  return assembleWalkKind({
    at,
    cell: operationCoverageCell({ at, observed, stored, undocumented }),
    merge: () =>
      mergeClerkChannel({
        at,
        channel: "browser",
        observed: projectClerkObservedOperations({ at, operations: observed }),
        stored: stored.entities,
      }),
    reconcile: () =>
      reconcileClerkGaps({
        at,
        observed: undocumentedGaps({ at, undocumented }),
        rechecks: [],
        runFailed: false,
        stored: stored.gaps,
      }),
    stored,
    surface: CLERK_DASHBOARD_SURFACE,
  });
}

/**
 * Two provider ids differ only in how their path parameters are spelled when this makes them equal.
 *
 * The same normalisation `disagreement.ts` applies, and for the same reason: a declared `{user_id}` and an
 * observed `{user}` are one operation seen twice, so a comparator that missed it would report every
 * parameterised route as undocumented.
 *
 * @param providerId the key to normalise
 * @returns the key with every parameter name blanked
 */
function blankParameterNames({ providerId }: { providerId: string }): string {
  return providerId.replaceAll(/\{[^}]*\}/g, "{}");
}

/**
 * The operations this walk saw that no compiled row declares.
 *
 * Judged against the STORED compiled rows rather than against the pinned documents, deliberately: a walk
 * run before any sync has nothing to compare against, and reporting all of its observations as undocumented
 * would be the comparison inventing a finding. In that state every observed operation is simply new, and
 * the next sync's own merge is what settles which of them a document declares.
 *
 * @param observed this walk's folded operations
 * @param stored the operation kind's file as it stands
 * @returns the provider ids no compiled row declares, sorted
 *
 * @internal
 */
export function undocumentedOperations({
  observed,
  stored,
}: {
  observed: readonly ObservedOperation<ClerkObservedCall>[];
  stored: ClerkAtlasKindFile;
}): readonly string[] {
  const declared = new Set(
    stored.entities.filter((entity) => entity.channels.compiled !== null).map((entity) => entity.providerId),
  );
  if (declared.size === 0) {
    return [];
  }
  const declaredShapes = new Set([...declared].map((key) => blankParameterNames({ providerId: key })));
  return observed
    .map((entry) => clerkProviderId({ api: entry.call.api, method: entry.call.method, wirePath: entry.call.wirePath }))
    .filter((key) => !declaredShapes.has(blankParameterNames({ providerId: key })))
    .toSorted();
}

/** One gap per declared page this walk did not hold, plus the standing one-instance admission. */
function walkGaps({
  pages,
  at,
}: {
  pages: readonly PageObservation<ClerkObservedCall>[];
  at: string;
}): readonly ClerkAtlasGap[] {
  return [singleInstanceGap({ at }), ...pages.flatMap((page) => pageGap({ at, page }))];
}

/** The coverage cell the `page` kind earns from this walk. */
function pageCoverageCell({
  pages,
  stored,
  tally,
  sessionLost,
  at,
}: {
  pages: readonly PageObservation<ClerkObservedCall>[];
  stored: ClerkAtlasKindFile;
  tally: { reached: number; photographed: number };
  sessionLost: boolean;
  at: string;
}): ClerkAtlasKindFile["coverage"][number] {
  const declared = CLERK_BROWSER_PAGES.length;
  const complete = tally.photographed === declared && !sessionLost;
  const reason =
    `${String(tally.reached)} of ${String(declared)} declared dashboard page(s) reached and ` +
    `${String(tally.photographed)} photographed with a screenshot verified on disk. ` +
    `${String(pages.filter((page) => page.calls.length > 0).length)} page(s) caused at least one first-party call. ` +
    "The declared list never shrinks: an unreachable route becomes a gap against the page, never a deletion";
  if (complete) {
    return succeededClerkCoverageCell({
      artifacts: [],
      at,
      channel: "browser",
      reason,
      role: "authoritative",
      scope: "dashboard-pages",
      state: "synced",
      surface: CLERK_DASHBOARD_SURFACE,
    });
  }
  return failedClerkCoverageCell({
    channel: "browser",
    previous: stored.coverage.find((cell) => cell.surface === CLERK_DASHBOARD_SURFACE) ?? null,
    reason: sessionLost ? `${reason}. The walk stopped early: the browser session was lost part-way through` : reason,
    role: "authoritative",
    scope: "dashboard-pages",
    state: "deferred",
    surface: CLERK_DASHBOARD_SURFACE,
    unblockedBy: sessionLost
      ? "sign in to the Clerk dashboard in your own Chrome and run: slopweaver atlas clerk walk"
      : "a route this account's plan or role cannot open, or one the dashboard has moved — each page's own gap says which",
  });
}

/** The coverage cell the `operation` kind earns from this walk's browser channel. */
function operationCoverageCell({
  observed,
  undocumented,
  stored,
  at,
}: {
  observed: readonly ObservedOperation<ClerkObservedCall>[];
  undocumented: readonly string[];
  stored: ClerkAtlasKindFile;
  at: string;
}): ClerkAtlasKindFile["coverage"][number] {
  if (observed.length === 0) {
    return failedClerkCoverageCell({
      channel: "browser",
      previous: stored.coverage.find((cell) => cell.surface === CLERK_DASHBOARD_SURFACE) ?? null,
      reason:
        "the walk reached pages and saw no first-party Clerk call at all, which on a client that renders " +
        "every page from its own API means the capture saw less than the browser did",
      role: "corroborating",
      scope: "dashboard-observed-operations",
      state: "unreadable",
      surface: CLERK_DASHBOARD_SURFACE,
      unblockedBy: "run the walk again; if it repeats, the transport's response capture is what to check",
    });
  }
  return succeededClerkCoverageCell({
    artifacts: [],
    at,
    channel: "browser",
    reason:
      `${String(observed.length)} distinct first-party operation(s) observed across the declared pages, ` +
      `${String(undocumented.length)} of which no pinned document declares. An observed operation is a LEAD ` +
      "— it says Clerk holds the data, never that a credential here may ask for it",
    role: "authoritative",
    scope: "dashboard-observed-operations",
    state: "synced",
    surface: CLERK_DASHBOARD_SURFACE,
  });
}

/** The standing admission that one browser can only ever walk one instance. */
function singleInstanceGap({ at }: { at: string }): ClerkAtlasGap {
  return openClerkGap({
    at,
    condition: "browser-single-instance-only",
    fields: [],
    kind: CLERK_PAGE_KIND,
    reason:
      "the Clerk dashboard renders one application and one instance at a time, and this walk drove " +
      "whichever the owner's browser was left on. Every other instance's pages are unmapped, and no walk " +
      "of one browser can close that",
    scope: CLERK_PAGE_KIND,
    surfaces: ["browser"],
  });
}

/**
 * The gap one declared page earns, when it earns one.
 *
 * At most one per page and in this order — never attempted, then unreachable, then unphotographed — because
 * a page that was never addressed has no screenshot either, and filing both would double-count one fact.
 *
 * @param page the observation to judge
 * @param at this run's ISO timestamp
 * @returns the gap, or an empty list when the page is fully held
 */
function pageGap({ page, at }: { page: PageObservation<ClerkObservedCall>; at: string }): readonly ClerkAtlasGap[] {
  const open = ({
    condition,
    reason,
  }: {
    condition: "browser-page-not-attempted" | "browser-page-unreachable" | "browser-screenshot-missing";
    reason: string;
  }): ClerkAtlasGap =>
    openClerkGap({
      at,
      condition,
      fields: [],
      kind: CLERK_PAGE_KIND,
      reason,
      scope: page.surface,
      surfaces: ["browser"],
    });
  if (!page.attempted) {
    return [open({ condition: "browser-page-not-attempted", reason: notAttemptedReason({ page }) })];
  }
  if (page.unreachableBecause !== null) {
    return [open({ condition: "browser-page-unreachable", reason: page.unreachableBecause })];
  }
  if (page.screenshotMissingBecause !== null) {
    return [open({ condition: "browser-screenshot-missing", reason: page.screenshotMissingBecause })];
  }
  return [];
}

/** Why a page the walk never attempted was skipped: the reason it recorded, else that it was never visited. */
function notAttemptedReason({ page }: { page: PageObservation<ClerkObservedCall> }): string {
  if (page.unreachableBecause === null) {
    return "declared and never visited";
  }
  return page.unreachableBecause;
}

/**
 * The page gaps this walk genuinely rechecked, so a page that started working closes its own gap.
 *
 * Only a page the walk ATTEMPTED is a recheck: a page skipped after a lost session was not looked at, and
 * closing its gap on the strength of not having looked is the failure `kit/gaps.ts` exists to prevent.
 */
function pageRechecks({ pages }: { pages: readonly PageObservation<ClerkObservedCall>[] }): readonly {
  condition: string;
  scope: string;
  resolved: boolean;
}[] {
  return pages
    .filter((page) => page.attempted)
    .flatMap((page) => {
      const held = page.unreachableBecause === null && page.screenshotMissingBecause === null;
      return [
        { condition: "browser-page-not-attempted", resolved: true, scope: page.surface },
        { condition: "browser-page-unreachable", resolved: page.unreachableBecause === null, scope: page.surface },
        { condition: "browser-screenshot-missing", resolved: held, scope: page.surface },
      ];
    });
}

/** One gap per operation the dashboard called that no pinned document declares. */
function undocumentedGaps({
  undocumented,
  at,
}: {
  undocumented: readonly string[];
  at: string;
}): readonly ClerkAtlasGap[] {
  return undocumented.map((providerId) =>
    openClerkGap({
      at,
      condition: "operation-undocumented",
      fields: [],
      kind: CLERK_OPERATION_KIND,
      reason:
        "the Clerk dashboard was observed calling this operation and no pinned document declares it. A LEAD " +
        "rather than a capability: it establishes that Clerk holds the data behind it, and says nothing " +
        "about whether a secret key may ask for it",
      scope: providerId,
      surfaces: ["compiled", "browser"],
    }),
  );
}

/** Stamp the two kinds this walk published, leaving every other kind's row exactly as it stood. */
function walkManifest({
  manifest,
  pageCount,
  operationCount,
  at,
}: {
  manifest: ClerkAtlasManifest | null;
  pageCount: number;
  operationCount: number;
  at: string;
}): ClerkAtlasManifest {
  const base = manifest ?? initialClerkManifest({ updatedAt: at });
  return {
    ...base,
    kinds: {
      ...base.kinds,
      [CLERK_OPERATION_KIND]: stampedKindStatus({ at, count: operationCount }),
      [CLERK_PAGE_KIND]: stampedKindStatus({ at, count: pageCount }),
    },
    updatedAt: at,
  };
}
