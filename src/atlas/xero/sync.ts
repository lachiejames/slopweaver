/**
 * Publish the API surface: every operation the installed `xero-node` declares onto the `method` kind's `api`
 * channel, and every business-object family it implies onto the `family` kind.
 *
 * ## It publishes two kinds and ONE channel, which is what keeps the walk safe
 *
 * This writes `method` and `family` and omits `page`, and inside `method` it merges only the `api` channel
 * (`merge.ts`). The kit's `publishAtlas` leaves an omitted kind's file untouched, so a sync that runs while
 * a walk is stale cannot blank what the walk saw — and since the disjointness between the two surfaces is
 * this atlas's central corroboration output, that is a mechanism rather than a nicety.
 *
 * ## The `family` kind is where the owner's one bound is expressed
 *
 * `docs/atlas-intent/06-holdings.md`: an atlas holding everything reachable holds it minus the highly voluminous, and
 * a voluminous surface is **enumerated and declared rather than stored whole**. So every family Xero exposes
 * gets a row saying what its records are, which operations reach it, which page shows it and whether this
 * atlas holds them — and the ten families whose records are observations say so, by name, with a reason.
 * A generation that simply omitted them would answer "Xero has no general ledger", which is false.
 *
 * ## `live-api` is DECLARED and UNFILLED, and that cell is the answer to the obvious question
 *
 * Nothing here reaches Xero. The compiled surface says what could be asked; it does not say what this
 * installation may ask, and no file in the package knows. The `live-api` coverage cell states the whole
 * situation in one place — `not-configured`, with `unblockedBy` naming exactly what would fill it — so a
 * reader learns why the atlas holds no invoice from the atlas rather than from a document.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { failedXeroCoverageCell, storedXeroCoverageCell, succeededXeroCoverageCell } from "./coverage.js";
import { type XeroFamily, xeroFamilies } from "./families.js";
import { openXeroGap, reconcileXeroGaps, type XeroGapRecheck } from "./gaps.js";
import { mergeXeroChannel } from "./merge.js";
import {
  emptyXeroKindFile,
  initialXeroManifest,
  type XeroAtlasEntity,
  type XeroAtlasGap,
  type XeroAtlasKind,
  type XeroAtlasKindFile,
  type XeroAtlasManifest,
  type XeroCoverageCell,
} from "./model.js";
import { projectXeroApiMethods, projectXeroFamilies } from "./projection.js";
import { readXeroSdkSurface, XERO_SDK_PACKAGE, type XeroSdkSurface } from "./sdkRead.js";
import { publishXeroAtlas, readXeroAtlas, withXeroPublishLock, type XeroAtlasPaths } from "./store.js";

/**
 * The surface name the compiled API channel's coverage is reported under.
 *
 * @internal
 */
export const XERO_SDK_SURFACE = "sdk-declared";

/**
 * The surface name the UNFILLED live API is reported under.
 *
 * @internal
 */
export const XERO_LIVE_SURFACE = "live-api";

/**
 * What would let this atlas hold a family's rows.
 *
 * One string, used by both the family rows and the `live-api` coverage cell, so a reader cannot find two
 * different accounts of the same block. It names a mechanism rather than a wish, because a gap whose remedy
 * is vague is a gap nobody ever closes.
 *
 * @internal
 */
export const XERO_INGEST_BLOCKED_BY =
  "a Xero OAuth 2.0 connection: a client id and secret from a Xero app, and one organisation's consent to " +
  "the accounting scopes. This installation's only Xero access today is a signed-in browser session, which " +
  "`docs/atlas-intent/07-browser-fallback.md` makes the ingest FALLBACK rather than the first reach — so the surface that " +
  "should answer first has no credential, and the atlas says so rather than scraping the books out of a page";

/**
 * The scope the ingest gap is filed under when it is about the whole platform rather than one family.
 *
 * @internal
 */
export const XERO_INGEST_SCOPE = "xero-entity-ingest";

/**
 * What publishing the API surface did.
 *
 * @internal
 */
export interface XeroSyncOutcome {
  readonly sdkVersion: string;
  readonly moduleCount: number;
  readonly operationCount: number;
  /**
   * How many distinct ROUTES those operations resolve to.
   *
   * Reported separately because it is smaller than `operationCount` and a reader who did not know why would
   * read the difference as a parser dropping rows. Three payroll clients share one base path — see
   * `model.ts`'s `XeroMethodApiDetail` — and every declaration is kept on the route it belongs to.
   */
  readonly routeCount: number;
  readonly modelCount: number;
  readonly familyCount: number;
  readonly voluminousFamilyCount: number;
  readonly mixedFamilyCount: number;
  readonly unjudgedFamilyCount: number;
  readonly written: readonly string[];
}

/**
 * Read the installed SDK and publish its declared surface onto the `method` and `family` kinds.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason it could not be
 */
