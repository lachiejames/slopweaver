/**
 * Publish what the console walk saw into the atlas's two browser kinds.
 *
 * The API sync and this share the same generation and never each other's kinds: `sync.ts` publishes the
 * seven API kinds and omits `console-page`/`console-request`, this publishes those two and omits the rest,
 * and `publishAtlas` leaves an omitted kind's file untouched. That is the mechanism by which one surface
 * cannot truncate the other's work, and it is why neither passes a full file map.
 *
 * ## Coverage is graded against the console's own denominator
 *
 * `console-page`'s coverage cell says how many of the DECLARED routes the walk actually landed on, so a run
 * that reached only a fraction of the declared routes reports as `deferred` with the fraction in its reason
 * rather than as `synced` because it wrote some rows. That is the specific failure the sibling Slack walk
 * had: all but one of the navigation surfaces it asked for redirected, and the surface read as filled on the
 * strength of that one.
 */

import { countBy } from "#lib/collections.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type AtlasKindStatus, succeededKindStatus } from "../kit/kindStatus.js";
import { CrowdstrikeAtlasErrors, crowdstrikeAtlasErrorLines } from "./atlasErrors.js";
import type { ConsoleWalkResult } from "./consoleWalk.js";
import { crowdstrikeKindScope, replaceCrowdstrikeCoverageCell, succeededCrowdstrikeCoverageCell } from "./coverage.js";
import type { CrowdstrikeEntity, CrowdstrikeKindFile, CrowdstrikeManifest } from "./entities.js";
import { openCrowdstrikeGap, reconcileCrowdstrikeGaps } from "./gaps.js";
import { assembleCrowdstrikeKindFile, emptyCrowdstrikeKindFile, initialCrowdstrikeManifest } from "./kindFiles.js";
import { type CompleteFamilyRead, mergeCrowdstrikeKind, provenCompleteRead } from "./merge.js";
import type { CrowdstrikeKind } from "./model.js";
import { projectCrowdstrikeConsolePage, projectCrowdstrikeConsoleRequest } from "./projectConsole.js";
import type { ProjectionContext } from "./projectionEnvelope.js";
import { type CrowdstrikeAtlasPaths, publishCrowdstrikeAtlas, readCrowdstrikeAtlas } from "./store.js";

/**
 * What publishing a walk did.
 *
 * @internal
 */
export interface ConsoleSurfaceOutcome {
  readonly pageCount: number;
  readonly landedCount: number;
  readonly requestCount: number;
  readonly written: readonly string[];
}

/** The projection context for one browser-surface read. */
function consoleContext({ at, origin }: { at: string; origin: string }): ProjectionContext {
  return { at, source: { endpoint: `${origin} (console walk)`, observedAt: at, surface: "falcon-console" } };
}

/** The gaps a walk's own shortfalls raise, in the atlas's own vocabulary. */
function walkGaps({ walk, at }: { walk: ConsoleWalkResult; at: string }): CrowdstrikeKindFile["gaps"] {
  const gaps: CrowdstrikeKindFile["gaps"][number][] = [];
  const unreachable = walk.pages.filter((page) => page.outcome !== "landed");
  if (unreachable.length > 0) {
    gaps.push(
      openCrowdstrikeGap({
        at,
        condition: "console-page-unreachable",
        fields: [],
        kind: "console-page",
        reason: `${String(unreachable.length)} of ${String(walk.pages.length)} declared console page(s) did not render — ${summariseOutcomes({ walk })}`,
        scope: crowdstrikeKindScope({ kind: "console-page" }),
        surfaces: ["falcon-console"],
      }),
    );
  }
  if (walk.unrenderedPages.length > 0) {
    gaps.push(
      openCrowdstrikeGap({
        at,
        condition: "console-page-unphotographed",
        fields: [],
        kind: "console-page",
        reason: `${String(walk.unrenderedPages.length)} page(s) were reached but photographed mid-load, so their capture is a loading frame rather than a picture of the page`,
        scope: crowdstrikeKindScope({ kind: "console-page" }),
        surfaces: ["falcon-console"],
      }),
    );
  }
  if (walk.incompletePages.length > 0) {
    gaps.push(
      openCrowdstrikeGap({
        at,
        condition: "console-response-body-lost",
        fields: [],
        kind: "console-request",
        reason: `${String(walk.incompletePages.length)} page(s) lost at least one response body, so what the console asked for on them is recorded incompletely`,
        scope: crowdstrikeKindScope({ kind: "console-request" }),
        surfaces: ["falcon-console"],
      }),
    );
  }
  return gaps;
}

