/**
 * Publish both surface maps — every operation the pinned document declares, and every browser route the
 * signed-out probe measured — plus an honest coverage cell for every kind neither of them fills.
 *
 * ## It makes no network call and presents no credential
 *
 * Both inventories are compiled: `generated/surfaces.ts` from Figma's own OpenAPI document, pinned by
 * digest, and `browserPages.ts` from a route probe whose result is committed. So this verb is a pure local
 * publish, which is what lets the atlas exist at all on an installation holding no Figma token.
 *
 * ## The sixteen empty kinds are the point, not an omission
 *
 * A kind with no entities and no coverage cell says nothing. A kind with a `not-configured` cell naming the
 * missing token says exactly what is true, and `kit/coverage.ts` does not count it as usable coverage — so
 * a reader cannot cite this atlas for a fact about a Figma file, and cannot mistake the emptiness for Figma
 * holding nothing. That distinction is `docs/atlas-intent/settled-decisions.md`'s "honest about where it thinks it's got
 * gaps" applied to the case where the gap is a credential one.
 *
 * ## Which gaps this run opens, and the one class it deliberately does not
 *
 * Five gaps come off the pinned document — the wholly deprecated `Projects` tag, the three OAuth endpoints
 * the document names and declares no path for, and the absence of any root enumerator for teams — and
 * sixteen come off the route inventory, one per route whose existence the probe could establish only down
 * to its gated prefix. Every one of the twenty-one is closable by something specific: a Figma release for the
 * first five, a signed-in walk for the rest.
 *
 * What this run deliberately does NOT open is a `browser-page-not-attempted` gap per route. Forty-one such
 * rows would restate, once per route, the single fact the `page` kind's own coverage cell already carries:
 * no page has been opened. A gap list is a deliverable (`docs/atlas-intent/settled-decisions.md`) and a gap list nobody can
 * read is not one.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { FIGMA_BROWSER_PAGES, figmaAbsentRoutes, figmaConfirmedRoutes } from "./browserPages.js";
import { figmaSurfaceLastSuccess, succeededFigmaCoverageCell } from "./coverage.js";
import { FIGMA_SPEC_CENSUS, FIGMA_SPEC_PIN } from "./generated/specLock.js";
import { FIGMA_SURFACES } from "./generated/surfaces.js";
import { FIGMA_ATLAS_KINDS, type FigmaAtlasKind } from "./kinds.js";
import { mergeFigmaChannel } from "./merge.js";
import {
  type FigmaAtlasEntity,
  type FigmaAtlasKindFile,
  type FigmaAtlasManifest,
  heldFigmaKindFile,
  heldFigmaManifest,
} from "./model.js";
import {
  FIGMA_ROUTE_SURFACE,
  FIGMA_SPEC_SURFACE,
  figmaFillableKinds,
  projectFigmaMethods,
  projectFigmaRoutes,
} from "./projection.js";
import { type FigmaAtlasPaths, publishFigmaAtlas, readFigmaAtlas, withFigmaPublishLock } from "./store.js";
import { methodGapsOnto, routeGapsOnto } from "./surfaceGaps.js";

/**
 * The surface name under which every unreachable entity kind reports why it is empty.
 * @internal
 */
export const FIGMA_ENTITY_SURFACE = "rest-entities";

/**
 * What would fill every entity kind, named once so eighteen cells cannot drift apart.
 * @internal
 */
export const FIGMA_ENTITY_UNBLOCK =
  "a Figma personal access token created at www.figma.com/settings with read scopes, stored with" +
  " `slopweaver secrets set figma-token`";

/**
 * What publishing the surface maps did.
 * @internal
 */
export interface FigmaSyncOutcome {
  readonly operationCount: number;
  readonly routeCount: number;
  readonly confirmedRouteCount: number;
  readonly absentRouteCount: number;
  readonly unreachableKindCount: number;
  readonly openGapCount: number;
  readonly written: readonly string[];
}

/**
 * Publish both compiled surface maps and the honest coverage for everything else.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason it could not be
 */
