/**
 * Publish what the browser walk saw into the atlas's two browser kinds.
 *
 * ## Neither channel can truncate the other, and that is a mechanism rather than a convention
 *
 * `sync.ts` publishes the Manage API kinds and omits `browser-page`/`browser-operation`; this publishes
 * those two and omits every other kind; and the kit's `publishAtlas` leaves an omitted kind's file
 * untouched. So a walk that runs while a sync is stale cannot blank the synced kinds, and a sync cannot
 * blank the walk. Neither passes a full file map, which is what makes that true.
 *
 * ## Coverage is graded against the DECLARED denominator, never against what was reached
 *
 * `browser-page`'s coverage cell says how many of the declared pages the walk landed on AND photographed.
 * A run that reached four of twelve reports `deferred` with the fraction in its reason rather than `synced`
 * because it wrote some rows — which is exactly the failure the sibling Slack walk shipped once: of the
 * navigation surfaces asked for, all but one redirected, and the surface read as filled on the strength of that one.
 *
 * A run that landed on every page and photographed NONE of them is likewise `deferred`, and that half is
 * why this file changed. MEASURED: this walk reached every declared page and published `synced` while the
 * atlas held zero images, because the cell was graded on reachability alone. An atlas whose coverage cell
 * says it holds proof and holds none is reporting the opposite of what happened.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { succeededKindStatus } from "../kit/kindStatus.js";
import { withKindStatus } from "../kit/manifestClock.js";
import { isPageHeld, notHeldBecause } from "../kit/pageWalk.js";
import { refuseUndeclaredWalk, verifyArtifactsOnDisk, walkTally } from "../kit/walkPublish.js";

import { operationEntities, pageEntity } from "./browserEntities.js";
import { VANTA_BROWSER_PAGES } from "./browserPages.js";
import type { VantaBrowserWalkResult, VantaPageObservation } from "./browserWalk.js";
import { failedVantaCoverageCell, previousVantaCoverageCell, succeededVantaCoverageCell } from "./coverage.js";
import { openVantaGap, reconcileVantaGaps } from "./gaps.js";
import {
  type VantaBrowserKind,
  type VantaCoverageCell,
  type VantaEntity,
  type VantaGap,
  type VantaKind,
  type VantaKindFile,
  type VantaManifest,
} from "./model.js";
import {
  publishVantaAtlas,
  readVantaAtlas,
  storedVantaKindFile,
  storedVantaManifest,
  type VantaAtlasPaths,
  type VantaAtlasSnapshot,
} from "./store.js";

/**
 * What publishing a walk did.
 *
 * @internal
 */
export interface VantaBrowserSurfaceOutcome {
  readonly declaredCount: number;
  readonly reachedCount: number;
  /** How many of those the atlas also holds a verified, distinct picture of. */
  readonly photographedCount: number;
  readonly operationCount: number;
  /** Whether the walk stopped early because the browser session was lost part-way through. */
  readonly sessionLost: boolean;
  readonly written: readonly string[];
}

/** Build one browser kind's file: its entities, one coverage cell, and a gap per page not reached. */
function browserKindFile({
  kind,
  entities,
  pages,
  at,
  stored,
}: {
  kind: VantaBrowserKind;
  entities: readonly VantaEntity[];
  pages: readonly VantaPageObservation[];
  at: string;
  stored: VantaKindFile;
}): Result<VantaKindFile> {
  const cell = walkCoverageCell({ at, pages, stored });
  const gaps = walkGaps({ at, kind, pages, stored });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  return ok({
    coverage: [...stored.coverage.filter((existing) => existing.surface !== "browser-walk"), cell],
    entities: [...entities],
    gaps: [...gaps.value],
    kind,
    platform: stored.platform,
    schemaVersion: stored.schemaVersion,
    updatedAt: at,
  });
}

