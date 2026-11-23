/**
 * Publish both surface maps — every operation the pinned document declares, and every browser route the
 * signed-out probe measured — plus an honest coverage cell for every kind neither of them fills.
 *
 * ## It makes no network call and presents no credential
 *
 * Both inventories are compiled: `generated/surfaces.ts` from Airtable's own OpenAPI document, pinned by
 * digest, and `browserPages.ts` from a route probe whose result is committed. So this verb is a pure local
 * publish, exactly as `atlas notion sync` is from an installed package — which is what lets the atlas exist
 * at all on an installation with no Airtable membership.
 *
 * ## The seventeen empty kinds are the point, not an omission
 *
 * A kind with no entities and no coverage cell says nothing. A kind with a `not-configured` cell naming the
 * missing organisation invite says exactly what is true, and `kit/coverage.ts` does not count it as usable
 * coverage — so a reader cannot cite this atlas for a fact about a base, and cannot mistake the emptiness
 * for Airtable holding nothing. That distinction is `docs/atlas-intent/settled-decisions.md`'s "honest about where it thinks
 * it's got gaps" applied to the case where the gap is an access one.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { AIRTABLE_BROWSER_PAGES, airtableConfirmedRoutes } from "./browserPages.js";
import { airtableSurfaceLastSuccess, succeededAirtableCoverageCell } from "./coverage.js";
import { openAirtableGap, reconcileAirtableGaps } from "./gaps.js";
import { AIRTABLE_SPEC_CENSUS, AIRTABLE_SPEC_PIN, AIRTABLE_UNSERVED_TAGS } from "./generated/specLock.js";
import { AIRTABLE_SURFACES } from "./generated/surfaces.js";
import { AIRTABLE_ATLAS_KINDS, type AirtableAtlasKind } from "./kinds.js";
import { mergeAirtableChannel } from "./merge.js";
import {
  type AirtableAtlasEntity,
  type AirtableAtlasGap,
  type AirtableAtlasKindFile,
  type AirtableAtlasManifest,
  emptyAirtableKindFile,
  initialAirtableManifest,
} from "./model.js";
import {
  AIRTABLE_ROUTE_SURFACE,
  AIRTABLE_SPEC_SURFACE,
  airtableFillableKinds,
  projectAirtableMethods,
  projectAirtableRoutes,
} from "./projection.js";
import { type AirtableAtlasPaths, publishAirtableAtlas, readAirtableAtlas, withAirtablePublishLock } from "./store.js";

/**
 * The surface name under which every unreachable entity kind reports why it is empty.
 * @internal
 */
export const AIRTABLE_ENTITY_SURFACE = "rest-entities";

/**
 * What would fill every entity kind, named once so nineteen cells cannot drift apart.
 * @internal
 */
export const AIRTABLE_ENTITY_UNBLOCK =
  "an invite to the organisation's Airtable enterprise account, then a read-only personal access token" +
  " stored with `slopweaver secrets set airtable-token`";

/**
 * What publishing the surface maps did.
 * @internal
 */
export interface AirtableSyncOutcome {
  readonly operationCount: number;
  readonly routeCount: number;
  readonly confirmedRouteCount: number;
  readonly unreachableKindCount: number;
  readonly written: readonly string[];
}

/**
 * Publish both compiled surface maps and the honest coverage for everything else.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp
 * @returns what was published, or every reason it could not be
 */
export function syncAirtableSurfaces({
  paths,
  at,
}: {
  paths: AirtableAtlasPaths;
  at: string;
}): Result<AirtableSyncOutcome> {
  // The read and the write are one critical section: another publisher landing between them would have its
  // rows replaced by files derived from the generation this one read. See `withAirtablePublishLock`.
  return withAirtablePublishLock({ nowIso: at, paths, publish: () => publishSurfaces({ at, paths }) });
}

