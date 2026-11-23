/**
 * The Vanta atlas's on-disk vocabulary, and the schemas that refuse to trust it.
 *
 * ## Coverage carries its own freshness inputs
 *
 * A coverage cell stores `lastSuccessAt` and `latestAttemptFailed` — the two fields {@link ./freshness.js}'s
 * `assessFreshness` needs — rather than one `observedAt`. A single timestamp cannot answer "is this still
 * current" after a run that failed following one that succeeded.
 *
 * ## Channels are independent, not merged into one detail
 *
 * The Manage API and a future browser capture can each see fields the other cannot, and one succeeding must
 * never erase what the other already knew. So an entity holds one {@link VantaChannelEntity} per channel
 * rather than one shared `detail`.
 *
 * ## Coverage is scoped by the CHANNEL that reached it, not by a human's role
 *
 * Every coverage cell carries the {@link VantaVisibilityScope} of the channel that produced it. The two are
 * genuinely different ceilings and neither implies the other: a Manage API cell sees exactly what the OAuth
 * application's scope grants (`vanta-api.all:read`), which is a property of the credential and of no
 * person's role at all, while a browser cell sees exactly what the signed-in human's own role opens. So
 * "complete" here is always complete for the channel named on the cell.
 */
import { z } from "zod";

import {
  ATLAS_COVERAGE_STATES,
  ATLAS_EVIDENCE_ROLES,
  type AtlasCoverageState,
  type AtlasEvidenceRole,
  atlasArtifactRefSchema,
  atlasSourceSchema,
} from "../kit/contract.js";
import { atlasPermissionBlockSchema } from "../kit/permissionBlock.js";

/**
 * The on-disk schema version for the Vanta atlas. Bump only with a real layout change; `store.ts` refuses
 * to read a generation declaring a different version, naming `vanta reset` as the remedy.
 *
 * 3 → 4: the `policy-document` kind arrived. A kind added without a version bump does not
 * fail cleanly — the manifest parse refuses with `kinds.policy-document: expected object, received
 * undefined`, which reads like corruption rather than like a layout that moved.
 *
 * 4 → 5: the eight families this atlas had documented and never called arrived at once —
 * `library-control`, `customer-trust-account`, `questionnaire`, `questionnaire-assignable-user`,
 * `trust-tag-category`, `importable-idp-group`, `answer-library-entry` and `vulnerability-remediation`.
 *
 * 5 → 6: the eleven FAN-OUT kinds arrived — the families reached by one request per parent
 * row rather than one request per family. Four of them hold a pairing rather than an object, because the
 * object is one another kind already holds; `childCensus.ts` carries the measurement that decides which.
 *
 * 6 → 7: `integration-resource` arrived — every resource each integration exposes to Vanta,
 * held whole on the owner's ruling, and the first fan-out whose parent is itself a fan-out.
 */
export const VANTA_ATLAS_SCHEMA_VERSION = 7;

/** The platform discriminator, written alongside the version so a store can never be misread as another atlas's. */
export const VANTA_ATLAS_PLATFORM = "vanta";

/**
 * Every entity kind this atlas holds, one per Manage API family plus the two that only a browser can reach.
 * Iterated by the reader, never derived from the directory listing.
 *
 * `user` and `person` are separate kinds because Vanta separates them: a user is a Vanta login, a person is
 * a personnel record, and `people.userId` is the link between them — the two kinds' own tallies differ, measured
 * (`slopweaver atlas vanta coverage` prints each). `discovered-vendor` is likewise not a `vendor`: it
 * is what an integration noticed being paid for, before anyone put it on the register.
 *
 * `policy-document` is the policy's own FILE — the source Vanta served and the text extracted from it —
 * and it is separate from `policy` because Vanta separates them: a policy is an object in `/v1/policies`
 * with a name, a status and an approval date, while its body is a resource in
 * `/v1/knowledge-base/resources` with no field linking the two. Folding the body onto the policy record
 * would have required this atlas to invent that link.
 *
 * `event-shape` holds SHAPES, never events. Its entities are the kinds of event Vanta logs and the
 * attributes each one carries, so this atlas can say what the event log contains without holding a copy of
 * it — see `eventShapes.ts`.
 *
 * The last two are the BROWSER channel's own, and they exist so the two channels can never truncate each
 * other: `sync.ts` publishes the Manage API kinds and omits these, `browserSurface.ts` publishes these and
 * omits those, and the kit leaves an omitted kind's file untouched. A `browser-page` is one declared page
 * of the web client and whether the walk reached it; a `browser-operation` is one call that client makes,
 * identified by its GraphQL operation name and reduced to field NAMES — never a value it received.
 */
