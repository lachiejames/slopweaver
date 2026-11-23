/**
 * The strict on-disk shape of every CrowdStrike entity, and the manifest that grades a generation.
 *
 * ## Strict, so a provider field nobody reviewed cannot arrive by accident
 *
 * Every schema here is `.strict()`. A field CrowdStrike adds next month is not stored because a projection
 * chose it, and it is not stored because nobody excluded it — it fails to parse, loudly, and somebody
 * decides. That is the second of the three boundaries: `inventory.ts` closes which calls may be made,
 * `privacy.ts` names which fields are admitted, and this file refuses anything that got past both.
 *
 * ## Every entity carries where it came from, and whether it was seen this run
 *
 * `source` is the kit's own `AtlasSource`, so each record says which surface produced it, at which endpoint,
 * when, and what a human would open to see it. A record without provenance is not an atlas record. `state`
 * is the other half: an entity a complete read no longer returned is marked `stale` rather than deleted,
 * because a machine that stopped appearing is a fact worth keeping and an incomplete read must never
 * produce one — see `errors.ts`'s `forbidsStaling`.
 *
 * ## Coverage and gaps live in the kind FILE, not the manifest
 *
 * The manifest grades whether a kind was written; the file carries what the atlas knows it does NOT know
 * about that kind. Keeping them together is what lets `atlas crowdstrike coverage` answer per kind without
 * a second document to keep in step, and it is the shape both sibling atlases already write.
 */
import { z } from "zod";

import {
  ATLAS_COVERAGE_STATES,
  ATLAS_EVIDENCE_ROLES,
  atlasArtifactRefSchema,
  atlasSourceSchema,
} from "../kit/contract.js";
import { atlasKindStatusSchema } from "../kit/kindStatus.js";

import {
  CROWDSTRIKE_GAP_CONDITIONS,
  CROWDSTRIKE_KINDS,
  CROWDSTRIKE_SCHEMA_VERSION,
  CROWDSTRIKE_SURFACES,
} from "./model.js";

const isoSchema = z.iso.datetime();

/** Whether this run's complete read still returned the entity. See this file's header. */
const entityStateSchema = z.enum(["observed", "stale"]);

/** Fields every stored entity carries, whatever kind it is. */
const baseEntitySchema = z.object({
  /** When this entity was first observed by any surface, so age survives a re-sync. */
  firstSeenAt: isoSchema,
  /** The kit's stable, derived entity id — never the provider's own id. */
  id: z.string().min(1),
  /** The provider's own id, kept as a field so a human can paste it into the console. */
  providerId: z.string().min(1),
  source: atlasSourceSchema,
  state: entityStateSchema,
});

/**
 * A device with a Falcon sensor.
 *
 * `serialNumber`, `hostname` and `macAddress` are the cross-atlas join keys and are deliberately present —
 * see `privacy.ts` for why stripping them would defeat the atlas. `lastLoginAccount` is what Falcon last
 * OBSERVED logging in, which is a different claim from who a device is assigned to, and the reconciliation
 * report keeps those apart rather than treating one as the other.
 */
export const crowdstrikeHostSchema = baseEntitySchema
  .extend({
    agentVersion: z.string().nullable(),
    firstSeenAtProvider: isoSchema.nullable(),
    groupIds: z.array(z.string().min(1)),
    hidden: z.boolean(),
    hostname: z.string().nullable(),
    kernelVersion: z.string().nullable(),
    lastLoginAccount: z.string().nullable(),
    lastLoginAt: isoSchema.nullable(),
    lastSeenAt: isoSchema.nullable(),
    macAddress: z.string().nullable(),
    onlineState: z.string().nullable(),
    osBuild: z.string().nullable(),
    osVersion: z.string().nullable(),
    platformName: z.string().nullable(),
    preventionPolicyApplied: z.boolean().nullable(),
    preventionPolicyId: z.string().nullable(),
    productTypeDesc: z.string().nullable(),
    reducedFunctionalityMode: z.string().nullable(),
    rtrState: z.string().nullable(),
    sensorUpdatePolicyApplied: z.boolean().nullable(),
    sensorUpdatePolicyId: z.string().nullable(),
    serialNumber: z.string().nullable(),
    status: z.string().nullable(),
    systemManufacturer: z.string().nullable(),
    systemProductName: z.string().nullable(),
  })
  .strict();

export type CrowdstrikeHost = z.infer<typeof crowdstrikeHostSchema>;

/**
 * A host group — the thing a policy is actually attached to.
 *
 * Its own kind rather than a field on the policy, because "which machines does this policy cover" is
 * answered by joining a policy's `groupIds` to a host's `groupIds` and neither side owns the edge.
 */
export const crowdstrikeHostGroupSchema = baseEntitySchema
  .extend({
    createdAt: isoSchema.nullable(),
    description: z.string().nullable(),
    groupType: z.string().nullable(),
    modifiedAt: isoSchema.nullable(),
    name: z.string(),
  })
  .strict();

export type CrowdstrikeHostGroup = z.infer<typeof crowdstrikeHostGroupSchema>;

