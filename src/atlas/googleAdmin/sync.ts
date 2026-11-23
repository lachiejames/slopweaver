/**
 * Publish the Google Admin atlas's compiled generation — the one surface that needs no credential and no
 * network at all.
 *
 * ## Why a sync that calls nothing is still a sync
 *
 * `resyncCommand` is a first-class requirement of the descriptor contract: one command that brings the
 * whole atlas current. On this platform the compiled channel is the half that CAN be current today, so it
 * is what this publishes — 336 methods, one declared record shape per kind that has one, and, for every
 * kind, the coverage cells and gaps that say exactly what the other two channels have not done. Every
 * array it writes is sorted, so two runs given the same `at` produce byte-identical files.
 *
 * ## Every gap it raises is DERIVED from the registry, never listed here
 *
 * Which kinds hold a scopeless method, and which hold a write gated only by a `.readonly` scope, are
 * computed from `generated/surfaces.ts` on each run. A hand-kept list of either would be a list that stops
 * matching the table the day Google republishes, and the failure would be silent: the gap would still
 * read plausibly while naming the wrong methods.
 *
 * ## What it does NOT do, and the gate that makes that structural
 *
 * It never reaches the network, so it can never carry an audit event — but the guarantee does not rest on
 * that, because "this function happens not to make a request" is one refactor from being false.
 * `store.ts`'s publish gate refuses any generation carrying a stored record of a shape-indexed kind, at
 * the file boundary, whoever wrote it.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { stableEntityId } from "../kit/identity.js";
import type { GoogleAdminFillObservation } from "./adminApi/observation.js";
import { compiledGaps } from "./compiledGaps.js";
import type { GoogleAdminWalkObservation } from "./consoleRoute.js";
import { googleAdminDiscoveryCoverageCell } from "./coverage.js";
import { type GoogleAdminAtlasError, GoogleAdminAtlasErrors } from "./errors.js";
import { GOOGLE_ADMIN_RECORD_SHAPES, GOOGLE_ADMIN_SURFACES } from "./generated/surfaces.js";
import { googleAdminLiveCoverageCells } from "./liveCoverage.js";
import {
  byGoogleAdminKind,
  emptyGoogleAdminChannels,
  emptyGoogleAdminKindFile,
  GOOGLE_ADMIN_ATLAS_KINDS,
  GOOGLE_ADMIN_ATLAS_PLATFORM,
  type GoogleAdminAtlasEntity,
  type GoogleAdminAtlasKind,
  type GoogleAdminAtlasKindFile,
  type GoogleAdminAtlasManifest,
  initialGoogleAdminManifest,
} from "./model.js";
import { recordEntities } from "./recordEntities.js";
import {
  type GoogleAdminAtlasSnapshot,
  googleAdminAtlasPaths,
  publishGoogleAdminAtlas,
  readGoogleAdminAtlas,
} from "./store.js";
import { googleAdminProviderId } from "./surfaceNaming.js";

/**
 * Where the Admin console lives, so a stored deep link is built once rather than concatenated per page.
 *
 * A vendor origin rather than anything this organisation owns, so it carries no private identifier — the
 * console is the same address for every Workspace customer.
 */
const GOOGLE_ADMIN_CONSOLE_ORIGIN = "https://admin.google.com";

/** What one publish produced, so a verb can report it without re-reading the store. */
export interface GoogleAdminSyncReport {
  /** How many entities were written, per kind, in kind order. */
  readonly entitiesByKind: readonly { readonly kind: GoogleAdminAtlasKind; readonly entities: number }[];
  /** How many gaps the generation carries. */
  readonly gaps: number;
  /** Every file written, in write order — kind files first, manifest last. */
  readonly written: readonly string[];
}

/**
 * Every operation entity one kind holds — one per published method that reaches it.
 *
 * @param kind the kind to build
 * @param at this run's ISO timestamp
 * @returns the entities, in registry order
 */