/**
 * The one coverage cell a walk writes, graded against the DECLARED denominator rather than what it reached
 * — and on PHOTOGRAPHED rather than merely reached, which is the half this walk shipped without.
 *
 * The denominator is {@link VANTA_BROWSER_PAGES}'s own length, never the array a caller handed in: a
 * publisher comparing against `pages.length` reports full coverage for a walk carrying an empty one.
 */
function walkCoverageCell({
  pages,
  stored,
  at,
}: {
  pages: readonly VantaPageObservation[];
  stored: VantaKindFile;
  at: string;
}): VantaCoverageCell {
  const declared = VANTA_BROWSER_PAGES.length;
  const { reached, photographed } = walkTally({ pages });
  const firstObserved = pages.find((page) => page.observedAt !== "");
  // A walk where NOTHING was observed has no instant of its own, so the cell takes this run's — stated
  // rather than coalesced, because "no page came back" is the fact a reader of a `deferred` cell wants.
  const observedAt = firstObserved === undefined ? at : firstObserved.observedAt;
  const reason =
    `${String(reached)} of ${String(declared)} declared page(s) reached, ` +
    `${String(photographed)} of those also photographed`;
  if (reached === declared && photographed === declared) {
    return succeededVantaCoverageCell({
      artifacts: pages.flatMap((page) => page.artifacts),
      at: observedAt,
      channel: "browser",
      reason,
      role: "corroborating",
      scope: "declared-pages",
      state: "synced",
      surface: "browser-walk",
    });
  }
  return failedVantaCoverageCell({
    channel: "browser",
    previous: previousVantaCoverageCell({ cells: stored.coverage, surface: "browser-walk" }),
    reason,
    role: "corroborating",
    scope: "declared-pages",
    state: "deferred",
    surface: "browser-walk",
    unblockedBy: null,
  });
}

/**
 * A gap per declared page the walk could not fully HOLD, and a recheck closing one it did.
 *
 * A page reached and not photographed is a gap too, in the same words and under the same condition: an
 * observation missing its proof is incomplete rather than complete, which is what stops a walk that
 * photographed nothing from reading like one that photographed everything. `detail-unreadable` covers both
 * because the reason says which it was, and a second condition would split one recheck into two that can
 * disagree.
 *
 * @param at this run's ISO timestamp
 * @param kind which browser kind's file this gap list belongs to
 * @param pages every declared page's observation
 * @param stored the gaps the store already holds
 * @returns the reconciled gap list, or why it could not be reconciled
 */
function walkGaps({
  at,
  kind,
  pages,
  stored,
}: {
  at: string;
  kind: VantaBrowserKind;
  pages: readonly VantaPageObservation[];
  stored: VantaKindFile;
}): Result<readonly VantaGap[]> {
  const observed = pages.flatMap((page): readonly VantaGap[] => {
    const because = notHeldBecause({ page });
    if (isPageHeld({ page }) || because === null) {
      return [];
    }
    return [
      openVantaGap({
        at,
        channel: "browser",
        condition: "detail-unreadable",
        kind,
        reason: because,
        scope: page.surface,
      }),
    ];
  });
  const rechecks = pages
    .filter((page) => isPageHeld({ page }))
    .map((page) => ({ condition: "detail-unreadable", resolved: true, scope: page.surface }));
  return reconcileVantaGaps({ at, observed, rechecks, runFailed: false, stored: stored.gaps });
}

/**
 * The manifest with only the two browser kinds' statuses advanced; every other kind's is carried through.
 *
 * This function used to stamp `updatedAt: at` itself, and that one line is why the two-clock defect was so
 * hard to see on Vanta: this atlas has TWO publishers, and only this one moved the top-level clock. A
 * generation read coherent for as long as a walk had run more recently than the API sync, and drifted
 * by the whole gap between the two the moment it had not. The clock is `publishAtlas`'s now — see `kit/manifestClock.ts` — so
 * neither publisher can set it and neither can forget to.
 */