/** A prevention or sensor-update policy, with the host groups it applies to. */
export const crowdstrikePolicySchema = baseEntitySchema
  .extend({
    createdAt: isoSchema.nullable(),
    description: z.string().nullable(),
    enabled: z.boolean(),
    groupIds: z.array(z.string().min(1)),
    modifiedAt: isoSchema.nullable(),
    name: z.string(),
    platformName: z.string().nullable(),
    settings: z.array(z.object({ category: z.string(), id: z.string(), name: z.string(), value: z.string() }).strict()),
  })
  .strict();

export type CrowdstrikePolicy = z.infer<typeof crowdstrikePolicySchema>;

/** One open Spotlight finding against one host. */
export const crowdstrikeVulnerabilitySchema = baseEntitySchema
  .extend({
    apps: z.array(
      z
        .object({
          productNameVersion: z.string(),
          subStatus: z.string().nullable(),
          vendorNormalized: z.string().nullable(),
        })
        .strict(),
    ),
    baseScore: z.number().nullable(),
    createdAt: isoSchema.nullable(),
    cveId: z.string().nullable(),
    /** Falcon's own numeric exploit-status code, kept as the provider reports it rather than translated. */
    exploitStatus: z.number().int().nullable(),
    exprtRating: z.string().nullable(),
    hostAid: z.string().nullable(),
    isCisaKev: z.boolean().nullable(),
    severity: z.string().nullable(),
    status: z.string(),
    updatedAt: isoSchema.nullable(),
  })
  .strict();

export type CrowdstrikeVulnerability = z.infer<typeof crowdstrikeVulnerabilitySchema>;

/** A Zero Trust Assessment score for one host. */
export const crowdstrikeZeroTrustAssessmentSchema = baseEntitySchema
  .extend({
    hostAid: z.string(),
    modifiedAt: isoSchema.nullable(),
    osSignalsScore: z.number().nullable(),
    overallScore: z.number().nullable(),
    productTypeDesc: z.string().nullable(),
    sensorConfigScore: z.number().nullable(),
    sensorFileStatus: z.string().nullable(),
    serialNumber: z.string().nullable(),
    version: z.string().nullable(),
  })
  .strict();

export type CrowdstrikeZeroTrustAssessment = z.infer<typeof crowdstrikeZeroTrustAssessmentSchema>;

