/**
 * The Hex API channel's next generation, folded: the two compiled kind files merged onto what the store
 * already holds, the cells for the three kinds no token or walk has filled, and the manifest stamping every
 * kind this run wrote. Pure — `syncCatalogue.ts` compiles the evidence this folds, and `syncPublish.ts` reads
 * the store, takes the lock and publishes what this builds.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { succeededHexCoverageCell } from "./coverage.js";
import { openHexGap } from "./gaps.js";
import { HEX_SPEC_PINS } from "./generated/specLock.js";
import { mergeHexChannel } from "./merge.js";
import {
  emptyHexKindFile,
  HEX_ENTITY_UNBLOCKED_BY,
  type HexAtlasEntity,
  type HexAtlasKind,
  type HexAtlasKindFile,
  type HexAtlasKindStatus,
  type HexAtlasManifest,
  initialHexManifest,
} from "./model.js";
import {
  projectHexApis,
  projectHexGraphqlMethods,
  projectHexProbeMethods,
  projectHexSpecMethods,
} from "./projection.js";
import type { HexAtlasSnapshot } from "./store.js";
import {
  type CompiledCatalogue,
  catalogueGaps,
  compileCell,
  dispositionCount,
  withholdingGap,
} from "./syncCatalogue.js";

/**
 * The surface name the published document's coverage is reported under.
 *
 * @internal
 */
export const HEX_SPEC_SURFACE = "spec-declared";

/**
 * The surface name the unauthenticated noun census is reported under.
 *
 * @internal
 */
export const HEX_PROBE_SURFACE = "unauthenticated-probe";

/**
 * The surface name the shipped client's compiled router and operation names are reported under.
 *
 * @internal
 */
export const HEX_CLIENT_BUNDLE_SURFACE = "client-bundle";

/**
 * The surface name the credentialled workspace reads would be reported under.
 *
 * @internal
 */
export const HEX_WORKSPACE_API_SURFACE = "workspace-api";

/**
 * The surface name the browser walk's coverage is reported under.
 *
 * @internal
 */
export const HEX_WEB_APP_SURFACE = "web-app";

/**
 * What a caller must do to fill the browser surface, when a walk finds the session gone.
 *
 * Names a SIGN-IN rather than a credential, because that is what a lost session costs and typing
 * credentials is something a session may never do.
 *
 * @internal
 */
export const HEX_BROWSER_UNBLOCKED_BY =
  "sign in to app.hex.tech once in your own Chrome, then run `slopweaver atlas hex walk`, which drives the " +
  "compiled static routes in that same browser through the shared Playwright extension transport";

/** One compiled kind's file: this run's entities merged onto the stored ones, with its own cell replaced. */
function mergedKindFile({
  snapshotFiles,
  kind,
  entities,
  catalogue,
  at,
}: {
  snapshotFiles: Readonly<Record<HexAtlasKind, HexAtlasKindFile | null>>;
  kind: HexAtlasKind;
  entities: readonly HexAtlasEntity[];
  catalogue: CompiledCatalogue;
  at: string;
}): Result<HexAtlasKindFile> {
  const stored = snapshotFiles[kind] ?? emptyHexKindFile({ kind, updatedAt: at });
  const merged = mergeHexChannel({ at, channel: "api", observed: entities, stored: stored.entities });
  if (merged.isErr()) {
    return err(merged.error);
  }
  const cell = compileCell({ catalogue });
  return ok({
    ...stored,
    coverage: [
      ...stored.coverage.filter((held) => held.surface !== HEX_SPEC_SURFACE),
      succeededHexCoverageCell({
        artifacts: [],
        at,
        channel: "api",
        reason: cell.reason,
        role: "authoritative",
        scope: "anonymous-published-evidence",
        state: cell.state,
        surface: HEX_SPEC_SURFACE,
      }),
    ],
    entities: [...merged.value],
    gaps: [
      ...stored.gaps.filter((held) => held.condition !== "spec-unreadable" && held.condition !== "spec-moved"),
      ...catalogueGaps({ at, catalogue, kind }),
    ],
    updatedAt: at,
  });
}

/**
 * The two compiled kind files, or the first reason one of them could not be built.
 *
 * @returns the `api` and `method` kind files, or the first reason one of them could not be built
 */
