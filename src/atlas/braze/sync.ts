/**
 * `atlas braze sync` — publish BOTH published surfaces: every operation Braze's endpoint reference declares
 * and every operation its official Postman collection ships, onto each kind's `docs` and `collection`
 * channels.
 *
 * ## What this verb can and cannot claim
 *
 * It reads two public documents and reaches no workspace, so a `synced` cell here says the documents were
 * read in full and says NOTHING about what this installation may call. The `rest-api` and `dashboard`
 * surfaces stay `declared-unfilled` and every kind carries a `not-configured` cell for each, because reading
 * a published operation as a capability is the single most available mistake with this atlas and a coverage
 * cell is where it has to be refused.
 *
 * ## The census is RECORDED, and the READER is enforced
 *
 * Braze edits its documentation constantly — 289 of its 1,352 pages changed in the month before this landed —
 * so a census gate over numbers that legitimately move would refuse to publish within days. `specLock.ts`
 * carries the reasoning. What IS enforced is this build's ability to read: every operation page Braze SERVES
 * must yield the block it renders into it — a declared page it redirects off the operation tree owes none and
 * is printed instead (`docsCatalogue.ts`) — and the optional extractions must still find
 * something. A parameter table that silently stopped matching would otherwise publish 146 operations that
 * appear to take no arguments, which reads as an answer and is not one.
 *
 * ## Gaps are raised on every successful run, and that is correct
 *
 * `rest-credential-absent`, `browser-account-absent`, `browser-route-inventory-undiscovered`, one
 * `browser-route-not-attempted` per declared route, and one row per operation the two published channels
 * disagree about. None can be closed by anything this verb does, and an atlas whose gap list emptied because
 * the only pass that could run had run would be reporting completeness it does not have.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { BRAZE_BROWSER_ROUTES, type BrazeBrowserRoute, brazeRouteUrl } from "./browserPages.js";
import { type BrazeCollectionOperationRow, readBrazeCollection } from "./collection.js";
import { BRAZE_DASHBOARD_SURFACE, failedBrazeCoverageCell, operationCoverage } from "./coverage.js";
import { brazeDispositionRuleIds } from "./dispositions.js";
import type { BrazeDocsOperationRow } from "./docsCatalogue.js";
import { BrazeAtlasErrors, brazeAtlasErrorLines } from "./errors.js";
import { openBrazeGap, reconcileBrazeGaps } from "./gaps.js";
import { mergeBrazeChannel } from "./merge.js";
import {
  BRAZE_KINDS,
  BRAZE_PAGE_KIND,
  BRAZE_UNDOCUMENTED_KIND,
  type BrazeAtlasGap,
  type BrazeAtlasKindFile,
  type BrazeAtlasManifest,
  type BrazeDisposition,
  type BrazeKind,
  emptyBrazeKindFile,
  initialBrazeManifest,
} from "./model.js";
import { projectBrazeCollectionOperation, projectBrazeDocsOperation } from "./projection.js";
import { brazeReaderFloorFailure } from "./readerFloor.js";
import { BRAZE_CENSUS } from "./specLock.js";
import {
  type BrazeFetchLike,
  type BrazeUnservedPage,
  loadBrazeCollectionText,
  loadBrazeDocsSurface,
} from "./specSource.js";
import { type BrazeAtlasPaths, type BrazeAtlasSnapshot, publishBrazeAtlas, readBrazeAtlas } from "./store.js";
import {
  type BrazeKindObservation,
  type BrazeMalformedAddress,
  brazeOperationGaps,
  brazeOperationRechecks,
} from "./syncGaps.js";

/** What a sync did, which is what `--json` prints. */
export interface BrazeSyncOutcome {
  readonly declaredRouteCount: number;
  readonly dispositionCounts: Readonly<Record<BrazeDisposition, number>>;
  /** Operations both published channels describe. */
  readonly corroboratedCount: number;
  /** Operations only the reference describes. */
  readonly docsOnlyCount: number;
  /** Operations only the collection ships. */
  readonly collectionOnlyCount: number;
  readonly documentedCount: number;
  readonly collectionRequestCount: number;
  readonly collectionOperationCount: number;
  /** How the census this run measured differs from the reviewed one. Empty when it matches. */
  readonly censusDrift: readonly string[];
  readonly operationCount: number;
  readonly pagesFetched: number;
  readonly pagesFromCache: number;
  /** Operation pages the sitemap declares and Braze redirects off the operation tree — each printed, never cached. */
  readonly unservedPages: readonly BrazeUnservedPage[];
  readonly written: readonly string[];
}