function operationEntities({
  kind,
  at,
}: {
  kind: GoogleAdminAtlasKind;
  at: string;
}): readonly GoogleAdminAtlasEntity[] {
  return GOOGLE_ADMIN_SURFACES.filter((row) => row.kind === kind).map((row) => {
    const providerId = googleAdminProviderId({ document: row.document, id: row.id });
    return {
      channels: {
        ...emptyGoogleAdminChannels(),
        discovery: {
          detail: {
            api: row.api,
            baseUrl: row.baseUrl,
            description: row.description,
            disposition: row.disposition,
            dispositionBecause: row.dispositionBecause,
            document: row.document,
            exclusionReason: row.exclusionReason,
            id: row.id,
            method: row.method,
            paging: row.paging,
            parameters: [...row.parameters],
            parametersRequired: [...row.parametersRequired],
            path: row.path,
            requestSchema: row.requestSchema,
            responseFields: [...row.responseFields],
            responseSchema: row.responseSchema,
            scopes: [...row.scopes],
            supportsMediaUpload: row.supportsMediaUpload,
          },
          firstSeenAt: at,
          lastSeenAt: at,
          source: {
            artifacts: [],
            channel: "discovery",
            deepLink: null,
            deepLinkStatus: "unavailable",
            endpoint: `${row.method} ${row.baseUrl}${row.path}`,
            observedAt: at,
          },
          state: "observed",
        },
      },
      family: "operation",
      id: stableEntityId({ components: { providerId }, namespace: `${GOOGLE_ADMIN_ATLAS_PLATFORM}:${kind}` }),
      kind,
      providerId,
    };
  });
}

/**
 * The declared record shape one kind holds, if Google's documents name a schema for it.
 *
 * At most one per kind by construction — the generator picks each kind's least-parameterised readable
 * method and takes the schema its declared response names.
 *
 * @param kind the kind to build
 * @param at this run's ISO timestamp
 * @returns the shape entity, or nothing when Google names no schema for this kind
 */
function shapeEntities({ kind, at }: { kind: GoogleAdminAtlasKind; at: string }): readonly GoogleAdminAtlasEntity[] {
  return GOOGLE_ADMIN_RECORD_SHAPES.filter((shape) => shape.kind === kind).map((shape) => {
    const providerId = `shape:${shape.schemaName}`;
    return {
      channels: {
        ...emptyGoogleAdminChannels(),
        discovery: {
          detail: { fields: [...shape.fields], schemaName: shape.schemaName, sourceOperation: shape.sourceOperation },
          firstSeenAt: at,
          lastSeenAt: at,
          source: {
            artifacts: [],
            channel: "discovery",
            deepLink: null,
            deepLinkStatus: "unavailable",
            endpoint: shape.sourceOperation,
            observedAt: at,
          },
          state: "observed",
        },
      },
      family: "record-shape",
      id: stableEntityId({ components: { providerId }, namespace: `${GOOGLE_ADMIN_ATLAS_PLATFORM}:${kind}` }),
      kind,
      providerId,
    };
  });
}

/**
 * One `page` entity per route the walk SAW, with the `admin-console` channel filled only on the ones it
 * actually opened.
 *
 * Both halves matter and they are deliberately not the same set. A route the console linked is a page this
 * atlas can now say EXISTS, which is `docs/atlas-intent/05-browser-proof.md`'s floor — "we should at least know all the
 * pages that exist". A route it opened is a page it has looked at. An entity whose channel is null says
 * the first without claiming the second, which is the whole reason a channel is nullable.
 *
 * Every timestamp on a page entity is the WALK's own instant rather than this publish's, so republishing
 * the same observation does not make a stale walk look fresh.
 *
 * @param observation what the walk brought back
 * @returns the page entities, sorted by route so a re-run writes identical bytes
 */