export function compiledFiles({
  snapshot,
  catalogue,
  at,
}: {
  snapshot: HexAtlasSnapshot;
  catalogue: CompiledCatalogue;
  at: string;
}): Result<{ api: HexAtlasKindFile; method: HexAtlasKindFile }> {
  const reachedIds = new Set(catalogue.surfaces.map((surface) => surface.specId));
  const apiFile = mergedKindFile({
    at,
    catalogue,
    entities: projectHexApis({ at, pins: HEX_SPEC_PINS.filter((pin) => reachedIds.has(pin.id)) }),
    kind: "api",
    snapshotFiles: snapshot.files,
  });
  if (apiFile.isErr()) {
    return err(apiFile.error);
  }
  const methodFile = mergedKindFile({
    at,
    catalogue,
    entities: [
      ...projectHexSpecMethods({ at, pins: HEX_SPEC_PINS, surfaces: catalogue.surfaces }),
      ...projectHexProbeMethods({ at }),
      ...projectHexGraphqlMethods({ at }),
    ],
    kind: "method",
    snapshotFiles: snapshot.files,
  });
  if (methodFile.isErr()) {
    return err(methodFile.error);
  }
  const withheld = dispositionCount({ disposition: "withheld", file: methodFile.value });
  return ok({
    api: apiFile.value,
    method: {
      ...methodFile.value,
      gaps: [
        ...methodFile.value.gaps.filter((held) => held.condition !== "result-data-withheld"),
        withholdingGap({ at, withheld }),
      ],
    },
  });
}

/**
 * The file for an entity kind nothing has filled: a `not-configured` cell naming exactly what would fill it.
 *
 * The alternative was to leave these kinds absent, and it is the wrong one for the reason `kit/contract.ts`
 * gives about `declared-unfilled`: a kind with no file reads as a kind that does not exist, where a
 * `not-configured` cell is the atlas saying, about itself, that it is supposed to hold this and does not.
 */
function entitySurfaceFile({
  stored,
  kind,
  scope,
  at,
}: {
  stored: HexAtlasKindFile | null;
  kind: HexAtlasKind;
  scope: string;
  at: string;
}): HexAtlasKindFile {
  const base = stored ?? emptyHexKindFile({ kind, updatedAt: at });
  return {
    ...base,
    coverage: [
      ...base.coverage.filter((held) => held.surface !== HEX_WORKSPACE_API_SURFACE),
      {
        artifacts: [],
        channel: "api",
        lastSuccessAt: base.coverage.find((held) => held.surface === HEX_WORKSPACE_API_SURFACE)?.lastSuccessAt ?? null,
        latestAttemptFailed: false,
        reason:
          "no Hex API token exists in this installation, so nothing has been read from the workspace itself. " +
          "This is the kind this atlas declares and does not hold — nothing else here holds a Hex project or " +
          "collection — so the absence is a stated gap rather than a scoping decision. What it is NOT is the " +
          "withholding: filling this kind would add what exists, and would still hold no result set",
        role: "authoritative",
        scope,
        state: "not-configured",
        surface: HEX_WORKSPACE_API_SURFACE,
        unblockedBy: HEX_ENTITY_UNBLOCKED_BY,
        visibilityScope: "api-anonymous-published",
      },
    ],
    gaps: [
      ...base.gaps.filter((held) => held.condition !== "entity-surface-not-configured"),
      openHexGap({
        at,
        condition: "entity-surface-not-configured",
        fields: [],
        kind,
        reason: `this atlas holds no ${scope} because no token reaches the workspace. ${HEX_ENTITY_UNBLOCKED_BY}`,
        scope,
        surfaces: ["api"],
      }),
    ],
    updatedAt: at,
  };
}

/**
 * The `page` kind's file when no walk has run: a `deferred` cell saying so, and nothing else touched.
 *
 * A kind with no cell at all is the silence this whole vocabulary exists to refuse — a reader cannot tell
 * "the walk has not run" from "the walk ran and found nothing". A real walk REPLACES this cell with what it
 * actually reached.
 *
 * @param stored the page kind as the store already holds it
 * @param at this run's ISO timestamp
 * @returns the page kind file with the walk's cell present when it has never been filled
 */
