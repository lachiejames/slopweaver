/**
 * Publish the Nightfall atlas's compiled generation — the one surface that needs no credential and no
 * network at all.
 *
 * ## Why a sync that calls nothing is still a sync
 *
 * `resyncCommand` is a first-class requirement of the descriptor contract: one command that brings the
 * whole atlas current. On this platform the compiled channel is the half that CAN be current today, so it
 * is what this publishes — 56 operations, 18 declared record shapes, and, for every kind, the coverage
 * cells and gaps that say exactly what the other two channels have not done. Every array it writes is
 * sorted, so two runs given the same `at` produce byte-identical files — the timestamp is the only thing
 * that moves between runs, which is what makes a real diff over a regenerated atlas readable.
 *
 * The alternative — landing the module with nothing on disk, the way the Datadog atlas did — was rejected
 * here for a reason specific to this platform. Datadog's compiled table is one of three surfaces over data
 * a credential would fetch anyway. Nightfall's compiled table is the ONLY thing this installation can hold,
 * so publishing nothing would leave `slopweaver atlas nightfall read` answering "nothing has been
 * published" on an atlas whose entire deliverable is already computable.
 *
 * ## What it does NOT do, and the gate that makes that structural
 *
 * It never reaches the network, so it can never carry a detection — but the guarantee does not rest on
 * that, because "this function happens not to make a request" is one refactor from being false.
 * `store.ts`'s publish gate refuses any generation carrying a stored record of a shape-indexed kind, at
 * the file boundary, whoever wrote it.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { stableEntityId } from "../kit/identity.js";
import { nightfallPublishedCoverageCell, nightfallUnconfiguredCoverageCell } from "./coverage.js";
import { type NightfallAtlasError, NightfallAtlasErrors } from "./errors.js";
import {
  nightfallNoConsoleSessionGap,
  nightfallNoCredentialGap,
  nightfallUndocumentedConsoleGap,
  nightfallUnenumerableKindGap,
  nightfallUnresolvableReferenceGap,
} from "./gaps.js";
import { NIGHTFALL_RECORD_SHAPES, NIGHTFALL_SURFACES } from "./generated/surfaces.js";
import {
  byNightfallKind,
  emptyNightfallChannels,
  emptyNightfallKindFile,
  initialNightfallManifest,
  NIGHTFALL_ATLAS_KINDS,
  NIGHTFALL_ATLAS_PLATFORM,
  type NightfallAtlasEntity,
  type NightfallAtlasGap,
  type NightfallAtlasKind,
  type NightfallAtlasKindFile,
  type NightfallAtlasManifest,
} from "./model.js";
import { nightfallAtlasPaths, publishNightfallAtlas, readNightfallManifest } from "./store.js";
import { nightfallProviderId } from "./surfaceNaming.js";

/**
 * The vendor's own help-centre product areas that no published document declares an operation for.
 *
 * MEASURED by taking every section of `help.nightfall.ai`'s own sitemap index and removing the
 * ones the six OpenAPI documents cover. Reproduce the section list with:
 *
 * ```bash
 * curl -sSL https://help.nightfall.ai/sitemap.xml | grep -o '<loc>[^<]*</loc>'
 * ```
 *
 * These are DOCUMENTED areas, never visited routes — `gaps.ts` says why that distinction is load-bearing.
 */
const UNDOCUMENTED_CONSOLE_AREAS: readonly string[] = [
  "audit",
  "data-encryption",
  "data-security-posture-management",
  "detection_platform",
  "nightfall_alert_platform",
  "nightfall_compliance",
  "nightfall_policy_templates",
  "nightfall_settings",
];

/** Which kinds carry an identifier no published operation resolves, and the fields that carry it. */
const UNRESOLVABLE_REFERENCES: Readonly<Partial<Record<NightfallAtlasKind, readonly string[]>>> = {
  "exfiltration-event": ["policyUUIDs"],
  finding: ["detectorUUID", "subDetectorUUID"],
  "posture-event": ["policyUUIDs"],
  violation: ["detectionRuleUUIDs", "detectorUUIDs", "policyUUIDs"],
};