/** The critical section: read the generation, merge each channel onto it, and publish. */
function publishSurfaces({ paths, at }: { paths: AirtableAtlasPaths; at: string }): Result<AirtableSyncOutcome> {
  const snapshot = readAirtableAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const { files: stored, manifest } = snapshot.value;
  const methodFile = mergedFile({
    at,
    channel: "api",
    kind: "method",
    observed: projectAirtableMethods({ at }),
    stored: stored.method,
  });
  if (methodFile.isErr()) {
    return err(methodFile.error);
  }
  const pageFile = mergedFile({
    at,
    channel: "browser",
    kind: "page",
    observed: projectAirtableRoutes({ at }),
    stored: stored.page,
  });
  if (pageFile.isErr()) {
    return err(pageFile.error);
  }
  const withCoverage = specCoverageOnto({ at, file: methodFile.value });
  const gapped = methodGapsOnto({ at, file: withCoverage });
  if (gapped.isErr()) {
    return err(gapped.error);
  }
  const unreachable = AIRTABLE_ATLAS_KINDS.filter((kind) => !airtableFillableKinds().includes(kind));
  const files: Partial<Record<AirtableAtlasKind, AirtableAtlasKindFile>> = {
    method: gapped.value,
    page: routeCoverageOnto({ at, file: pageFile.value }),
  };
  unreachable.forEach((kind) => {
    files[kind] = unreachableKindFile({ at, kind, stored: stored[kind] });
  });
  const published = publishAirtableAtlas({
    derivedFrom: manifest,
    files,
    manifest: syncManifest({ at, files, manifest }),
    paths,
  });
  if (published.isErr()) {
    return err(published.error);
  }
  return ok({
    confirmedRouteCount: airtableConfirmedRoutes().length,
    operationCount: AIRTABLE_SURFACES.length,
    routeCount: AIRTABLE_BROWSER_PAGES.length,
    unreachableKindCount: unreachable.length,
    written: published.value,
  });
}

/** The kind file the store held, or an empty one stamped `at` when it held none. */
function heldKindFile({
  kind,
  stored,
  at,
}: {
  kind: AirtableAtlasKind;
  stored: AirtableAtlasKindFile | null;
  at: string;
}): AirtableAtlasKindFile {
  if (stored == null) {
    return emptyAirtableKindFile({ kind, updatedAt: at });
  }
  return stored;
}

/** One kind's file with this run's channel merged onto whatever was stored. */
function mergedFile({
  kind,
  channel,
  observed,
  stored,
  at,
}: {
  kind: AirtableAtlasKind;
  channel: "api" | "browser";
  observed: readonly AirtableAtlasEntity[];
  stored: AirtableAtlasKindFile | null;
  at: string;
}): Result<AirtableAtlasKindFile> {
  const held = heldKindFile({ at, kind, stored });
  const merged = mergeAirtableChannel({ at, channel, observed, stored: held.entities });
  if (merged.isErr()) {
    return err(merged.error);
  }
  return ok({ ...held, entities: [...merged.value], updatedAt: at });
}

/** The method kind with the spec channel's own coverage cell replaced and nothing else touched. */
function specCoverageOnto({ file, at }: { file: AirtableAtlasKindFile; at: string }): AirtableAtlasKindFile {
  const reason =
    `${String(AIRTABLE_SPEC_CENSUS.operations)} operation(s) across ` +
    `${String(AIRTABLE_SPEC_CENSUS.paths)} path(s) in Airtable's own OpenAPI ${AIRTABLE_SPEC_PIN.openapi} ` +
    `document, pinned at sha256 ${AIRTABLE_SPEC_PIN.sha256}. Compiled offline: no request was made to ` +
    "Airtable and no credential was presented, so this cell claims the DECLARED surface was read in full " +
    "and claims nothing about what any token may call";
  return {
    ...file,
    coverage: [
      ...file.coverage.filter((cell) => cell.surface !== AIRTABLE_SPEC_SURFACE),
      succeededAirtableCoverageCell({
        artifacts: [],
        at,
        channel: "api",
        reason,
        role: "authoritative",
        scope: "declared-operations",
        state: "synced",
        surface: AIRTABLE_SPEC_SURFACE,
      }),
    ],
    updatedAt: at,
  };
}

/** The page kind with the route inventory's own coverage cell replaced. */
function routeCoverageOnto({ file, at }: { file: AirtableAtlasKindFile; at: string }): AirtableAtlasKindFile {
  const confirmed = airtableConfirmedRoutes().length;
  const reason =
    `${String(AIRTABLE_BROWSER_PAGES.length)} declared route(s), of which ${String(confirmed)} have their ` +
    "EXISTENCE confirmed by an unauthenticated probe answering 302 to /login?continue=<route>, against a " +
    "control route that answers 404. This cell claims route existence and nothing else: no page has been " +
    "opened, photographed or read. `yarn tsx tools/probeAirtableRoutes.ts --verify` reproduces it";
  return {
    ...file,
    coverage: [
      ...file.coverage.filter((cell) => cell.surface !== AIRTABLE_ROUTE_SURFACE),
      succeededAirtableCoverageCell({
        artifacts: [],
        at,
        channel: "browser",
        reason,
        role: "discovery",
        scope: "declared-routes",
        state: "synced",
        surface: AIRTABLE_ROUTE_SURFACE,
      }),
    ],
    updatedAt: at,
  };
}