export function syncXeroApiSurface({ paths, at }: { paths: XeroAtlasPaths; at: string }): Result<XeroSyncOutcome> {
  const surface = readXeroSdkSurface();
  if (surface.isErr()) {
    return err(surface.error);
  }
  // The read and the write are one critical section: another publisher landing between them would have its
  // rows replaced by files derived from the generation this one read. See `withXeroPublishLock`.
  return withXeroPublishLock({
    nowIso: at,
    paths,
    publish: () => publishDeclaredSurface({ at, paths, surface: surface.value }),
  });
}

/**
 * What the sync counted, apart from the route count only the merge can know.
 *
 * @param families every family derived from the SDK's own operations
 * @param surface what the installed client declares
 * @returns every field of the outcome that is a count of what was read
 */
function syncTally({
  families,
  surface,
}: {
  families: readonly XeroFamily[];
  surface: XeroSdkSurface;
}): Omit<XeroSyncOutcome, "routeCount" | "written"> {
  const tally = ({ disposition }: { disposition: XeroFamily["disposition"] }): number =>
    families.filter((family) => family.disposition === disposition).length;
  return {
    familyCount: families.length,
    mixedFamilyCount: tally({ disposition: "mixed" }),
    modelCount: Object.keys(surface.modelFields).length,
    moduleCount: surface.modules.length,
    operationCount: surface.operations.length,
    sdkVersion: surface.version,
    unjudgedFamilyCount: tally({ disposition: "unjudged" }),
    voluminousFamilyCount: tally({ disposition: "voluminous" }),
  };
}

/** The kind file the store held, or an empty one stamped `at` when it held none. */
function heldKindFile({
  kind,
  stored,
  at,
}: {
  kind: XeroAtlasKind;
  stored: XeroAtlasKindFile | null | undefined;
  at: string;
}): XeroAtlasKindFile {
  if (stored == null) {
    return emptyXeroKindFile({ kind, updatedAt: at });
  }
  return stored;
}