/** What one publish produced, so a verb can report it without re-reading the store. */
export interface NightfallSyncReport {
  /** How many entities were written, per kind, in kind order. */
  readonly entitiesByKind: readonly { readonly kind: NightfallAtlasKind; readonly entities: number }[];
  /** How many gaps the generation carries. */
  readonly gaps: number;
  /** Every file written, in write order — kind files first, manifest last. */
  readonly written: readonly string[];
}

/**
 * Every operation entity one kind holds — one per published operation that reaches it.
 *
 * @param kind the kind to build
 * @param at this run's ISO timestamp
 * @returns the entities, in registry order
 */
function operationEntities({ kind, at }: { kind: NightfallAtlasKind; at: string }): readonly NightfallAtlasEntity[] {
  return NIGHTFALL_SURFACES.filter((row) => row.kind === kind).map((row) => {
    const providerId = nightfallProviderId({ method: row.method, path: row.path, server: row.server });
    return {
      channels: {
        ...emptyNightfallChannels(),
        "published-api": {
          detail: {
            api: row.api,
            bodyParams: [...row.bodyParams],
            deprecated: row.deprecated,
            disposition: row.disposition,
            dispositionBecause: row.dispositionBecause,
            exclusionReason: row.exclusionReason,
            headerParams: [...row.headerParams],
            method: row.method,
            operationId: row.operationId,
            paging: row.paging,
            path: row.path,
            pathParams: [...row.pathParams],
            queryParams: [...row.queryParams],
            responseFields: [...row.responseFields],
            security: [...row.security],
            server: row.server,
            specDocument: row.specDocument,
            summary: row.summary,
          },
          firstSeenAt: at,
          lastSeenAt: at,
          source: {
            artifacts: [],
            channel: "published-api",
            deepLink: null,
            deepLinkStatus: "unavailable",
            endpoint: providerId,
            observedAt: at,
          },
          state: "observed",
        },
      },
      family: "operation",
      id: stableEntityId({ components: { providerId }, namespace: `${NIGHTFALL_ATLAS_PLATFORM}:${kind}` }),
      kind,
      providerId,
    };
  });
}

/**
 * The declared record shape one kind holds, if the vendor's documents name one for it.
 *
 * At most one per kind by construction — the generator picks each kind's least-parameterised readable
 * operation and takes the single component its declared response names.
 *
 * @param kind the kind to build
 * @param at this run's ISO timestamp
 * @returns the shape entity, or nothing when the vendor names no component for this kind
 */
