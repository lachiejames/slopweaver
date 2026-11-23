/**
 * What a Datadog generation looks like on disk: the entity, the kind file, the manifest, and the two
 * things this atlas stores that its siblings do not.
 *
 * ## Three channels, not two
 *
 * Vanta and Slack carry an API channel and a browser channel per entity. Datadog carries three, and the
 * third is not padding: the **compiled catalogue** is what the pinned SDK declares about an operation —
 * knowable with no credential, no network call and no browser — while the **API** channel is what this
 * organisation actually answered and the **console** channel is what the owner's own Chrome rendered. They
 * answer three different questions ("does Datadog have this", "does this org have this", "can the owner see
 * this"), and collapsing any two would lose the distinction an investigation needs most: an operation that
 * exists and returns nothing here is not the same as one that does not exist.
 *
 * A channel that has never looked is `null`, never an empty record. `kit/read.ts` refuses to let a null
 * channel contribute an observation, and that refusal is the whole two-surface design.
 *
 * ## The shape index is an entity, not a side file
 *
 * A `shape-index` operation publishes entities into its own kind exactly like any other, and the entity's
 * `detail` is a {@link datadogShapeIndexSchema} rather than a provider record. That keeps one reader and
 * one file format: `atlas datadog read --kind logs` returns what the atlas knows about logs, and whether
 * that is a stored index definition or an observed event SHAPE is a property of the row, not of where a
 * reader has to look.
 */
import { z } from "zod";

import { ATLAS_COVERAGE_STATES, ATLAS_EVIDENCE_ROLES, atlasSourceSchema } from "../kit/contract.js";

import { atlasPermissionBlockSchema } from "../kit/permissionBlock.js";
import { DATADOG_ATLAS_PLATFORM, DATADOG_KINDS } from "./model.js";

/**
 * The generation format this build writes.
 *
 * A bump SUPERSEDES rather than migrates — `kit/store.ts` refuses a foreign version and names
 * `atlas datadog reset` as the remedy. Version 2 added the two console kinds (`model.ts`); the manifest's
 * kind record is exhaustive, so a version-1 generation cannot carry them and is refused rather than read
 * as one that never walked.
 * @internal
 */
export const DATADOG_ATLAS_SCHEMA_VERSION = 2;

/**
 * The three independent views this atlas keeps of one thing.
 *
 * `compiled-catalogue` is deliberately first: it is the only one that needs nothing but this repository,
 * and it is what makes the atlas answer "is there any Datadog call that returns X" offline.
 * @internal
 */
export const DATADOG_CHANNELS = ["compiled-catalogue", "api", "console"] as const;

/**
 * One channel of the Datadog atlas.
 * @internal
 */
export type DatadogChannel = (typeof DATADOG_CHANNELS)[number];

const isoSchema = z.iso.datetime();

/**
 * What one operation's response shape looks like, without any of its values.
 *
 * The owner's ruling on voluminous telemetry, applied and then TIGHTENED for Datadog. Vanta's event-shape
 * index keeps three whole sample entries per kind, which is safe there because a compliance event is
 * organisation metadata. A Datadog log line, RUM event, span or LLM completion is customer content, so a
 * whole sample is exactly the thing that must not be stored. What is kept instead is structural: which
 * attribute paths exist, the JSON types seen at each, and how many entries were folded in.
 *
 * `distinctValues` is the one place a VALUE may appear, and only for an attribute on
 * {@link DATADOG_STRUCTURAL_FACETS} — a closed list of facets that name infrastructure rather than
 * describe an event. `service`, `env` and `status` answer "which services log at all", which is the
 * question the shape index exists to answer; a message, a URL, a query string or a user id never does.
 * @internal
 */
export const datadogShapeIndexSchema = z
  .object({
    /** Every attribute path found on an entry of this kind, with the JSON types seen at it. */
    attributes: z.array(z.object({ path: z.string().min(1), types: z.array(z.string()) }).strict()),
    /** Values, for structural facets only. Keyed by attribute path. */
    distinctValues: z.record(z.string(), z.array(z.string())),
    /** The earliest and latest entry instants this index was observed over. */
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    /** How many entries were folded in. Never how many exist — the window is bounded. */
    observedCount: z.number().int().nonnegative(),
    /** The bounded window the walk asked for, so a reader knows what the index is an index OF. */
    windowFrom: isoSchema,
    windowTo: isoSchema,
  })
  .strict();