function walkManifest({
  manifest,
  pageCount,
  operationCount,
  at,
}: {
  manifest: VantaManifest;
  pageCount: number;
  operationCount: number;
  at: string;
}): VantaManifest {
  const advanced = withKindStatus<VantaKind, VantaManifest>({
    kind: "browser-page",
    manifest,
    status: succeededKindStatus({ at, entityCount: pageCount, reasons: [] }),
  });
  return withKindStatus<VantaKind, VantaManifest>({
    kind: "browser-operation",
    manifest: advanced,
    status: succeededKindStatus({ at, entityCount: operationCount, reasons: [] }),
  });
}

/**
 * Build both browser kind files from one verified walk.
 *
 * Split from the publisher so the effectful half reads as read, build, write — the two files differ only in
 * which entities they carry, and both are graded and gapped by the same rules over the same pages.
 *
 * @param pages the observations, already verified against the bytes on disk
 * @param snapshot the atlas as it stands
 * @param at this run's ISO timestamp
 * @returns both files and the operation entities behind one of them, or why they could not be built
 */
function browserKindFiles({
  pages,
  snapshot,
  at,
}: {
  pages: readonly VantaPageObservation[];
  snapshot: VantaAtlasSnapshot;
  at: string;
}): Result<{
  pageFile: VantaKindFile;
  operationFile: VantaKindFile;
  operations: readonly VantaEntity[];
}> {
  const storedFor = ({ kind }: { kind: VantaBrowserKind }): VantaKindFile =>
    storedVantaKindFile({ at, kind, snapshot });
  const operations = operationEntities({ pages });
  const pageFile = browserKindFile({
    at,
    entities: pages.map((page) => pageEntity({ at, page })),
    kind: "browser-page",
    pages,
    stored: storedFor({ kind: "browser-page" }),
  });
  if (pageFile.isErr()) {
    return err(pageFile.error);
  }
  const operationFile = browserKindFile({
    at,
    entities: operations,
    kind: "browser-operation",
    pages,
    stored: storedFor({ kind: "browser-operation" }),
  });
  if (operationFile.isErr()) {
    return err(operationFile.error);
  }
  return ok({ operationFile: operationFile.value, operations, pageFile: pageFile.value });
}

/**
 * Publish one walk into the atlas's browser kinds.
 *
 * @param walk what the walk observed
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason it could not be
 */
export function publishVantaBrowserWalk({
  walk,
  paths,
  at,
}: {
  walk: VantaBrowserWalkResult;
  paths: VantaAtlasPaths;
  at: string;
}): Result<VantaBrowserSurfaceOutcome> {
  const undeclared = refuseUndeclaredWalk({
    declaredSurfaces: VANTA_BROWSER_PAGES.map((page) => page.surface),
    pages: walk.pages,
  });
  if (undeclared.isErr()) {
    return err(undeclared.error);
  }
  const snapshot = readVantaAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  // The bytes, never the reference: a caller can hand over an artifact reference with no file behind it,
  // and a grader reading only the reference publishes `synced` coverage over screenshots that exist
  // nowhere. See `kit/walkPublish.ts`.
  const pages = verifyArtifactsOnDisk({ directory: paths.directory, pages: walk.pages });
  const built = browserKindFiles({ at, pages, snapshot: snapshot.value });
  if (built.isErr()) {
    return err(built.error);
  }
  const published = publishVantaAtlas({
    derivedFrom: snapshot.value.manifest,
    files: { "browser-operation": built.value.operationFile, "browser-page": built.value.pageFile },
    manifest: walkManifest({
      at,
      manifest: storedVantaManifest({ at, snapshot: snapshot.value }),
      operationCount: built.value.operations.length,
      pageCount: pages.length,
    }),
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  const tally = walkTally({ pages });
  return ok({
    declaredCount: VANTA_BROWSER_PAGES.length,
    operationCount: built.value.operations.length,
    photographedCount: tally.photographed,
    reachedCount: tally.reached,
    sessionLost: walk.sessionLost,
    written: published.value,
  });
}