/** The tenant-wide Zero Trust summary. Exactly one row, or none. */
export const crowdstrikeZeroTrustAuditSchema = baseEntitySchema
  .extend({
    assessedHostCount: z.number().int().nullable(),
    averageOverallScore: z.number().nullable(),
    platforms: z.array(
      z
        .object({
          assessedHostCount: z.number().int().nullable(),
          averageOverallScore: z.number().nullable(),
          name: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export type CrowdstrikeZeroTrustAudit = z.infer<typeof crowdstrikeZeroTrustAuditSchema>;

/**
 * One detection.
 *
 * The only kind whose deep link is `provider-provided`: every alert carries Falcon's own `falcon_host_link`,
 * so no URL here was constructed from ids. Every command line, file path and hash the alert also carries is
 * refused at `privacy.ts` — this atlas records THAT a detection exists and its posture, never its content.
 */
export const crowdstrikeDetectionSchema = baseEntitySchema
  .extend({
    confidence: z.number().nullable(),
    createdAt: isoSchema.nullable(),
    displayName: z.string().nullable(),
    hostAid: z.string().nullable(),
    hostname: z.string().nullable(),
    objective: z.string().nullable(),
    patternDispositionDescription: z.string().nullable(),
    preventionPolicyId: z.string().nullable(),
    product: z.string().nullable(),
    severity: z.number().int().nullable(),
    severityName: z.string().nullable(),
    status: z.string().nullable(),
    tactic: z.string().nullable(),
    technique: z.string().nullable(),
    updatedAt: isoSchema.nullable(),
  })
  .strict();

export type CrowdstrikeDetection = z.infer<typeof crowdstrikeDetectionSchema>;

/** One console page the sitemap declares, and what happened when the walk visited it. */
export const crowdstrikeConsolePageSchema = baseEntitySchema
  .extend({
    appName: z.string().nullable(),
    featureFlags: z.array(z.string()),
    finalUrl: z.string().nullable(),
    href: z.string().min(1),
    outcome: z.enum(["landed", "redirected", "unavailable", "failed", "not-attempted"]),
    permissions: z.array(z.string()),
    statusCode: z.number().int().nullable(),
    title: z.string().nullable(),
  })
  .strict();

export type CrowdstrikeConsolePage = z.infer<typeof crowdstrikeConsolePageSchema>;

/**
 * One call the first-party console made, reduced to shape.
 *
 * `callability` is always `browser-observed-only` for this kind, and it is a stored field rather than an
 * implied one: a reader — human or router — must not conclude from a recorded request that Slopweaver can
 * make it. It cannot; the console's own API needs a bearer this atlas deliberately never obtains.
 */
export const crowdstrikeConsoleRequestSchema = baseEntitySchema
  .extend({
    callability: z.literal("browser-observed-only"),
    method: z.string().min(1),
    observedOnPages: z.array(z.string()),
    paramNames: z.array(z.string()),
    /** Path with volatile id segments replaced by a placeholder, so one endpoint is one entity. */
    pathShape: z.string().min(1),
    responseFieldPaths: z.array(z.string()),
    statusCodes: z.array(z.number().int()),
  })
  .strict();

export type CrowdstrikeConsoleRequest = z.infer<typeof crowdstrikeConsoleRequestSchema>;

/** One coverage cell, as this atlas stores it. The kit's shape, narrowed to this platform's surfaces. */
const crowdstrikeCoverageCellSchema = z
  .object({
    artifacts: z.array(atlasArtifactRefSchema),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.enum(CROWDSTRIKE_SURFACES),
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.string().min(1),
  })
  .strict();

export type CrowdstrikeCoverageCell = z.infer<typeof crowdstrikeCoverageCellSchema>;

/** One gap, as this atlas stores it. */
const crowdstrikeGapSchema = z
  .object({
    condition: z.enum(CROWDSTRIKE_GAP_CONDITIONS),
    fields: z.array(z.string()),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(CROWDSTRIKE_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    surfaces: z.array(z.enum(CROWDSTRIKE_SURFACES)),
  })
  .strict();

export type CrowdstrikeGap = z.infer<typeof crowdstrikeGapSchema>;

/** What every kind file carries besides its own entities. */
const kindFileEnvelope = {
  coverage: z.array(crowdstrikeCoverageCellSchema),
  gaps: z.array(crowdstrikeGapSchema),
  schemaVersion: z.literal(CROWDSTRIKE_SCHEMA_VERSION),
  updatedAt: isoSchema,
};

/**
 * One kind file on disk, discriminated by its own kind.
 *
 * A union rather than one loose shape, so a hosts file cannot hold a detection and a mis-routed projection
 * fails to publish rather than writing a plausible-looking lie. The kit only requires each entity to carry
 * an `id`; everything stricter here is this platform's own decision.
 *
 * Ten arms written out, rather than one generic helper over `kindFileEnvelope`. The helper compiled and
 * quietly cost the union its DISCRIMINANT: with `kind: z.literal(someTypeParameter)` the arms all widen to
 * `kind: string`, so narrowing a file on `kind === "host"` left `entities` as the union of all ten arrays
 * and every reader needed a cast to reach a serial number. Verified by narrowing to `"host"` and reading
 * `entities[0].serialNumber` — it does not compile through the helper and does through these.
 */
export const crowdstrikeKindFileSchema = z.discriminatedUnion("kind", [
  z.object({ ...kindFileEnvelope, entities: z.array(crowdstrikeHostSchema), kind: z.literal("host") }).strict(),
  z
    .object({ ...kindFileEnvelope, entities: z.array(crowdstrikeHostGroupSchema), kind: z.literal("host-group") })
    .strict(),
  z
    .object({ ...kindFileEnvelope, entities: z.array(crowdstrikePolicySchema), kind: z.literal("prevention-policy") })
    .strict(),
  z
    .object({
      ...kindFileEnvelope,
      entities: z.array(crowdstrikePolicySchema),
      kind: z.literal("sensor-update-policy"),
    })
    .strict(),
  z
    .object({
      ...kindFileEnvelope,
      entities: z.array(crowdstrikeVulnerabilitySchema),
      kind: z.literal("vulnerability"),
    })
    .strict(),
  z
    .object({
      ...kindFileEnvelope,
      entities: z.array(crowdstrikeZeroTrustAssessmentSchema),
      kind: z.literal("zero-trust-assessment"),
    })
    .strict(),
  z
    .object({
      ...kindFileEnvelope,
      entities: z.array(crowdstrikeZeroTrustAuditSchema),
      kind: z.literal("zero-trust-audit"),
    })
    .strict(),
  z
    .object({ ...kindFileEnvelope, entities: z.array(crowdstrikeDetectionSchema), kind: z.literal("detection") })
    .strict(),
  z
    .object({ ...kindFileEnvelope, entities: z.array(crowdstrikeConsolePageSchema), kind: z.literal("console-page") })
    .strict(),
  z
    .object({
      ...kindFileEnvelope,
      entities: z.array(crowdstrikeConsoleRequestSchema),
      kind: z.literal("console-request"),
    })
    .strict(),
]);

export type CrowdstrikeKindFile = z.infer<typeof crowdstrikeKindFileSchema>;

/** Every entity shape this atlas stores, as one union — what a projection returns before it is filed. */
export type CrowdstrikeEntity = CrowdstrikeKindFile["entities"][number];

/** The manifest, written last, that grades every kind file beside it. */
export const crowdstrikeManifestSchema = z
  .object({
    kinds: z.record(z.enum(CROWDSTRIKE_KINDS), atlasKindStatusSchema),
    schemaVersion: z.literal(CROWDSTRIKE_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type CrowdstrikeManifest = z.infer<typeof crowdstrikeManifestSchema>;