export const VANTA_KINDS = [
  "control",
  "library-control",
  "risk",
  "policy",
  "policy-document",
  "evidence",
  "audit",
  "vendor",
  "user",
  "person",
  "group",
  "monitored-computer",
  "test",
  "integration",
  "framework",
  "discovered-vendor",
  "vendor-assessment-type",
  "vendor-risk-attribute",
  "issue",
  "vulnerable-asset",
  "vulnerability",
  "vulnerability-remediation",
  "control-document-link",
  "framework-control-link",
  "risk-control-link",
  "group-member",
  "discovered-vendor-account",
  "document-link",
  "document-upload",
  "integration-resource-kind",
  "integration-resource",
  "vendor-assessment",
  "vendor-document",
  "vendor-security-review",
  "customer-trust-account",
  "questionnaire",
  "questionnaire-assignable-user",
  "trust-tag-category",
  "importable-idp-group",
  "answer-library-entry",
  "event-shape",
  "browser-page",
  "browser-operation",
] as const;

export type VantaKind = (typeof VANTA_KINDS)[number];

/**
 * The kinds the BROWSER channel owns. `sync.ts` never publishes one and `browserSurface.ts` never publishes
 * anything else, which is the mechanism by which one channel cannot truncate the other's work.
 */
export type VantaBrowserKind = "browser-page" | "browser-operation";

/**
 * The kinds the Manage API sync is responsible for: everything except the browser channel's own and
 * `audit`, which has no Manage API surface at all because `GET /v1/audits` answers HTTP 403 on this
 * credential. Naming it as a type means a kind added without a sync runner fails to compile.
 */
export type VantaApiKind = Exclude<VantaKind, "audit" | VantaBrowserKind>;

/** How a fact was reached. Each channel owns independent presence/detail — see this file's header. */
export const VANTA_CHANNELS = ["manage-api", "browser"] as const;

export type VantaChannel = (typeof VANTA_CHANNELS)[number];

/** What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`. */
export type VantaEvidenceRole = AtlasEvidenceRole;

/** How far this atlas has got with one surface, through one channel. Kit-owned and closed. */
export type VantaCoverageState = AtlasCoverageState;

/**
 * The claim boundary a coverage cell carries — one per channel, because the two ceilings are unrelated.
 * See this file's header.
 *
 * @internal
 */
export const VANTA_VISIBILITY_SCOPES = ["manage-api-all-read", "browser-signed-in-role"] as const;

/**
 * The claim boundary one channel reads under.
 *
 * @internal
 */
export type VantaVisibilityScope = (typeof VANTA_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one channel reads under.
 *
 * @param channel the channel that produced the cell
 * @returns that channel's own ceiling
 */
export function vantaVisibilityScopeFor({ channel }: { channel: VantaChannel }): VantaVisibilityScope {
  return channel === "manage-api" ? "manage-api-all-read" : "browser-signed-in-role";
}

const isoSchema = z.iso.datetime();

/** One artifact backing a fact — a proof screenshot, an extracted page, a downloaded file. Kit-owned. */
const vantaArtifactRefSchema = atlasArtifactRefSchema;

export type VantaArtifactRef = z.infer<typeof vantaArtifactRefSchema>;

/**
 * Where a record came from, and the link that proves it to a human.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the same one every atlas carries. The one substitution is Vanta's: it names its
 * acquisition path `channel` rather than the kit's `surface`, which is what is already on disk.
 */
const vantaSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(VANTA_CHANNELS) })
  .strict();

export type VantaSource = z.infer<typeof vantaSourceSchema>;

/**
 * One coverage cell: what we know about one surface through one channel. `lastSuccessAt` and
 * `latestAttemptFailed` are the freshness inputs {@link ./freshness.js}'s `assessFreshness` needs.
 */