export function syncFigmaSurfaces({ paths, at }: { paths: FigmaAtlasPaths; at: string }): Result<FigmaSyncOutcome> {
  // The read and the write are one critical section: another publisher landing between them would have its
  // rows replaced by files derived from the generation this one read. See `withFigmaPublishLock`.
  return withFigmaPublishLock({ nowIso: at, paths, publish: () => publishSurfaces({ at, paths }) });
}

/** The critical section: read the generation, merge each channel onto it, and publish. */
function publishSurfaces({ paths, at }: { paths: FigmaAtlasPaths; at: string }): Result<FigmaSyncOutcome> {
  const snapshot = readFigmaAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const { files: stored, manifest } = snapshot.value;
  const methodFile = mergedFile({
    at,
    channel: "api",
    kind: "method",
    observed: projectFigmaMethods({ at }),
    stored: stored.method,
  });
  if (methodFile.isErr()) {
    return err(methodFile.error);
  }
  const pageFile = mergedFile({
    at,
    channel: "browser",
    kind: "page",
    observed: projectFigmaRoutes({ at }),
    stored: stored.page,
  });
  if (pageFile.isErr()) {
    return err(pageFile.error);
  }
  const gappedMethods = methodGapsOnto({ at, file: specCoverageOnto({ at, file: methodFile.value }) });
  if (gappedMethods.isErr()) {
    return err(gappedMethods.error);
  }
  const gappedPages = routeGapsOnto({ at, file: routeCoverageOnto({ at, file: pageFile.value }) });
  if (gappedPages.isErr()) {
    return err(gappedPages.error);
  }
  const unreachable = FIGMA_ATLAS_KINDS.filter((kind) => !figmaFillableKinds().includes(kind));
  const files: Partial<Record<FigmaAtlasKind, FigmaAtlasKindFile>> = {
    method: gappedMethods.value,
    page: gappedPages.value,
  };
  unreachable.forEach((kind) => {
    files[kind] = unreachableKindFile({ at, kind, stored: stored[kind] });
  });
  const next = syncManifest({ at, files, manifest });
  const published = publishFigmaAtlas({ derivedFrom: manifest, files, manifest: next, paths });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({
    absentRouteCount: figmaAbsentRoutes().length,
    confirmedRouteCount: figmaConfirmedRoutes().length,
    openGapCount: gappedMethods.value.gaps.length + gappedPages.value.gaps.length,
    operationCount: FIGMA_SURFACES.length,
    routeCount: FIGMA_BROWSER_PAGES.length,
    unreachableKindCount: unreachable.length,
    written: published.value,
  });
}

/** One kind's file with this run's channel merged onto whatever was stored. */
function mergedFile({
  kind,
  channel,
  observed,
  stored,
  at,
}: {
  kind: FigmaAtlasKind;
  channel: "api" | "browser";
  observed: readonly FigmaAtlasEntity[];
  stored: FigmaAtlasKindFile | null;
  at: string;
}): Result<FigmaAtlasKindFile> {
  const held = heldFigmaKindFile({ kind, stored, updatedAt: at });
  const merged = mergeFigmaChannel({ at, channel, observed, stored: held.entities });
  if (merged.isErr()) {
    return err(merged.error);
  }
  return ok({ ...held, entities: [...merged.value], updatedAt: at });
}

/** The method kind with the spec channel's own coverage cell replaced and nothing else touched. */
function specCoverageOnto({ file, at }: { file: FigmaAtlasKindFile; at: string }): FigmaAtlasKindFile {
  const reason =
    `${String(FIGMA_SPEC_CENSUS.operations)} operation(s) across ` +
    `${String(FIGMA_SPEC_CENSUS.paths)} path(s) in Figma's own OpenAPI ${FIGMA_SPEC_PIN.openapi} document, ` +
    `${FIGMA_SPEC_PIN.packageName}@${FIGMA_SPEC_PIN.packageVersion}, pinned at sha256 ` +
    `${FIGMA_SPEC_PIN.specSha256}. Compiled offline: no request was made to Figma and no credential was ` +
    "presented, so this cell claims the DECLARED surface was read in full and claims nothing about what " +
    "any token may call";
  return {
    ...file,
    coverage: [
      ...file.coverage.filter((cell) => cell.surface !== FIGMA_SPEC_SURFACE),
      succeededFigmaCoverageCell({
        artifacts: [],
        at,
        channel: "api",
        reason,
        role: "authoritative",
        scope: "declared-operations",
        state: "synced",
        surface: FIGMA_SPEC_SURFACE,
      }),
    ],
    updatedAt: at,
  };
}