function pageEntities({ observation }: { observation: GoogleAdminWalkObservation }): readonly GoogleAdminAtlasEntity[] {
  const opened = new Map(observation.pages.map((page) => [page.route, page]));
  const routes = [...new Set([...observation.observedRoutes, ...opened.keys()])].toSorted();
  return routes.map((route) => {
    const page = opened.get(route);
    return {
      channels: {
        ...emptyGoogleAdminChannels(),
        "admin-console":
          page === undefined || !page.reached
            ? null
            : {
                detail: {
                  route,
                  settledUrl: `${GOOGLE_ADMIN_CONSOLE_ORIGIN}${page.settledRoute}`,
                  title: page.title,
                },
                firstSeenAt: observation.walkedAtIso,
                lastSeenAt: observation.walkedAtIso,
                source: {
                  artifacts: [],
                  channel: "admin-console",
                  deepLink: `${GOOGLE_ADMIN_CONSOLE_ORIGIN}${route}`,
                  deepLinkStatus: "browser-discovered",
                  endpoint: route,
                  observedAt: observation.walkedAtIso,
                },
                state: "observed",
              },
      },
      family: "page",
      id: stableEntityId({ components: { providerId: route }, namespace: `${GOOGLE_ADMIN_ATLAS_PLATFORM}:page` }),
      kind: "page",
      providerId: route,
    };
  });
}

/**
 * Every entity the compiled channel contributes to one kind: its operations, then its record shape.
 *
 * @param kind the kind to build
 * @param at this run's ISO timestamp
 * @returns the entities, sorted by provider key so two runs at the same instant write identical bytes
 */
function compiledEntities({ kind, at }: { kind: GoogleAdminAtlasKind; at: string }): readonly GoogleAdminAtlasEntity[] {
  return [...operationEntities({ at, kind }), ...shapeEntities({ at, kind })].toSorted((left, right) =>
    left.providerId.localeCompare(right.providerId),
  );
}

/**
 * One kind's whole file: its three coverage cells, its entities and its gaps.
 *
 * The `page` kind is the only one that branches, and it branches on the same condition twice — a walk
 * fills its entities AND changes what its console cell says. Keeping both in one function is what makes
 * that pairing visible: an atlas that published walked pages under a `not-configured` cell, or an empty
 * page kind under a `deferred` one, would be lying in one direction or the other.
 *
 * @param kind the kind to build
 * @param at this run's ISO timestamp
 * @param observation what a console walk brought back, or `null` when none has run
 * @param stored this kind's file as the store holds it, whose live cells carry forward, or `null`
 * @returns the file
 */
function kindFile({
  kind,
  at,
  observation,
  fill,
  stored,
}: {
  kind: GoogleAdminAtlasKind;
  at: string;
  observation: GoogleAdminWalkObservation | null;
  fill: GoogleAdminFillObservation | null;
  stored: GoogleAdminAtlasKindFile | null;
}): GoogleAdminAtlasKindFile {
  // One narrowed binding rather than two conditions, so the type carries the branch: non-null here means
  // BOTH that this is the page kind and that a walk ran, which is exactly when the two arms below differ.
  const walk = kind === "page" ? observation : null;
  return {
    ...emptyGoogleAdminKindFile({ kind, updatedAt: at }),
    coverage: [
      googleAdminDiscoveryCoverageCell({
        at,
        kind,
        operations: GOOGLE_ADMIN_SURFACES.filter((row) => row.kind === kind).length,
      }),
      ...googleAdminLiveCoverageCells({ at, fill, kind, stored, walk }),
    ],
    entities:
      walk === null
        ? [...compiledEntities({ at, kind }), ...recordEntities({ at, fill, kind })]
        : [...pageEntities({ observation: walk })],
    gaps: [...compiledGaps({ at, fill, kind, observation })],
  };
}

