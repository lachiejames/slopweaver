/**
 * The Trelica atlas's on-disk vocabulary — the generation that holds all THREE of its surfaces, and the
 * schemas that refuse to trust it.
 *
 * ## This atlas holds EVERYTHING REACHABLE, entities included
 *
 * Owner's ruling (`docs/atlas-intent/06-holdings.md`): what an atlas holds is decided per platform by
 * asking whether something better suited already holds its entities. For this platform the answer is no —
 * it is the organisation's own SaaS-discovery product, and its application inventory, its vendors and its
 * spend exist nowhere else on this machine. So the entity kinds here are the point rather than a
 * duplication, and the surface map sits beside them rather than instead of them.
 *
 * ## Three channels, because this platform genuinely has three surfaces
 *
 * `published-api` is the vendor's own documented REST surface, compiled from the OpenAPI documents the
 * tenant itself serves. `first-party-api` is the undocumented surface the web client calls, reached with
 * the owner's own signed-in session — usable by the owner's ruling that an undocumented endpoint is
 * a source when it works, and by §7's ruling that the browser is the FALLBACK, so a surface an API can
 * answer is ingested through the API. `browser` is the walk itself: which pages exist, where each settles,
 * and a photograph of each.
 *
 * The three are kept apart rather than folded, because what one can reach and another cannot is the
 * finding. MEASURED: the published API answers `403` to the session cookie every first-party
 * call is authorised by, so the two are not two spellings of one surface — they are two different doors
 * with two different keys, and only one of those keys is on this machine.
 *
 * ## Nothing here holds a credential, and the surface map holds no value at all
 *
 * A `method` entity carries names — an HTTP verb, a path shape with its values already replaced, parameter
 * and response field NAMES. Entity kinds (`app`, `role`, `ai-usage`, `ai-alert`) carry the provider's own
 * records through a closed projection (`projection.ts`, `aiProjection.ts`), never the response wholesale, and
 * never the session cookie or the antiforgery token that fetched them.
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
import { type AtlasPageDetail, atlasPageDetailSchema } from "../kit/pageObservation.js";
import { atlasPermissionBlockSchema } from "../kit/permissionBlock.js";

import { trelicaKindRecord } from "./kindRecord.js";

/**
 * The on-disk schema version for the Trelica atlas. Bump only with a real layout change; `store.ts` refuses
 * to read a generation declaring a different version, naming the reset remedy.
 *
 * Version 2 added the `ai-usage` and `ai-alert` kinds; version 3 added the nine kinds a raised Trelica role
 * opened (`entityModel.ts`). The manifest keys its kinds through an exhaustive record, so an
 * older manifest cannot describe them: the bump makes that the store's own reset remedy rather than a schema
 * error nobody can act on.
 */
export const TRELICA_ATLAS_SCHEMA_VERSION = 3;

/**
 * The platform discriminator. ONE per SaaS app — the published API, the first-party API and the web client
 * are three SURFACES of this one atlas, which is the whole point of the kit contract's header.
 */
export const TRELICA_ATLAS_PLATFORM = "trelica";

/** The entity kinds this atlas holds. Iterated by the reader, never derived from the directory listing. */
export const TRELICA_ATLAS_KINDS = [
  "access-review",
  "ai-alert",
  "ai-usage",
  "app",
  "assessment",
  "contract",
  "device",
  "integration",
  "method",
  "page",
  "person",
  "role",
  "team",
  "workflow",
  "workflow-run",
] as const;

export type TrelicaAtlasKind = (typeof TRELICA_ATLAS_KINDS)[number];

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what another already knew.
 */
export const TRELICA_ATLAS_CHANNELS = ["published-api", "first-party-api", "browser"] as const;