/** The page kind with the route inventory's own coverage cell replaced. */
function routeCoverageOnto({ file, at }: { file: FigmaAtlasKindFile; at: string }): FigmaAtlasKindFile {
  const confirmed = figmaConfirmedRoutes().length;
  const absent = figmaAbsentRoutes().length;
  const reason =
    `${String(FIGMA_BROWSER_PAGES.length)} declared route(s): ${String(confirmed)} whose EXISTENCE an ` +
    `unauthenticated probe confirmed, ${String(absent)} it established are NOT there, and the rest ` +
    "confirmed only down to a gated prefix, because Figma's sign-in gate refuses before its router " +
    "resolves the leaf. Measured against a control that answers 404. This cell claims route existence and " +
    "nothing else: no page has been opened, photographed or read. `yarn tsx tools/probeFigmaRoutes.ts " +
    "--verify` reproduces every row";
  return {
    ...file,
    coverage: [
      ...file.coverage.filter((cell) => cell.surface !== FIGMA_ROUTE_SURFACE),
      succeededFigmaCoverageCell({
        artifacts: [],
        at,
        channel: "browser",
        reason,
        role: "discovery",
        scope: "declared-routes",
        state: "synced",
        surface: FIGMA_ROUTE_SURFACE,
      }),
    ],
    updatedAt: at,
  };
}

/**
 * An entity kind's file, saying why it is empty.
 *
 * The state is `not-configured` rather than `excluded`: this atlas fully intends to hold these kinds and
 * `descriptor.ts` says so. `unblockedBy` names the one thing that would change it, so a reader learns the
 * remedy from the atlas rather than from a person.
 */
function unreachableKindFile({
  kind,
  stored,
  at,
}: {
  kind: FigmaAtlasKind;
  stored: FigmaAtlasKindFile | null;
  at: string;
}): FigmaAtlasKindFile {
  const held = heldFigmaKindFile({ kind, stored, updatedAt: at });
  return {
    ...held,
    coverage: [
      ...held.coverage.filter((cell) => cell.surface !== FIGMA_ENTITY_SURFACE),
      {
        artifacts: [],
        channel: "api",
        lastSuccessAt: figmaSurfaceLastSuccess({ coverage: held.coverage, surface: FIGMA_ENTITY_SURFACE }),
        latestAttemptFailed: true,
        reason:
          `nothing has been fetched for "${kind}" because this installation holds no Figma credential — ` +
          "MEASURED: the secrets store under $SLOPWEAVER_HOME carries no `figma-token`, and no " +
          "Figma value is set in the environment. This is a fact about what this INSTALLATION has been " +
          "given, never about what Figma holds or about what the owner's own account can see",
        role: "authoritative",
        scope: "whole-account",
        state: "not-configured",
        surface: FIGMA_ENTITY_SURFACE,
        unblockedBy: FIGMA_ENTITY_UNBLOCK,
        visibilityScope: "api-token-scopes",
      },
    ],
    updatedAt: at,
  };
}

/** Stamp every published kind's status, leaving anything this run did not write exactly as it was. */
function syncManifest({
  manifest,
  files,
  at,
}: {
  manifest: FigmaAtlasManifest | null;
  files: Readonly<Partial<Record<FigmaAtlasKind, FigmaAtlasKindFile>>>;
  at: string;
}): FigmaAtlasManifest {
  const base = heldFigmaManifest({ manifest, updatedAt: at });
  const kinds = { ...base.kinds };
  FIGMA_ATLAS_KINDS.forEach((kind) => {
    const file = files[kind];
    if (file === undefined) {
      return;
    }
    kinds[kind] = {
      digest: null,
      entityCount: file.entities.length,
      lastAttempt: { at, outcome: "ok", reasons: [] },
      lastSuccessAt: at,
    };
  });
  return { ...base, kinds, updatedAt: at };
}