/**
 * One operation's observed response shape.
 * @internal
 */
export type DatadogShapeIndex = z.infer<typeof datadogShapeIndexSchema>;

/**
 * Attribute paths whose VALUES may be stored in a shape index.
 *
 * Closed and short on purpose. Each names a piece of infrastructure the organisation configured — a
 * service, an environment, a log index — rather than describing an occurrence. Everything else is customer
 * content until somebody argues otherwise on this line.
 * @internal
 */
export const DATADOG_STRUCTURAL_FACETS: readonly string[] = [
  "/attributes/attributes/env",
  "/attributes/attributes/service",
  "/attributes/attributes/source",
  "/attributes/attributes/status",
  "/attributes/service",
  "/attributes/source",
  "/attributes/status",
  "/attributes/tags/datadog.index",
];

/**
 * What the console walk found at one page the left nav declares — the `detail` of a `console-page` entity's
 * `console` channel. The declaration itself (`consolePages.ts`) supplies `label`, `section`, `group` and
 * `posture`; the walk supplies the rest, and `outcome` is graded rather than inferred: a redirect is its
 * own answer, never a landing somewhere else.
 * @internal
 */
export const datadogConsolePageSchema = z
  .object({
    /** Where the browser settled, or `null` when the visit never completed. */
    finalUrl: z.string().min(1).nullable(),
    href: z.string().min(1),
    label: z.string().min(1),
    outcome: z.enum(["landed", "redirected", "not-found", "unavailable", "failed", "not-attempted"]),
    /** `compose` marks a page whose whole content is a form for creating something; nothing is submitted. */
    posture: z.enum(["read", "compose"]),
    /**
     * What the transport SAW against what it KEPT on this page, or absent on a row an older generation
     * wrote. OPTIONAL on purpose: a generation cut before this field existed measured nothing, and
     * defaulting it to zeroes would state a measurement nobody took. Absent means unmeasured, never clean.
     */
    responseAccounting: z
      .object({
        bodyFailed: z.number().int().nonnegative(),
        bodySucceeded: z.number().int().nonnegative(),
        eligible: z.number().int().nonnegative(),
        seen: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    section: z.string().min(1),
    statusCode: z.number().int().nullable(),
    title: z.string().nullable(),
  })
  .strict();

/**
 * One walked console page.
 * @internal
 */
export type DatadogConsolePage = z.infer<typeof datadogConsolePageSchema>;

/**
 * One first-party endpoint the console called while its pages rendered — the `detail` of a
 * `console-request` entity's `console` channel. Method, path SHAPE, parameter names and response field
 * paths: the reduction in `consoleReduction.ts` is the redaction, and no value survives it.
 * @internal
 */
export const datadogConsoleRequestSchema = z
  .object({
    method: z.string().min(1),
    /** Declared page hrefs this call was observed on. `cmd-k` names the command palette. */
    observedOnPages: z.array(z.string().min(1)),
    paramNames: z.array(z.string()),
    pathShape: z.string().min(1),
    /** A registry operation this call corroborates (`GET /api/v1/monitor`), or `null` when none matches. */
    registryOperation: z.string().min(1).nullable(),
    responseFieldPaths: z.array(z.string()),
    statusCodes: z.array(z.number().int()),
  })
  .strict();

/**
 * One observed console call.
 * @internal
 */
export type DatadogConsoleRequest = z.infer<typeof datadogConsoleRequestSchema>;

/** Where a record came from, when it was seen, and what proves it. The kit's own shape, unchanged. */
const datadogSourceSchema = atlasSourceSchema;

/**
 * One channel's independent view of one entity. A successful look replaces only this channel's detail.
 * @internal
 */
export const datadogChannelEntitySchema = z
  .object({
    channel: z.enum(DATADOG_CHANNELS),
    /** The provider's own JSON, a compiled catalogue record, or a {@link datadogShapeIndexSchema}. */
    detail: z.unknown().nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: datadogSourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

/**
 * One channel's view of one entity.
 * @internal
 */
export type DatadogChannelEntity = z.infer<typeof datadogChannelEntitySchema>;

/**
 * One tracked entity: a stable identity, plus whatever each channel independently knows about it.
 * @internal
 */
export const datadogEntitySchema = z
  .object({
    channels: z
      .object({
        api: datadogChannelEntitySchema.nullable(),
        "compiled-catalogue": datadogChannelEntitySchema.nullable(),
        console: datadogChannelEntitySchema.nullable(),
      })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(DATADOG_KINDS),
    providerId: z.string().min(1),
    /** The organisation and site this was read at, rendered as one string. */
    scope: z.string().min(1),
  })
  .strict();

/**
 * One entity as stored.
 * @internal
 */
export type DatadogEntity = z.infer<typeof datadogEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel.
 * @internal
 */
export const datadogCoverageCellSchema = z
  .object({
    channel: z.enum(DATADOG_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a non-`synced` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
  })
  .strict();

/**
 * One coverage cell as stored.
 * @internal
 */
export type DatadogCoverageCell = z.infer<typeof datadogCoverageCellSchema>;

/**
 * A gap, as stored — an open or closed question about what this atlas could not see.
 * @internal
 */
export const datadogGapSchema = z
  .object({
    channel: z.enum(DATADOG_CHANNELS).nullable(),
    condition: z.string().min(1),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(DATADOG_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
  })
  .strict();

/**
 * One gap as stored.
 * @internal
 */
export type DatadogGap = z.infer<typeof datadogGapSchema>;

/** One kind's file on disk. */
export const datadogKindFileSchema = z
  .object({
    coverage: z.array(datadogCoverageCellSchema),
    entities: z.array(datadogEntitySchema),
    gaps: z.array(datadogGapSchema),
    kind: z.enum(DATADOG_KINDS),
    platform: z.literal(DATADOG_ATLAS_PLATFORM),
    schemaVersion: z.literal(DATADOG_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

/**
 * One kind file as stored.
 * @internal
 */
export type DatadogKindFile = z.infer<typeof datadogKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const datadogKindStatusSchema = z
  .object({
    /** A digest of the bytes published, so a later half-write is detectable rather than silent. */
    digest: z.string().min(1).nullable(),
    entityCount: z.number().int().nonnegative(),
    lastAttempt: z
      .object({ at: isoSchema, outcome: z.enum(["ok", "failed"]), reasons: z.array(z.string()) })
      .strict()
      .nullable(),
    lastSuccessAt: isoSchema.nullable(),
    // Absent on a manifest written before the field existed, so nullish rather than required — see
    // `atlasPermissionBlockSchema` in the kit for why the field exists at all.
    permissionBlocked: atlasPermissionBlockSchema.nullish(),
  })
  .strict();

/**
 * One kind's publication history.
 * @internal
 */
export type DatadogKindStatus = z.infer<typeof datadogKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const datadogManifestSchema = z
  .object({
    kinds: z.record(z.enum(DATADOG_KINDS), datadogKindStatusSchema),
    platform: z.literal(DATADOG_ATLAS_PLATFORM),
    schemaVersion: z.literal(DATADOG_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

/**
 * The manifest as stored.
 * @internal
 */
export type DatadogManifest = z.infer<typeof datadogManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * Every kind is present from the first generation rather than appearing when it first succeeds, because a
 * kind missing from the manifest reads as a kind that does not exist — the same silence the declared-but-
 * unfilled surface state exists to prevent.
 *
 * @param updatedAt the ISO instant to stamp
 * @returns a manifest whose every kind has never been attempted
 * @internal
 */
export function emptyDatadogManifest({ updatedAt }: { updatedAt: string }): DatadogManifest {
  const kinds: Record<string, DatadogKindStatus> = {};
  for (const kind of DATADOG_KINDS) {
    kinds[kind] = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  }
  return {
    kinds,
    platform: DATADOG_ATLAS_PLATFORM,
    schemaVersion: DATADOG_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}