/**
 * Build the whole compiled generation in memory.
 *
 * Separated from the write so the shape is testable without a filesystem — every judgement in this module
 * is pure, and the only I/O is the publish itself.
 *
 * @param at this run's ISO timestamp
 * @param observation what a console walk brought back, or `null` when none has run
 * @param stored every kind file the store already holds, whose live cells this generation carries forward
 *   rather than erases; omitted or `null` builds as if nothing had been published
 * @returns every kind file and the manifest, or why the registry cannot be trusted
 */
export function buildGoogleAdminGeneration({
  at,
  observation = null,
  fill = null,
  stored = null,
}: {
  at: string;
  observation?: GoogleAdminWalkObservation | null;
  fill?: GoogleAdminFillObservation | null;
  stored?: GoogleAdminAtlasSnapshot["files"] | null;
}): Result<
  {
    readonly files: Record<GoogleAdminAtlasKind, GoogleAdminAtlasKindFile>;
    readonly manifest: GoogleAdminAtlasManifest;
  },
  GoogleAdminAtlasError
> {
  const declared = new Set<string>(GOOGLE_ADMIN_ATLAS_KINDS);
  const stray = [...new Set(GOOGLE_ADMIN_SURFACES.map((row) => row.kind))].filter((kind) => !declared.has(kind));
  if (stray.length > 0) {
    return err(
      GoogleAdminAtlasErrors.registryInvalid({
        detail: `the registry names kind(s) the model does not declare: ${stray.toSorted().join(", ")}`,
      }),
    );
  }
  const files = byGoogleAdminKind({
    build: ({ kind }) => kindFile({ at, fill, kind, observation, stored: stored === null ? null : stored[kind] }),
  });
  return ok({
    files,
    manifest: {
      ...initialGoogleAdminManifest({ updatedAt: at }),
      kinds: byGoogleAdminKind({
        build: ({ kind }) => ({
          digest: null,
          entityCount: files[kind].entities.length,
          lastAttempt: null,
          lastSuccessAt: at,
        }),
      }),
    },
  });
}

/**
 * Build and publish the compiled generation.
 *
 * @param home the resolved `$SLOPWEAVER_HOME` to publish into
 * @param at this run's ISO timestamp
 * @param observation what a console walk brought back, or `null` to publish the compiled half alone
 * @returns what was written, or why publication was refused
 */
export function syncGoogleAdminAtlas({
  home,
  at,
  observation = null,
  fill = null,
}: {
  home: string;
  at: string;
  observation?: GoogleAdminWalkObservation | null;
  fill?: GoogleAdminFillObservation | null;
}): Result<GoogleAdminSyncReport, GoogleAdminAtlasError> {
  const paths = googleAdminAtlasPaths({ home });
  // A compiled generation is derived from the registry rather than from the store, so this read is the ONLY
  // thing that establishes what it is replacing. Without it the publish would have to assert `null`, which
  // the compare-and-swap reads as "the store held nothing" and refuses the moment anything has been
  // published — and asserting the live manifest without reading it would be the lost update itself. The
  // same read supplies each kind's stored live cells, so one channel's publish never erases the other's.
  const stored = readGoogleAdminAtlas({ paths });
  if (stored.isErr()) {
    return err(GoogleAdminAtlasErrors.publishRefused({ reasons: stored.error }));
  }
  const generation = buildGoogleAdminGeneration({ at, fill, observation, stored: stored.value.files });
  if (generation.isErr()) {
    return err(generation.error);
  }
  const { files, manifest } = generation.value;
  const written = publishGoogleAdminAtlas({ derivedFrom: stored.value.manifest, files, manifest, paths });
  if (written.isErr()) {
    return err(GoogleAdminAtlasErrors.publishRefused({ reasons: written.error }));
  }
  return ok({
    entitiesByKind: GOOGLE_ADMIN_ATLAS_KINDS.map((kind) => ({ entities: files[kind].entities.length, kind })),
    gaps: GOOGLE_ADMIN_ATLAS_KINDS.reduce((total, kind) => total + files[kind].gaps.length, 0),
    written: written.value,
  });
}