function browserSurfaceFile({ stored, at }: { stored: HexAtlasKindFile | null; at: string }): HexAtlasKindFile {
  const base = stored ?? emptyHexKindFile({ kind: "page", updatedAt: at });
  if (base.coverage.some((cell) => cell.surface === HEX_WEB_APP_SURFACE)) {
    return base;
  }
  return {
    ...base,
    coverage: [
      ...base.coverage,
      {
        artifacts: [],
        channel: "browser",
        lastSuccessAt: null,
        latestAttemptFailed: false,
        reason:
          "no app page has been visited or witnessed. The routes in `browserPages.ts` are compiled out of " +
          "the client's own router, which is what a walk will be judged against — a declared page never " +
          "reached is a gap this atlas can name, where a page a crawler never noticed is not",
        role: "authoritative",
        scope: "declared-app-pages",
        state: "deferred",
        surface: HEX_WEB_APP_SURFACE,
        unblockedBy: HEX_BROWSER_UNBLOCKED_BY,
        visibilityScope: "browser-signed-in-role",
      },
    ],
    updatedAt: at,
  };
}

/**
 * Every kind file this sync publishes: the two it compiled, and the three it can only say something about.
 *
 * @param compiled the two kinds this run built from the evidence
 * @param stored every kind as the store already holds it
 * @param at this run's ISO timestamp
 * @returns the files to publish, keyed by kind
 */
export function syncedFiles({
  compiled,
  stored,
  at,
}: {
  compiled: { api: HexAtlasKindFile; method: HexAtlasKindFile };
  stored: Readonly<Record<HexAtlasKind, HexAtlasKindFile | null>>;
  at: string;
}): Readonly<Partial<Record<HexAtlasKind, HexAtlasKindFile>>> {
  return {
    api: compiled.api,
    method: compiled.method,
    page: browserSurfaceFile({ at, stored: stored.page }),
    project: entitySurfaceFile({ at, kind: "project", scope: "workspace-projects", stored: stored.project }),
    resource: entitySurfaceFile({
      at,
      kind: "resource",
      scope: "workspace-collections-connections-and-members",
      stored: stored.resource,
    }),
  };
}

/**
 * The manifest status for a kind this run wrote a coverage cell for and no entities.
 *
 * A prior success is carried forward rather than erased — a token appearing and then being revoked must not
 * make an earlier successful read disappear, only stop being current.
 *
 * @param previous the status the manifest already held — every kind is a required manifest key, and a fresh
 *   manifest holds each one as never synced
 * @param why what would fill this kind, recorded on the attempt so a reader of the manifest alone sees it
 * @param at this run's ISO timestamp
 * @returns the stamped status
 */
function unfilledKindStatus({
  previous,
  why,
  at,
}: {
  previous: HexAtlasKindStatus;
  why: string;
  at: string;
}): HexAtlasKindStatus {
  return {
    digest: null,
    entityCount: previous.entityCount,
    lastAttempt: { at, outcome: "ok", reasons: [why] },
    lastSuccessAt: previous.lastSuccessAt,
  };
}

/**
 * Stamp every kind this run wrote, so none of them reads as a file the manifest does not vouch for.
 *
 * The two compiled kinds record a success. The three a token or a walk would fill record an ATTEMPT with no
 * success, which with `store.ts`'s `gradeNeverSucceeded` is the manifest and the file agreeing on "not yet
 * synced" — where leaving them unstamped reported them as `unpublished`, i.e. corruption, on the very first
 * clean sync.
 *
 * @returns the manifest with every kind this run wrote stamped
 */
export function syncManifest({
  manifest,
  apiCount,
  methodCount,
  at,
}: {
  manifest: HexAtlasManifest | null;
  apiCount: number;
  methodCount: number;
  at: string;
}): HexAtlasManifest {
  const base = manifest ?? initialHexManifest({ updatedAt: at });
  return {
    ...base,
    kinds: {
      ...base.kinds,
      api: { digest: null, entityCount: apiCount, lastAttempt: { at, outcome: "ok", reasons: [] }, lastSuccessAt: at },
      method: {
        digest: null,
        entityCount: methodCount,
        lastAttempt: { at, outcome: "ok", reasons: [] },
        lastSuccessAt: at,
      },
      page: unfilledKindStatus({ at, previous: base.kinds.page, why: HEX_BROWSER_UNBLOCKED_BY }),
      project: unfilledKindStatus({ at, previous: base.kinds.project, why: HEX_ENTITY_UNBLOCKED_BY }),
      resource: unfilledKindStatus({ at, previous: base.kinds.resource, why: HEX_ENTITY_UNBLOCKED_BY }),
    },
    updatedAt: at,
  };
}