/**
 * The method kind's gaps: one per product surface Airtable's own document names and serves no operation for.
 *
 * Open by construction — nothing this atlas does can close it, and only Airtable publishing an endpoint
 * can. It is here because an atlas that cannot close a gap should still be the thing that says it is there.
 */
function methodGapsOnto({ file, at }: { file: AirtableAtlasKindFile; at: string }): Result<AirtableAtlasKindFile> {
  const observed: readonly AirtableAtlasGap[] = AIRTABLE_UNSERVED_TAGS.map((tag) =>
    openAirtableGap({
      at,
      condition: "provider-declares-tag-with-no-operation",
      fields: [],
      kind: "method",
      reason:
        `Airtable's own OpenAPI document declares the tag "${tag}" and publishes no operation under it, so ` +
        "no REST call reaches that surface at all. For `workflow` — Airtable's noun for automations — that " +
        "means a base's automations, their triggers and their enabled state are visible only in the " +
        "browser. This is why the `browser-walk` surface is mandatory rather than a nicety, and it cannot " +
        "be closed from here: only Airtable publishing an endpoint closes it",
      scope: `tag:${tag}`,
      surfaces: ["api"],
    }),
  );
  const reconciled = reconcileAirtableGaps({
    at,
    observed,
    rechecks: AIRTABLE_UNSERVED_TAGS.map((tag) => ({
      condition: "provider-declares-tag-with-no-operation",
      scope: `tag:${tag}`,
      resolved: false,
    })),
    runFailed: false,
    stored: file.gaps,
  });
  if (reconciled.isErr()) {
    return err(reconciled.error);
  }
  return ok({ ...file, gaps: [...reconciled.value] });
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
  kind: AirtableAtlasKind;
  stored: AirtableAtlasKindFile | null;
  at: string;
}): AirtableAtlasKindFile {
  const held = heldKindFile({ at, kind, stored });
  return {
    ...held,
    coverage: [
      ...held.coverage.filter((cell) => cell.surface !== AIRTABLE_ENTITY_SURFACE),
      {
        artifacts: [],
        channel: "api",
        lastSuccessAt: airtableSurfaceLastSuccess({ coverage: held.coverage, surface: AIRTABLE_ENTITY_SURFACE }),
        latestAttemptFailed: true,
        reason:
          `nothing has been fetched for "${kind}" because this installation holds no Airtable credential ` +
          "and only an account that is a member of the organisation's Airtable enterprise can create one — " +
          "for any other account airtable.com/create/tokens redirects to /login. " +
          "This is a fact about ACCESS, never about what Airtable holds",
        role: "authoritative",
        scope: "whole-enterprise",
        state: "not-configured",
        surface: AIRTABLE_ENTITY_SURFACE,
        unblockedBy: AIRTABLE_ENTITY_UNBLOCK,
        visibilityScope: "api-token-scopes",
      },
    ],
    updatedAt: at,
  };
}

/** The manifest the store held, or a fresh one stamped `at` when it held none. */
function heldManifest({ manifest, at }: { manifest: AirtableAtlasManifest | null; at: string }): AirtableAtlasManifest {
  if (manifest == null) {
    return initialAirtableManifest({ updatedAt: at });
  }
  return manifest;
}

/** Stamp every published kind's status, leaving anything this run did not write exactly as it was. */
function syncManifest({
  manifest,
  files,
  at,
}: {
  manifest: AirtableAtlasManifest | null;
  files: Readonly<Partial<Record<AirtableAtlasKind, AirtableAtlasKindFile>>>;
  at: string;
}): AirtableAtlasManifest {
  const base = heldManifest({ at, manifest });
  const kinds = { ...base.kinds };
  AIRTABLE_ATLAS_KINDS.forEach((kind) => {
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