/**
 * A one-line tally of how the walk's pages resolved, for a coverage reason to quote.
 *
 * @param walk what the walk saw
 * @returns the counts per outcome, alphabetically, as one comma-separated sentence
 *
 * @internal
 */
export function summariseOutcomes({ walk }: { walk: ConsoleWalkResult }): string {
  return [...countBy({ keys: walk.pages.map((page) => page.outcome) }).entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([outcome, count]) => `${String(count)} ${outcome}`)
    .join(", ");
}

/**
 * Publish one walk into `console-page` and `console-request`.
 *
 * @param paths the resolved atlas paths
 * @param walk what the walk saw
 * @param origin the console origin, recorded as the endpoint every browser record came from
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason nothing was
 */
export function publishConsoleWalk({
  paths,
  walk,
  origin,
  at,
}: {
  paths: CrowdstrikeAtlasPaths;
  walk: ConsoleWalkResult;
  origin: string;
  at: string;
}): Result<ConsoleSurfaceOutcome> {
  const snapshot = readCrowdstrikeAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const projected = projectWalk({ context: consoleContext({ at, origin }), walk });
  if (projected.isErr()) {
    return err(projected.error);
  }

  const gaps = walkGaps({ at, walk });
  const files: Partial<Record<CrowdstrikeKind, CrowdstrikeKindFile>> = {};
  const statuses: Record<string, AtlasKindStatus> = {};
  for (const { kind, entities, reason } of consoleKindPlan({ projected: projected.value, walk })) {
    const folded = foldConsoleKind({
      at,
      entities,
      gaps: gaps.filter((gap) => gap.kind === kind),
      kind,
      reason,
      snapshot: snapshot.value.files[kind],
    });
    if (folded.isErr()) {
      return err(folded.error);
    }
    files[kind] = folded.value.file;
    statuses[kind] = folded.value.status;
  }

  const manifest: CrowdstrikeManifest = snapshot.value.manifest ?? initialCrowdstrikeManifest({ updatedAt: at });
  const published = publishCrowdstrikeAtlas({
    files,
    manifest: { ...manifest, kinds: { ...manifest.kinds, ...statuses }, updatedAt: at },
    paths,
    derivedFrom: snapshot.value.manifest,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({
    landedCount: walk.pages.filter((page) => page.outcome === "landed").length,
    pageCount: walk.pages.length,
    requestCount: walk.requests.length,
    written: published.value,
  });
}

/** Both console kinds' entities, projected once, or every reason the walk cannot be published. */
function projectWalk({
  walk,
  context,
}: {
  walk: ConsoleWalkResult;
  context: ProjectionContext;
}): Result<{ pages: readonly CrowdstrikeEntity[]; requests: readonly CrowdstrikeEntity[] }> {
  const pages: CrowdstrikeEntity[] = [];
  const requests: CrowdstrikeEntity[] = [];
  const problems: string[] = [];
  for (const observation of walk.pages) {
    const projected = projectCrowdstrikeConsolePage({ context, observation });
    if (projected.isErr()) {
      problems.push(...projected.error);
      continue;
    }
    pages.push(projected.value);
  }
  for (const observation of walk.requests) {
    const projected = projectCrowdstrikeConsoleRequest({ context, observation });
    if (projected.isErr()) {
      problems.push(...projected.error);
      continue;
    }
    requests.push(projected.value);
  }
  return problems.length > 0
    ? err(crowdstrikeAtlasErrorLines({ error: CrowdstrikeAtlasErrors.walkUnpublishable({ problems }) }))
    : ok({ pages, requests });
}

/** What each console kind publishes this run, and the sentence its coverage cell carries. */
function consoleKindPlan({
  projected,
  walk,
}: {
  projected: { pages: readonly CrowdstrikeEntity[]; requests: readonly CrowdstrikeEntity[] };
  walk: ConsoleWalkResult;
}): readonly { kind: CrowdstrikeKind; entities: readonly CrowdstrikeEntity[]; reason: string }[] {
  return [
    {
      entities: projected.pages,
      kind: "console-page",
      reason: `visited ${String(walk.pages.length)} declared console page(s) — ${summariseOutcomes({ walk })}; ${String(walk.artifactsWritten)} screenshot(s) kept`,
    },
    {
      entities: projected.requests,
      kind: "console-request",
      reason: `recorded ${String(walk.requests.length)} distinct first-party endpoint(s) the console called, reduced to method, path shape and field names`,
    },
  ];
}

/**
 * Fold this walk's gaps onto what the kind already held.
 *
 * A walk that raised no gap for this kind IS the recheck that closes an earlier one: the pages it could not
 * open before are open now, so the question has been answered rather than merely not re-asked.
 */
function reconcileConsoleGaps({
  gaps,
  kind,
  stored,
  at,
}: {
  gaps: readonly CrowdstrikeKindFile["gaps"][number][];
  kind: CrowdstrikeKind;
  stored: readonly CrowdstrikeKindFile["gaps"][number][];
  at: string;
}): Result<readonly CrowdstrikeKindFile["gaps"][number][]> {
  return reconcileCrowdstrikeGaps({
    at,
    observed: gaps,
    rechecks: [
      { condition: "console-page-unreachable", resolved: gaps.length === 0, scope: crowdstrikeKindScope({ kind }) },
    ],
    runFailed: false,
    stored,
  });
}

/**
 * The proof that a walk was a complete read of the console's declared surface.
 *
 * A walk that ran to the end of the sitemap HAS seen everything the console declares, so a page the console
 * has stopped declaring may be staled. The proof is the walk itself rather than a flag a caller sets — see
 * `merge.ts` on why staling takes evidence.
 */
function walkIsComplete({
  entities,
  kind,
}: {
  entities: readonly CrowdstrikeEntity[];
  kind: CrowdstrikeKind;
}): CompleteFamilyRead | null {
  const proven = provenCompleteRead({
    kind,
    observed: entities.length,
    pagesExhausted: true,
    reportedTotal: entities.length,
  });
  return proven.isOk() ? proven.value : null;
}

/** Merge one console kind's fresh entities onto what is stored, and grade the result. */
function foldConsoleKind({
  kind,
  entities,
  gaps,
  reason,
  snapshot,
  at,
}: {
  kind: CrowdstrikeKind;
  entities: readonly CrowdstrikeEntity[];
  gaps: readonly CrowdstrikeKindFile["gaps"][number][];
  reason: string;
  snapshot: CrowdstrikeKindFile | null;
  at: string;
}): Result<{ file: CrowdstrikeKindFile; status: AtlasKindStatus }> {
  const stored = snapshot ?? emptyCrowdstrikeKindFile({ kind, updatedAt: at });
  const merged = mergeCrowdstrikeKind({
    at,
    complete: walkIsComplete({ entities, kind }),
    observed: entities,
    stored: stored.entities,
  });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const reconciled = reconcileConsoleGaps({ at, gaps, kind, stored: stored.gaps });
  if (reconciled.isErr()) {
    return err(reconciled.error);
  }
  const cell = succeededCrowdstrikeCoverageCell({
    at,
    reason,
    role: "authoritative",
    scope: crowdstrikeKindScope({ kind }),
    surface: "falcon-console",
  });
  const file = assembleCrowdstrikeKindFile({
    at,
    coverage: replaceCrowdstrikeCoverageCell({ cell, cells: stored.coverage }),
    entities: merged.value,
    gaps: reconciled.value,
    kind,
  });
  if (file.isErr()) {
    return err(file.error);
  }
  return ok({
    file: file.value,
    status: succeededKindStatus({ at, entityCount: merged.value.length, reasons: [] }),
  });
}