/**
 * Read both published documents and publish them.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp
 * @param fetchImpl the HTTP seam; omitted takes the platform `fetch`
 * @returns what was published, or every reason it could not be
 */
export async function syncBrazePublishedSurfaces({
  paths,
  at,
  fetchImpl,
}: {
  paths: BrazeAtlasPaths;
  at: string;
  fetchImpl?: BrazeFetchLike;
}): Promise<Result<BrazeSyncOutcome>> {
  const docs = await loadBrazeDocsSurface(
    fetchImpl === undefined ? { root: paths.directory } : { fetchImpl, root: paths.directory },
  );
  if (docs.isErr()) {
    return err(docs.error);
  }
  const collectionText = await loadBrazeCollectionText(fetchImpl === undefined ? {} : { fetchImpl });
  if (collectionText.isErr()) {
    return err(collectionText.error);
  }
  const collection = readBrazeCollection({ text: collectionText.value });
  if (collection.isErr()) {
    return err(collection.error);
  }
  // An unknown family refuses FIRST, under its own name: its pages yield no row, so the floor below would
  // otherwise refuse the same sync as an unexplained shortfall between pages served and pages read.
  if (docs.value.unknownFamilies.length > 0) {
    return err(brazeAtlasErrorLines({ error: BrazeAtlasErrors.familiesUnknown(docs.value) }));
  }
  const floor = brazeReaderFloorFailure({
    collectionRequests: collection.value.requestCount,
    rows: docs.value.rows,
    servedOperationPages: docs.value.servedPages,
  });
  if (floor !== null) {
    return err(floor);
  }
  return publishPublished({
    at,
    collection: collection.value,
    docs: docs.value,
    paths,
  });
}

/** What one read of the two documents produced, as `publishPublished` needs it. */
interface PublishedSources {
  readonly docs: {
    readonly rows: readonly BrazeDocsOperationRow[];
    readonly declaredPages: number;
    readonly fetched: number;
    readonly fromCache: number;
    readonly unservedPages: readonly BrazeUnservedPage[];
  };
  readonly collection: {
    readonly rows: readonly BrazeCollectionOperationRow[];
    readonly requestCount: number;
    readonly duplicates: readonly { readonly name: string; readonly providerId: string }[];
  };
}