export type TrelicaAtlasChannel = (typeof TRELICA_ATLAS_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type TrelicaEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type TrelicaCoverageState = AtlasCoverageState;

/**
 * The claim boundary a coverage cell carries — one per channel, because the three ceilings are unrelated.
 *
 * The published API's ceiling is an API client this installation does not hold at all, so it is not a
 * narrower version of the session's ceiling: it is a different door. The first-party API and the browser
 * share a session but not a bound — a page can render a view the walk never asks an endpoint for.
 *
 * @internal
 */
export const TRELICA_VISIBILITY_SCOPES = [
  "published-api-client-credentials",
  "signed-in-session-roles",
  "browser-signed-in-roles",
] as const;

/**
 * The claim boundary one channel reads under.
 *
 * @internal
 */
export type TrelicaVisibilityScope = (typeof TRELICA_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one channel reads under.
 *
 * @param channel the channel that produced the cell
 * @returns that channel's own ceiling
 */
export function trelicaVisibilityScopeFor({ channel }: { channel: TrelicaAtlasChannel }): TrelicaVisibilityScope {
  if (channel === "published-api") {
    return "published-api-client-credentials";
  }
  if (channel === "browser") {
    return "browser-signed-in-roles";
  }
  return "signed-in-session-roles";
}

const isoSchema = z.iso.datetime();

/** One artifact backing a fact — a proof screenshot. Kit-owned. */
const trelicaArtifactRefSchema = atlasArtifactRefSchema;

export type TrelicaArtifactRef = z.infer<typeof trelicaArtifactRefSchema>;

/**
 * Where a record came from, and the link that proves it to a human.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const trelicaSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(TRELICA_ATLAS_CHANNELS) })
  .strict();

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type TrelicaSource = z.infer<typeof trelicaSourceSchema>;

/**
 * How a deep link was come by. Kit-owned, and read off the source schema rather than restated, so a widening
 * of the kit's own vocabulary cannot leave this atlas quietly declaring a narrower one.
 * @internal
 */
export type TrelicaDeepLinkStatus = TrelicaSource["deepLinkStatus"];

/**
 * What the published API declares about one operation: everything the vendor's own OpenAPI document states
 * about it, reduced to names.
 *
 * `documents` is which of the vendor's several OpenAPI documents declared it, kept so a reader can go
 * straight back to the source. It is a LIST rather than one name because two documents declaring the same
 * operation is a fact about the vendor rather than an error: folding them and recording both is what keeps
 * a sync publishing, where refusing the duplicate would have failed the whole run over a vendor's own
 * editorial choice. `summary` is the document's own one-line description.
 */
const trelicaMethodPublishedDetailSchema = z
  .object({
    bodyParams: z.array(z.string().min(1)),
    /** The OpenAPI `operationId`, or `null` when the document declares none. */
    operationId: z.string().min(1).nullable(),
    /** Which published document(s) declared it, e.g. `apps`. Sorted, and never empty. */
    documents: z.array(z.string().min(1)).min(1),
    pathParams: z.array(z.string().min(1)),
    queryParams: z.array(z.string().min(1)),
    /** Every response field name the declared success schema carries, sorted. */
    responseFields: z.array(z.string().min(1)),
    /** The security schemes the document requires for it, sorted. */
    security: z.array(z.string().min(1)),
    /** The document's own one-line summary, or `null` when it declares none — never an empty string. */
    summary: z.string().min(1).nullable(),
  })
  .strict();

export type TrelicaMethodPublishedDetail = z.infer<typeof trelicaMethodPublishedDetailSchema>;

/**
 * What a first-party call actually returned: the response field NAMES, and the status it answered with.
 *
 * `calledDirectly` separates an operation this atlas ASKED FOR through its own closed inventory from one it
 * merely watched the web client make. The two are different evidence — the first proves a session can
 * reach it, the second only that it exists — and a reader that cannot tell them apart would read an
 * observation as a capability.
 */
const trelicaMethodFirstPartyDetailSchema = z
  .object({
    calledDirectly: z.boolean(),
    /** How many times this operation was seen or called. A frequency, never a payload. */
    callCount: z.number().int().positive(),
    /** Every response field name observed at the body's top levels, sorted. */
    responseFields: z.array(z.string().min(1)),
    /** The last HTTP status observed for it. */
    statusCode: z.number().int(),
  })
  .strict();

export type TrelicaMethodFirstPartyDetail = z.infer<typeof trelicaMethodFirstPartyDetailSchema>;

/**
 * What the walk saw the web client call, and on which declared pages.
 *
 * `seenOnPages` is what turns a list of undocumented operations into something a reader can act on — an
 * operation is a lead, and the page it fires on is where that lead can be reproduced.
 */
const trelicaMethodBrowserDetailSchema = z
  .object({
    callCount: z.number().int().positive(),
    responseFields: z.array(z.string().min(1)),
    seenOnPages: z.array(z.string().min(1)),
    statusCode: z.number().int(),
  })
  .strict();

export type TrelicaMethodBrowserDetail = z.infer<typeof trelicaMethodBrowserDetailSchema>;

/**
 * What the browser saw one declared PAGE be: whether it was reached at all, what it settled on, and how
 * much of its own traffic the walk actually accounted for.
 *
 * The screenshot is not here — it is a {@link TrelicaSource} artifact, addressed by digest, because the
 * ruling is that the atlas HOLDS the picture rather than a link to one.
 *
 * @internal
 */
export const trelicaPageDetailSchema = atlasPageDetailSchema;

export type TrelicaPageDetail = AtlasPageDetail;

/**
 * One person named against an application, as this tenant records them: who, in which role, whether the
 * tenant marks them the owner, and whether they have since been terminated — a terminated owner is an
 * orphaned application, which is the reason the flag is kept.
 */
const trelicaContactSchema = z
  .object({
    email: z.string().nullable(),
    isOwner: z.boolean(),
    name: z.string(),
    /** The tenant's own role id, e.g. `businessOwner` or `itAdmin`. */
    role: z.string().nullable(),
    terminated: z.boolean(),
  })
  .strict();

/**
 * One application in the tenant's own inventory, through the closed projection in `projection.ts`.
 *
 * Every field here is one a reader of an atlas asks for: what the app is, who supplies it, how it was
 * discovered, who inside the organisation owns it, how many people hold accounts on it, and what it costs.
 * The provider's record carries far more (`descriptor.ts`'s `excludes` says what is dropped and why), and
 * a projection is what makes the omission a decision rather than an accident.
 */
const trelicaAppDetailSchema = z
  .object({
    /** How this application entered the inventory, e.g. an identity provider's own account feed. */
    discoveredBy: z.string().min(1).nullable(),
    /** The identity provider or integration that reported it, when one did. */
    discoveredByProviderId: z.string().min(1).nullable(),
    displayName: z.string().min(1),
    /** Whether this application is offered in the tenant's own end-user catalogue. */
    inCatalog: z.boolean(),
    /** The people inside the organisation recorded against it — the OWNER question the atlas answers. */
    internalContacts: z.array(trelicaContactSchema),
    /** Spend attributed to it over the trailing year, in the tenant's own default currency, or `null`. */
    lastYearSpend: z.number().nullable(),
    /** The provider's own licence-plan names, sorted. Names only — never a seat list. */
    licensePlans: z.array(z.string().min(1)),
    name: z.string().min(1),
    /** The provider's own risk score, when it has computed one. */
    riskScore: z.number().nullable(),
    /** `Managed`, `Discovered`, and the rest of the provider's own inventory vocabulary. */
    status: z.string().min(1),
    /** How many accounts the tenant knows about on it. A COUNT, never the accounts. */
    userCount: z.number().int().nonnegative().nullable(),
    vendorName: z.string().min(1).nullable(),
  })
  .strict();

export type TrelicaAppDetail = z.infer<typeof trelicaAppDetailSchema>;

/** One role this tenant defines, and whether the platform ships it or the organisation created it. */
const trelicaRoleDetailSchema = z.object({ isSystemRole: z.boolean(), name: z.string().min(1) }).strict();

export type TrelicaRoleDetail = z.infer<typeof trelicaRoleDetailSchema>;

/**
 * The AI-consumption dimensions the tenant's cost explorer groups spend by, each one org-wide read.
 *
 * @internal
 */
export const TRELICA_AI_USAGE_DIMENSIONS = ["api-key", "app", "cost-center", "model", "person", "team"] as const;

export type TrelicaAiUsageDimension = (typeof TRELICA_AI_USAGE_DIMENSIONS)[number];

/** The usage figures the cost explorer reports for every row, whatever it is grouped by. */
export const trelicaAiUsageMetricsSchema = z
  .object({
    cachedInputTokens: z.number(),
    cachedOutputTokens: z.number(),
    credits: z.number(),
    inputTokens: z.number(),
    linesOfCodeAdded: z.number(),
    linesOfCodeRemoved: z.number(),
    outputTokens: z.number(),
    requests: z.number(),
    /** Estimated spend in the tenant's own currency, as the cost explorer itself computes it. */
    spend: z.number(),
    totalTokens: z.number(),
  })
  .strict();

export type TrelicaAiUsageMetrics = z.infer<typeof trelicaAiUsageMetricsSchema>;

/**
 * One row of the cost explorer — one app, team, cost centre, model, API key or person — over a stated window.
 *
 * `spendByPeriod` is filled only for a row the explorer also charts as a series (its top six), at whatever
 * granularity the explorer chose for the window; `granularity` says which, and is never assumed.
 */
const trelicaAiUsageDetailSchema = z
  .object({
    customerAppId: z.string().min(1).nullable(),
    customerAppName: z.string().min(1).nullable(),
    dimension: z.enum(TRELICA_AI_USAGE_DIMENSIONS),
    /** A person row's own address. Staff of this organisation, and the explorer's own content. */
    email: z.string().min(1).nullable(),
    granularity: z.string().min(1).nullable(),
    label: z.string().min(1),
    /** A team's depth in the explorer's tree, `0` at the root; `null` on every other dimension. */
    level: z.number().int().nonnegative().nullable(),
    metrics: trelicaAiUsageMetricsSchema,
    /** The team this team sits under, by the explorer's own key; `null` at the root and on other dimensions. */
    parentId: z.string().min(1).nullable(),
    spendByPeriod: z.record(z.string(), z.number()).nullable(),
    windowEnd: z.string().min(1),
    windowStart: z.string().min(1),
  })
  .strict();

export type TrelicaAiUsageDetail = z.infer<typeof trelicaAiUsageDetailSchema>;

/** One alert the cost explorer raised: a spend spike against its baseline, or a budget threshold crossed. */
const trelicaAiAlertDetailSchema = z
  .object({
    baselineMedian: z.number().nullable(),
    customerAppId: z.string().min(1).nullable(),
    customerAppName: z.string().min(1).nullable(),
    date: z.string().min(1),
    /** Spend on the day the alert evaluated. */
    evalDaySpend: z.number().nullable(),
    status: z.string().min(1),
    subType: z.string().min(1).nullable(),
    trend: z.array(z.object({ date: z.string().min(1), spend: z.number() }).strict()),
    type: z.string().min(1),
  })
  .strict();

export type TrelicaAiAlertDetail = z.infer<typeof trelicaAiAlertDetailSchema>;

/** One channel's independent view of one entity. A successful look replaces only this channel's own detail. */
const trelicaChannelEntitySchema = z
  .object({
    channel: z.enum(TRELICA_ATLAS_CHANNELS),
    /** What this channel knows about this entity. Shape depends on the kind — see the detail schemas above. */
    detail: z.unknown().nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: trelicaSourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

export type TrelicaChannelEntity = z.infer<typeof trelicaChannelEntitySchema>;

/** One tracked entity: a stable identity, plus whatever each channel independently knows about it. */
const trelicaAtlasEntitySchema = z
  .object({
    channels: z
      .object({
        browser: trelicaChannelEntitySchema.nullable(),
        "first-party-api": trelicaChannelEntitySchema.nullable(),
        "published-api": trelicaChannelEntitySchema.nullable(),
      })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(TRELICA_ATLAS_KINDS),
    /**
     * The provider's own key: `<METHOD> <path shape>` for a method, the declared route for a page, and the
     * provider's own id for an application or a role. This is what the channels are matched on, byte-exactly.
     */
    providerId: z.string().min(1),
  })
  .strict();

export type TrelicaAtlasEntity = z.infer<typeof trelicaAtlasEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel. `lastSuccessAt` and
 * `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one timestamp cannot answer
 * "is this still current" after a run that failed following one that succeeded.
 */
const trelicaCoverageCellSchema = z
  .object({
    artifacts: z.array(trelicaArtifactRefSchema),
    channel: z.enum(TRELICA_ATLAS_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.enum(TRELICA_VISIBILITY_SCOPES),
  })
  .strict();

export type TrelicaCoverageCell = z.infer<typeof trelicaCoverageCellSchema>;

/**
 * A gap, as stored. This atlas's own condition vocabulary plus kind — see `gaps.ts`.
 *
 * `fields` and `surfaces` carry the CONTENT of a disagreement: which names one surface has and another does
 * not, and which two surfaces those were. A disagreement gap without them says only that a disagreement
 * happened, which is a notification rather than a finding.
 */
export const trelicaAtlasGapSchema = z
  .object({
    condition: z.string().min(1),
    fields: z.array(z.string().min(1)),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(TRELICA_ATLAS_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    surfaces: z.array(z.enum(TRELICA_ATLAS_CHANNELS)),
  })
  .strict();

export type TrelicaAtlasGap = z.infer<typeof trelicaAtlasGapSchema>;

/** One kind's file on disk. */
export const trelicaAtlasKindFileSchema = z
  .object({
    coverage: z.array(trelicaCoverageCellSchema),
    entities: z.array(trelicaAtlasEntitySchema),
    gaps: z.array(trelicaAtlasGapSchema),
    kind: z.enum(TRELICA_ATLAS_KINDS),
    platform: z.literal(TRELICA_ATLAS_PLATFORM),
    schemaVersion: z.literal(TRELICA_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type TrelicaAtlasKindFile = z.infer<typeof trelicaAtlasKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const trelicaAtlasKindStatusSchema = z
  .object({
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

/** @internal */
export type TrelicaAtlasKindStatus = z.infer<typeof trelicaAtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const trelicaAtlasManifestSchema = z
  .object({
    kinds: z.record(z.enum(TRELICA_ATLAS_KINDS), trelicaAtlasKindStatusSchema),
    platform: z.literal(TRELICA_ATLAS_PLATFORM),
    schemaVersion: z.literal(TRELICA_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type TrelicaAtlasManifest = z.infer<typeof trelicaAtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialTrelicaManifest({ updatedAt }: { updatedAt: string }): TrelicaAtlasManifest {
  const empty: TrelicaAtlasKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  return {
    kinds: trelicaKindRecord({ of: () => empty }),
    platform: TRELICA_ATLAS_PLATFORM,
    schemaVersion: TRELICA_ATLAS_SCHEMA_VERSION,
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
export function emptyTrelicaKindFile({
  kind,
  updatedAt,
}: {
  kind: TrelicaAtlasKind;
  updatedAt: string;
}): TrelicaAtlasKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: TRELICA_ATLAS_PLATFORM,
    schemaVersion: TRELICA_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}

/**
 * An entity whose channels are all empty, ready for one channel to be filled onto it.
 *
 * @returns the empty channel map
 * @internal
 */
export function emptyTrelicaChannels(): TrelicaAtlasEntity["channels"] {
  return { browser: null, "first-party-api": null, "published-api": null };
}