const vantaCoverageCellSchema = z
  .object({
    artifacts: z.array(vantaArtifactRefSchema),
    channel: z.enum(VANTA_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.enum(VANTA_VISIBILITY_SCOPES),
  })
  .strict();

export type VantaCoverageCell = z.infer<typeof vantaCoverageCellSchema>;

/** Whether an evidence record needs care before its content is quoted outbound. Never gates ingestion. */
const vantaSensitivitySchema = z
  .object({ handleWithCare: z.literal(true), providerMarkedSensitive: z.boolean().nullable() })
  .strict();

export type VantaSensitivity = z.infer<typeof vantaSensitivitySchema>;

/**
 * A presence marker for a financial value withheld from this entity's committed detail. A vendor's
 * contract amount is a financial record, not compliance metadata, so it never reaches the committed kind
 * file — see `privacy.ts`. This is the pointer left in its place.
 */
const vantaFinancialPointerSchema = z
  .object({
    /** Relative to the state home — e.g. `atlas/vanta/_sensitive/vendor/<entityId>.json`. */
    companionRelativePath: z.string().min(1),
    hasFinancialDetail: z.literal(true),
  })
  .strict();

export type VantaFinancialPointer = z.infer<typeof vantaFinancialPointerSchema>;

/** One channel's independent view of one entity. A successful look replaces only this channel's own detail. */
const vantaChannelEntitySchema = z
  .object({
    channel: z.enum(VANTA_CHANNELS),
    /** The provider's own JSON for this entity, through this channel. */
    detail: z.unknown().nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: vantaSourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

export type VantaChannelEntity = z.infer<typeof vantaChannelEntitySchema>;

/** One tracked entity: a stable identity, plus whatever each channel independently knows about it. */
export const vantaEntitySchema = z
  .object({
    channels: z
      .object({ browser: vantaChannelEntitySchema.nullable(), "manage-api": vantaChannelEntitySchema.nullable() })
      .strict(),
    financialDetail: vantaFinancialPointerSchema.nullable(),
    id: z.string().min(1),
    kind: z.enum(VANTA_KINDS),
    providerId: z.string().min(1),
    sensitivity: vantaSensitivitySchema.nullable(),
  })
  .strict();

export type VantaEntity = z.infer<typeof vantaEntitySchema>;

/** A gap, as stored. Vanta's own condition vocabulary plus kind/channel — see `gaps.ts`. */
const vantaGapSchema = z
  .object({
    channel: z.enum(VANTA_CHANNELS).nullable(),
    condition: z.string().min(1),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(VANTA_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
  })
  .strict();

export type VantaGap = z.infer<typeof vantaGapSchema>;

/** One kind's file on disk. */
export const vantaKindFileSchema = z
  .object({
    coverage: z.array(vantaCoverageCellSchema),
    entities: z.array(vantaEntitySchema),
    gaps: z.array(vantaGapSchema),
    kind: z.enum(VANTA_KINDS),
    platform: z.literal(VANTA_ATLAS_PLATFORM),
    schemaVersion: z.literal(VANTA_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type VantaKindFile = z.infer<typeof vantaKindFileSchema>;

/** What is known about one kind's synchronisation history. */
const vantaKindStatusSchema = z
  .object({
    /** A digest of the bytes published, so a later half-write is detectable rather than silent. */
    digest: z.string().min(1).nullable(),
    entityCount: z.number().int().nonnegative(),
    lastAttempt: z
      .object({ at: isoSchema, outcome: z.enum(["ok", "failed"]), reasons: z.array(z.string()) })
      .strict()
      .nullable(),
    lastSuccessAt: isoSchema.nullable(),
    // Absent on every manifest written before the field existed, so nullish rather than required — see
    // `atlasPermissionBlockSchema` in the kit for why the field exists at all.
    permissionBlocked: atlasPermissionBlockSchema.nullish(),
  })
  .strict();

type VantaKindStatus = z.infer<typeof vantaKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const vantaManifestSchema = z
  .object({
    kinds: z.record(z.enum(VANTA_KINDS), vantaKindStatusSchema),
    platform: z.literal(VANTA_ATLAS_PLATFORM),
    schemaVersion: z.literal(VANTA_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type VantaManifest = z.infer<typeof vantaManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialVantaManifest({ updatedAt }: { updatedAt: string }): VantaManifest {
  const empty: VantaKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  return {
    kinds: {
      "answer-library-entry": empty,
      "control-document-link": empty,
      "discovered-vendor-account": empty,
      "document-link": empty,
      "document-upload": empty,
      "framework-control-link": empty,
      "group-member": empty,
      "integration-resource": empty,
      "integration-resource-kind": empty,
      "risk-control-link": empty,
      "vendor-assessment": empty,
      "vendor-document": empty,
      "vendor-security-review": empty,
      audit: empty,
      "browser-operation": empty,
      "browser-page": empty,
      control: empty,
      "customer-trust-account": empty,
      "discovered-vendor": empty,
      evidence: empty,
      "event-shape": empty,
      framework: empty,
      group: empty,
      "importable-idp-group": empty,
      integration: empty,
      issue: empty,
      "library-control": empty,
      "monitored-computer": empty,
      person: empty,
      policy: empty,
      "policy-document": empty,
      questionnaire: empty,
      "questionnaire-assignable-user": empty,
      risk: empty,
      test: empty,
      "trust-tag-category": empty,
      user: empty,
      vendor: empty,
      "vendor-assessment-type": empty,
      "vendor-risk-attribute": empty,
      vulnerability: empty,
      "vulnerability-remediation": empty,
      "vulnerable-asset": empty,
    },
    platform: VANTA_ATLAS_PLATFORM,
    schemaVersion: VANTA_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}

/**
 * An empty kind file.
 *
 * @param kind the kind this file holds
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty kind file
 */
export function emptyVantaKindFile({ kind, updatedAt }: { kind: VantaKind; updatedAt: string }): VantaKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: VANTA_ATLAS_PLATFORM,
    schemaVersion: VANTA_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}