/** The critical section: read the generation, merge the API channel onto it, and publish. */
function publishDeclaredSurface({
  paths,
  at,
  surface,
}: {
  paths: XeroAtlasPaths;
  at: string;
  surface: XeroSdkSurface;
}): Result<XeroSyncOutcome> {
  const snapshot = readXeroAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const families = xeroFamilies({ operations: surface.operations });
  const storedMethods = heldKindFile({ at, kind: "method", stored: snapshot.value.files.method });
  const storedFamilies = heldKindFile({ at, kind: "family", stored: snapshot.value.files.family });

  const methods = mergeXeroChannel({
    at,
    channel: "api",
    observed: projectXeroApiMethods({ at, modelFields: surface.modelFields, operations: surface.operations }),
    stored: storedMethods.entities,
  });
  if (methods.isErr()) {
    return err(methods.error);
  }
  const familyFile = mergedFamilyFile({ at, families, stored: storedFamilies });
  if (familyFile.isErr()) {
    return err(familyFile.error);
  }
  const methodFile = declaredMethodFile({ at, entities: methods.value, stored: storedMethods, surface });
  const routeCount = methodFile.entities.filter((entity) => entity.channels.api !== null).length;

  const published = publishXeroAtlas({
    derivedFrom: snapshot.value.manifest,
    files: { family: familyFile.value, method: methodFile },
    manifest: syncManifest({
      at,
      familyCount: familyFile.value.entities.length,
      manifest: snapshot.value.manifest,
      methodCount: methodFile.entities.length,
    }),
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({ ...syncTally({ families, surface }), routeCount, written: published.value });
}

/**
 * The method kind with the API channel's own coverage cell replaced and nothing else touched.
 *
 * @param stored the method kind as the store already holds it
 * @param entities this run's merged entities
 * @param surface what the installed client declares
 * @param at this run's ISO timestamp
 * @returns the file to publish
 */
function declaredMethodFile({
  stored,
  entities,
  surface,
  at,
}: {
  stored: XeroAtlasKindFile;
  entities: readonly XeroAtlasEntity[];
  surface: XeroSdkSurface;
  at: string;
}): XeroAtlasKindFile {
  const reason =
    `${String(surface.operations.length)} operation(s) across ${String(surface.modules.length)} generated ` +
    `API class(es), resolving to ${String(entities.filter((entity) => entity.channels.api !== null).length)} ` +
    `distinct route(s), with response fields from ${String(Object.keys(surface.modelFields).length)} model(s), ` +
    `in ${XERO_SDK_PACKAGE} ${surface.version}`;
  return {
    ...stored,
    coverage: [
      ...stored.coverage.filter((cell) => cell.surface !== XERO_SDK_SURFACE),
      succeededXeroCoverageCell({
        artifacts: [],
        at,
        channel: "api",
        reason,
        role: "authoritative",
        scope: "declared-operations",
        state: "synced",
        surface: XERO_SDK_SURFACE,
      }),
    ],
    entities: [...entities],
    updatedAt: at,
  };
}

/** Merge this run's derived families onto the stored family kind, with the ingest cell and gaps. */
function mergedFamilyFile({
  families,
  stored,
  at,
}: {
  families: readonly XeroFamily[];
  stored: XeroAtlasKindFile;
  at: string;
}): Result<XeroAtlasKindFile> {
  const entities = mergeXeroChannel({
    at,
    channel: "api",
    observed: projectXeroFamilies({ at, families, ingestBlockedBy: XERO_INGEST_BLOCKED_BY }),
    stored: stored.entities,
  });
  if (entities.isErr()) {
    return err(entities.error);
  }
  const gaps = reconcileXeroGaps({
    at,
    observed: familyGaps({ at, families }),
    rechecks: familyRechecks({ families }),
    runFailed: false,
    stored: stored.gaps,
  });
  if (gaps.isErr()) {
    return err(gaps.error);
  }
  return ok({
    ...stored,
    coverage: [
      ...stored.coverage.filter((cell) => cell.surface !== XERO_LIVE_SURFACE),
      ingestCoverageCell({ families, stored }),
    ],
    entities: [...entities.value],
    gaps: [...gaps.value],
    kind: "family",
    updatedAt: at,
  });
}

/**
 * The cell that says why this atlas holds no Xero record, and exactly what would change that.
 *
 * `not-configured` rather than `excluded`: nothing here decided not to hold the entities — the ruling is
 * that this atlas SHOULD hold them, because nothing better suited does. The credential is what is missing,
 * and a cell that said `excluded` would be claiming a design decision that was never made.
 */
function ingestCoverageCell({
  families,
  stored,
}: {
  families: readonly XeroFamily[];
  stored: XeroAtlasKindFile;
}): XeroCoverageCell {
  const holdable = families.filter((family) => family.disposition !== "voluminous").length;
  return failedXeroCoverageCell({
    channel: "api",
    previous: storedXeroCoverageCell({ coverage: stored.coverage, surface: XERO_LIVE_SURFACE }),
    reason:
      `0 of ${String(holdable)} holdable family(ies) ingested — every family is enumerated and declared, and ` +
      `none of their rows is held. ${String(families.length - holdable)} further family(ies) are voluminous ` +
      "by the owner's own criterion and will never publish a row per record whatever credential exists",
    role: "authoritative",
    scope: "entity-rows",
    state: "not-configured",
    surface: XERO_LIVE_SURFACE,
    unblockedBy: XERO_INGEST_BLOCKED_BY,
  });
}

/** One ingest gap per family this atlas could hold and does not, plus one for any family it cannot judge. */
function familyGaps({ families, at }: { families: readonly XeroFamily[]; at: string }): readonly XeroAtlasGap[] {
  return families.flatMap((family): readonly XeroAtlasGap[] => {
    if (family.disposition === "unjudged") {
      return [
        openXeroGap({
          at,
          condition: "family-unjudged",
          fields: [],
          kind: "family",
          reason: family.reason,
          scope: family.key,
          surfaces: ["api"],
        }),
      ];
    }
    if (family.disposition === "voluminous") {
      // Not a gap. A voluminous family holding no rows is the DISPOSITION working, and filing it as a gap
      // would put ten permanent, uncloseable rows in a list whose whole value is that it shrinks.
      return [];
    }
    return [
      openXeroGap({
        at,
        condition: "entity-ingest-not-configured",
        fields: [],
        kind: "family",
        // Short on purpose, and it names where the remedy is rather than repeating it. There is one of
        // these per holdable family — 62 of them on `xero-node` 19.1.0 — so a gap that inlined the whole
        // credential paragraph would put the same 400 words on screen sixty-two times, which is a wall of
        // text a reader skips rather than a list they act on. The `live-api` coverage cell states it once.
        reason: `this atlas holds no ${family.segment} row — see the live-api coverage cell for the one credential that would change that`,
        scope: family.key,
        surfaces: ["api"],
      }),
    ];
  });
}

/** Every family this run genuinely rechecked, so a family that becomes ingested closes its own gap. */
function familyRechecks({ families }: { families: readonly XeroFamily[] }): readonly XeroGapRecheck[] {
  return families.flatMap((family) => [
    { condition: "entity-ingest-not-configured", resolved: family.disposition === "voluminous", scope: family.key },
    { condition: "family-unjudged", resolved: family.disposition !== "unjudged", scope: family.key },
  ]);
}

/** The manifest the store held, or a fresh one stamped `at` when it held none. */
function heldManifest({ manifest, at }: { manifest: XeroAtlasManifest | null; at: string }): XeroAtlasManifest {
  if (manifest == null) {
    return initialXeroManifest({ updatedAt: at });
  }
  return manifest;
}

/** Stamp the two kinds this sync wrote, leaving `page`'s exactly as the walk left it. */
function syncManifest({
  manifest,
  methodCount,
  familyCount,
  at,
}: {
  manifest: XeroAtlasManifest | null;
  methodCount: number;
  familyCount: number;
  at: string;
}): XeroAtlasManifest {
  const base = heldManifest({ at, manifest });
  const status = ({ count }: { count: number }) => ({
    digest: null,
    entityCount: count,
    lastAttempt: { at, outcome: "ok" as const, reasons: [] },
    lastSuccessAt: at,
  });
  return {
    ...base,
    kinds: { ...base.kinds, family: status({ count: familyCount }), method: status({ count: methodCount }) },
    updatedAt: at,
  };
}