function shapeEntities({ kind, at }: { kind: NightfallAtlasKind; at: string }): readonly NightfallAtlasEntity[] {
  return NIGHTFALL_RECORD_SHAPES.filter((shape) => shape.kind === kind).map((shape) => {
    const providerId = `shape:${shape.schemaName}`;
    return {
      channels: {
        ...emptyNightfallChannels(),
        "published-api": {
          detail: { fields: [...shape.fields], schemaName: shape.schemaName, sourceOperation: shape.sourceOperation },
          firstSeenAt: at,
          lastSeenAt: at,
          source: {
            artifacts: [],
            channel: "published-api",
            deepLink: null,
            deepLinkStatus: "unavailable",
            endpoint: shape.sourceOperation,
            observedAt: at,
          },
          state: "observed",
        },
      },
      family: "record-shape",
      id: stableEntityId({ components: { providerId }, namespace: `${NIGHTFALL_ATLAS_PLATFORM}:${kind}` }),
      kind,
      providerId,
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
function compiledEntities({ kind, at }: { kind: NightfallAtlasKind; at: string }): readonly NightfallAtlasEntity[] {
  return [...operationEntities({ at, kind }), ...shapeEntities({ at, kind })].toSorted((left, right) =>
    left.providerId.localeCompare(right.providerId),
  );
}

/**
 * Every gap one kind carries in the compiled generation.
 *
 * @param kind the kind to build gaps for
 * @param at this run's ISO timestamp
 * @returns the gaps, sorted by id so a re-run writes identical bytes
 */
function compiledGaps({ kind, at }: { kind: NightfallAtlasKind; at: string }): readonly NightfallAtlasGap[] {
  const gaps: NightfallAtlasGap[] = [nightfallNoCredentialGap({ at, kind })];
  if (kind === "page") {
    gaps.push(nightfallNoConsoleSessionGap({ at }));
    gaps.push(nightfallUndocumentedConsoleGap({ areas: UNDOCUMENTED_CONSOLE_AREAS, at }));
  }
  if (kind === "annotation") {
    gaps.push(nightfallUnenumerableKindGap({ at, kind, via: "dlp-get-annotations-by-annotation-id" }));
  }
  const references = UNRESOLVABLE_REFERENCES[kind];
  if (references !== undefined) {
    gaps.push(nightfallUnresolvableReferenceGap({ at, kind, references }));
  }
  return gaps.toSorted((left, right) => left.id.localeCompare(right.id));
}

/**
 * Build the whole compiled generation in memory.
 *
 * Separated from the write so the shape is testable without a filesystem — every judgement in this module
 * is pure, and the only I/O is the publish itself.
 *
 * @param at this run's ISO timestamp
 * @returns every kind file and the manifest, or why the registry cannot be trusted
 */
export function buildNightfallGeneration({ at }: { at: string }): Result<
  {
    readonly files: Record<NightfallAtlasKind, NightfallAtlasKindFile>;
    readonly manifest: NightfallAtlasManifest;
  },
  NightfallAtlasError
> {
  const declared = new Set<string>(NIGHTFALL_ATLAS_KINDS);
  const stray = [...new Set(NIGHTFALL_SURFACES.map((row) => row.kind))].filter((kind) => !declared.has(kind));
  if (stray.length > 0) {
    return err(
      NightfallAtlasErrors.registryInvalid({
        detail: `the registry names kind(s) the model does not declare: ${stray.toSorted().join(", ")}`,
      }),
    );
  }
  const files = byNightfallKind({
    build: ({ kind }) => ({
      ...emptyNightfallKindFile({ kind, updatedAt: at }),
      coverage: [
        nightfallPublishedCoverageCell({
          at,
          kind,
          operations: NIGHTFALL_SURFACES.filter((row) => row.kind === kind).length,
        }),
        nightfallUnconfiguredCoverageCell({ at, channel: "workflow-api", kind, previous: null }),
        nightfallUnconfiguredCoverageCell({ at, channel: "console", kind, previous: null }),
      ],
      entities: [...compiledEntities({ at, kind })],
      gaps: [...compiledGaps({ at, kind })],
    }),
  });
  return ok({
    files,
    manifest: {
      ...initialNightfallManifest({ updatedAt: at }),
      kinds: byNightfallKind({
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
 * @returns what was written, or why publication was refused
 */
export function syncNightfallAtlas({
  home,
  at,
}: {
  home: string;
  at: string;
}): Result<NightfallSyncReport, NightfallAtlasError> {
  const generation = buildNightfallGeneration({ at });
  if (generation.isErr()) {
    return err(generation.error);
  }
  const { files, manifest } = generation.value;
  const paths = nightfallAtlasPaths({ home });
  // A compiled generation is derived from the registry rather than from the store, so this read is the ONLY
  // thing that establishes what it is replacing. Without it the publish would have to assert `null`, which
  // the compare-and-swap reads as "the store held nothing" and refuses the moment anything has been
  // published — and asserting the live manifest without reading it would be the lost update itself.
  const derivedFrom = readNightfallManifest({ paths });
  if (derivedFrom.isErr()) {
    return err(NightfallAtlasErrors.publishRefused({ reasons: derivedFrom.error }));
  }
  const written = publishNightfallAtlas({ derivedFrom: derivedFrom.value, files, manifest, paths });
  if (written.isErr()) {
    return err(NightfallAtlasErrors.publishRefused({ reasons: written.error }));
  }
  return ok({
    entitiesByKind: NIGHTFALL_ATLAS_KINDS.map((kind) => ({ entities: files[kind].entities.length, kind })),
    gaps: NIGHTFALL_ATLAS_KINDS.reduce((total, kind) => total + files[kind].gaps.length, 0),
    written: written.value,
  });
}