/** Read the generation, merge both published channels onto it, and publish. */
function publishPublished({
  paths,
  at,
  docs,
  collection,
}: PublishedSources & { paths: BrazeAtlasPaths; at: string }): Result<BrazeSyncOutcome> {
  const snapshot = readBrazeAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const index = indexOperations({ collection, docs });
  const built = buildKindFiles({ at, index, snapshot: snapshot.value });
  if (built.isErr()) {
    return err(built.error);
  }
  const published = publishBrazeAtlas({
    derivedFrom: snapshot.value.manifest,
    files: built.value.files,
    manifest: syncManifest({ at, counts: built.value.counts, manifest: snapshot.value.manifest }),
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({
    censusDrift: censusDrift({ index }),
    collectionOnlyCount: index.collectionOnly.length,
    collectionOperationCount: collection.rows.length,
    collectionRequestCount: collection.requestCount,
    corroboratedCount: index.corroborated.length,
    declaredRouteCount: BRAZE_BROWSER_ROUTES.length,
    dispositionCounts: index.dispositionCounts,
    docsOnlyCount: index.docsOnly.length,
    documentedCount: docs.rows.length,
    operationCount: index.providerIds.size,
    pagesFetched: docs.fetched,
    pagesFromCache: docs.fromCache,
    unservedPages: docs.unservedPages,
    written: published.value,
  });
}

/** Both channels' rows, each with the kind it lands in, cross-matched on the shared provider key. */
interface OperationIndex {
  readonly docsRows: readonly BrazeDocsOperationRow[];
  /** Every collection row, landed in its documented kind, or in `undocumented` when the reference omits it. */
  readonly collectionRows: readonly { readonly kind: BrazeKind; readonly row: BrazeCollectionOperationRow }[];
  readonly corroborated: readonly string[];
  readonly docsOnly: readonly string[];
  readonly collectionOnly: readonly BrazeCollectionOperationRow[];
  readonly providerIds: ReadonlySet<string>;
  readonly dispositionCounts: Readonly<Record<BrazeDisposition, number>>;
  readonly duplicates: readonly { readonly name: string; readonly providerId: string }[];
  readonly malformed: readonly BrazeMalformedAddress[];
}

/**
 * Cross-match the two channels, deciding which kind each collection-only operation lands in.
 *
 * @returns both channels' rows by kind, the cross-match, and every malformed address
 * @internal
 */
export function indexOperations({ docs, collection }: PublishedSources): OperationIndex {
  const kindByProviderId = new Map<string, BrazeKind>();
  const malformed: BrazeMalformedAddress[] = [];
  for (const row of docs.rows) {
    kindByProviderId.set(row.providerId, row.kind);
    if (row.pathDefect !== null) {
      malformed.push({ channel: "docs", detail: row.pathDefect, providerId: row.providerId });
    }
  }
  const collectionRows: OperationIndex["collectionRows"][number][] = [];
  const collectionOnly: BrazeCollectionOperationRow[] = [];
  const collectionIds = new Set<string>();
  for (const row of collection.rows) {
    collectionIds.add(row.providerId);
    const documented = kindByProviderId.get(row.providerId);
    // An operation the reference does not declare is collection-only — the cross-match's own finding.
    if (documented === undefined) {
      collectionOnly.push(row);
      collectionRows.push({ kind: BRAZE_UNDOCUMENTED_KIND, row });
    } else {
      collectionRows.push({ kind: documented, row });
    }
    if (row.pathDefect !== null) {
      malformed.push({ channel: "collection", detail: row.pathDefect, providerId: row.providerId });
    }
  }
  const docsIds = new Set(kindByProviderId.keys());
  const providerIds = new Set([...docsIds, ...collectionIds]);
  return {
    collectionOnly,
    collectionRows,
    corroborated: [...docsIds].filter((id) => collectionIds.has(id)).toSorted(),
    dispositionCounts: dispositionCounts({ collectionOnly, docs: docs.rows }),
    docsOnly: [...docsIds].filter((id) => !collectionIds.has(id)).toSorted(),
    docsRows: docs.rows,
    duplicates: collection.duplicates,
    malformed,
    providerIds,
  };
}

/** How many operations across both channels carry each disposition. */
function dispositionCounts({
  docs,
  collectionOnly,
}: {
  docs: readonly BrazeDocsOperationRow[];
  collectionOnly: readonly BrazeCollectionOperationRow[];
}): Readonly<Record<BrazeDisposition, number>> {
  const counts = { excluded: 0, reachable: 0, voluminous: 0 };
  for (const row of docs) {
    counts[row.disposition] += 1;
  }
  for (const row of collectionOnly) {
    counts[row.disposition] += 1;
  }
  return counts;
}

/** How this run's numbers differ from the reviewed census. Reported, never enforced — see `specLock.ts`. */
function censusDrift({ index }: { index: OperationIndex }): readonly string[] {
  const drift: string[] = [];
  const compare = ({ label, got, want }: { label: string; got: number; want: number }): void => {
    if (got !== want) {
      drift.push(`${label}: read ${String(got)}, reviewed ${String(want)}`);
    }
  };
  compare({ got: index.providerIds.size, label: "distinct operations", want: BRAZE_CENSUS.allOperations });
  compare({
    got: index.corroborated.length,
    label: "corroborated operations",
    want: BRAZE_CENSUS.corroboratedOperations,
  });
  compare({ got: index.docsOnly.length, label: "reference-only operations", want: BRAZE_CENSUS.docsOnlyOperations });
  compare({
    got: index.collectionOnly.length,
    label: "collection-only operations",
    want: BRAZE_CENSUS.collectionOnlyOperations,
  });
  compare({ got: index.dispositionCounts.reachable, label: "reachable", want: BRAZE_CENSUS.reachableOperations });
  compare({ got: index.dispositionCounts.voluminous, label: "voluminous", want: BRAZE_CENSUS.voluminousOperations });
  compare({ got: index.dispositionCounts.excluded, label: "excluded", want: BRAZE_CENSUS.excludedOperations });
  return drift;
}

/**
 * Build every kind's next file from what this run read and what the store already holds.
 *
 * Every operation kind's gaps are judged against the rows of the WHOLE run, so a reviewed rule that fires
 * only in another kind is not dead here.
 *
 * @param index this run's rows, cross-matched by `indexOperations`
 * @param snapshot the generation the store already holds
 * @returns every kind's next file and its entity count
 * @internal
 */
export function buildKindFiles({
  index,
  snapshot,
  at,
}: {
  index: OperationIndex;
  snapshot: BrazeAtlasSnapshot;
  at: string;
}): Result<{
  files: Partial<Record<BrazeKind, BrazeAtlasKindFile>>;
  counts: Readonly<Record<BrazeKind, number>>;
}> {
  const files: Partial<Record<BrazeKind, BrazeAtlasKindFile>> = {};
  const counts: Partial<Record<BrazeKind, number>> = {};
  const reviewedRuleIds = brazeDispositionRuleIds();
  const runRows = [...index.docsRows, ...index.collectionRows.map(({ row }) => row)];
  for (const kind of BRAZE_KINDS) {
    const stored = snapshot.files[kind] ?? emptyBrazeKindFile({ kind, updatedAt: at });
    const next =
      kind === BRAZE_PAGE_KIND
        ? declaredRoutesFile({ at, stored })
        : operationKindFile({ at, index, kind, reviewedRuleIds, runRows, stored });
    if (next.isErr()) {
      return err(next.error);
    }
    files[kind] = next.value;
    counts[kind] = next.value.entities.length;
  }
  // `as`: every kind was just visited, so the partial is complete. Same convention as `cloudflare/reset.ts`.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return ok({ counts: counts as Record<BrazeKind, number>, files });
}

/** One operation kind's next file: both published channels merged on, four coverage cells, and its gaps. */
function operationKindFile({
  kind,
  index,
  stored,
  runRows,
  reviewedRuleIds,
  at,
}: {
  kind: BrazeKind;
  index: OperationIndex;
  stored: BrazeAtlasKindFile;
  runRows: BrazeKindObservation["runRows"];
  reviewedRuleIds: readonly string[];
  at: string;
}): Result<BrazeAtlasKindFile> {
  const docsRows = index.docsRows.filter((row) => row.kind === kind);
  const collectionRows = index.collectionRows.filter((landed) => landed.kind === kind).map(({ row }) => row);
  const withDocs = mergeBrazeChannel({
    at,
    channel: "docs",
    observed: docsRows.map((row) => projectBrazeDocsOperation({ at, row })),
    stored: stored.entities,
  });
  if (withDocs.isErr()) {
    return err(withDocs.error);
  }
  const withCollection = mergeBrazeChannel({
    at,
    channel: "collection",
    observed: collectionRows.map((row) => projectBrazeCollectionOperation({ at, kind, row })),
    stored: withDocs.value,
  });
  if (withCollection.isErr()) {
    return err(withCollection.error);
  }
  const observation = {
    at,
    collectionOnly: new Set(index.collectionOnly.map((row) => row.providerId)),
    collectionRows,
    docsRows,
    kind,
    malformed: malformedOwnedBy({ collectionRows, docsRows, malformed: index.malformed }),
    reviewedRuleIds,
    runRows,
  };
  const gaps = reconciledKindGaps({ observation, stored: stored.gaps });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  return ok({
    ...stored,
    coverage: operationCoverage({ at, collectionRows, docsRows, stored }),
    entities: [...withCollection.value],
    gaps: [...gaps.value],
    updatedAt: at,
  });
}

/** One kind's stored gaps folded with what this run raised and rechecked for it. */
function reconciledKindGaps({
  observation,
  stored,
}: {
  observation: BrazeKindObservation;
  stored: readonly BrazeAtlasGap[];
}): Result<readonly BrazeAtlasGap[]> {
  return reconcileBrazeGaps({
    at: observation.at,
    observed: brazeOperationGaps({ observation }),
    rechecks: brazeOperationRechecks({ observation }),
    runFailed: false,
    stored,
  });
}

/** Only the malformed addresses belonging to operations THIS kind holds. */
function malformedOwnedBy({
  malformed,
  docsRows,
  collectionRows,
}: {
  malformed: readonly BrazeMalformedAddress[];
  docsRows: readonly BrazeDocsOperationRow[];
  collectionRows: readonly BrazeCollectionOperationRow[];
}): readonly BrazeMalformedAddress[] {
  const docsIds = new Set(docsRows.map((row) => row.providerId));
  const collectionIds = new Set(collectionRows.map((row) => row.providerId));
  return malformed.filter((defect) =>
    defect.channel === "docs" ? docsIds.has(defect.providerId) : collectionIds.has(defect.providerId),
  );
}

/** Where a declared route is, for its gap: its URL, or that Braze publishes only a breadcrumb to it. */
function routeWhereabouts({ route }: { route: BrazeBrowserRoute }): string {
  const url = brazeRouteUrl({ route });
  if (url === null) {
    return "no URL published by Braze — a walk must discover it";
  }
  return url;
}

/**
 * The `page` kind after a sync: no entity, one `not-configured` coverage cell, and one gap per declared route
 * plus the standing one saying the declaration is a floor.
 *
 * A declared-but-unvisited route is deliberately NOT published as an entity. `kit/read.ts` requires an
 * entity's observations to be non-empty, and a route no channel has seen has none — so publishing one would
 * make an empty row look like a reached page, which is the exact failure the browser surface's whole design
 * is aimed at.
 */
function declaredRoutesFile({ stored, at }: { stored: BrazeAtlasKindFile; at: string }): Result<BrazeAtlasKindFile> {
  const observed: BrazeAtlasGap[] = BRAZE_BROWSER_ROUTES.map((route) =>
    openBrazeGap({
      at,
      condition: "browser-route-not-attempted",
      fields: [],
      kind: BRAZE_PAGE_KIND,
      reason: `declared and never walked: ${route.description} (${routeWhereabouts({ route })}). Grounded because ${route.grounding}`,
      scope: route.surface,
      surfaces: ["browser"],
    }),
  );
  observed.push(
    openBrazeGap({
      at,
      condition: "browser-route-inventory-undiscovered",
      fields: [],
      kind: BRAZE_PAGE_KIND,
      reason:
        "Braze publishes dashboard navigation as breadcrumbs rather than URLs — exactly one literal dashboard " +
        "address appears across all of its endpoint reference — so the dashboard's real route inventory " +
        "cannot be enumerated without a session. The declared list is a FLOOR, and a walk will only ever add " +
        "to it",
      scope: "dashboard-route-inventory",
      surfaces: ["browser"],
    }),
  );
  const gaps = reconcileBrazeGaps({ at, observed, rechecks: [], runFailed: false, stored: stored.gaps });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  const kept = stored.coverage.filter((cell) => cell.surface !== BRAZE_DASHBOARD_SURFACE);
  const previous = stored.coverage.find((cell) => cell.surface === BRAZE_DASHBOARD_SURFACE) ?? null;
  return ok({
    ...stored,
    coverage: [
      ...kept,
      failedBrazeCoverageCell({
        channel: "browser",
        previous,
        reason:
          `${String(BRAZE_BROWSER_ROUTES.length)} dashboard route(s) declared and 0 walked — this ` +
          "installation has no Braze account. The list never shrinks: an unreachable route becomes a gap " +
          "against the route, never a deletion from the declaration",
        role: "corroborating",
        scope: "dashboard-routes",
        state: "not-configured",
        surface: BRAZE_DASHBOARD_SURFACE,
        unblockedBy:
          "a Braze dashboard invite, then a walk of the declared routes in the owner's own Chrome through " +
          "the Playwright extension relay (`browser/playwrightCli.ts`)",
      }),
    ],
    gaps: [...gaps.value],
    updatedAt: at,
  });
}

/** Stamp every kind's status from what this run actually published. */
function syncManifest({
  manifest,
  counts,
  at,
}: {
  manifest: BrazeAtlasManifest | null;
  counts: Readonly<Record<BrazeKind, number>>;
  at: string;
}): BrazeAtlasManifest {
  const base = manifest ?? initialBrazeManifest({ updatedAt: at });
  const kinds: BrazeAtlasManifest["kinds"] = { ...base.kinds };
  for (const kind of BRAZE_KINDS) {
    kinds[kind] = {
      digest: null,
      entityCount: counts[kind],
      lastAttempt: { at, outcome: "ok", reasons: [] },
      lastSuccessAt: at,
    };
  }
  return { ...base, kinds, updatedAt: at };
}
