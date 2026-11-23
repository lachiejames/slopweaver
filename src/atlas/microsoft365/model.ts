/**
 * What the Microsoft 365 / Entra atlas holds, and the permanent boundary of what it can ever claim.
 *
 * ## One platform, and it is the largest of them
 *
 * Microsoft Graph is the single addressable surface over Entra ID, Exchange, SharePoint, OneDrive, Teams,
 * Intune and Purview, so those are WORKLOADS of one platform rather than seven atlases — `kit/contract.ts`
 * makes that a type. MEASURED against the pinned document (`specLock.ts`, reproduce with
 * `slopweaver atlas microsoft365 sync --json`): 11,493 paths, 17,777 operations, 9,378 of them `GET`, over
 * 70 resource roots. That is an order of magnitude past every sibling atlas here, which is why the
 * disposition below is applied per OPERATION rather than per family.
 *
 * ## This atlas holds ENTITIES too, once it can reach them
 *
 * `docs/atlas-intent/06-holdings.md` is a test an atlas applies to its own platform: does something better suited
 * already hold this platform's entities? For Slack and Notion the answer is yes and the atlas holds the
 * surface map alone. Here it is NO — nothing else in this installation holds the directory — so the answer
 * is everything reachable for identity and configuration, entities included. The `api` channel is where
 * those land, and it is `declared-unfilled` today because no Entra application registration exists to reach
 * Graph with; the `compiled` channel does not wait on that and is filled from the pinned specification.
 *
 * A kind here is a DECLARATION, never a claim that anything has been read. Each kind's own coverage cell
 * says what actually happened to it, per channel.
 *
 * ## Kinds are Graph's own first path segment
 *
 * Not an invented taxonomy: a reader who knows the Graph reference knows the kind, and the alternative —
 * folding 70 roots into eight tidy workload names — is exactly the re-skinning `jumpcloud/model.ts` warns
 * against, because the fold is a judgement nobody can check against the vendor's own document. `me` is
 * Graph's own root for the signed-in-user alias and is kept as a kind for that reason; every operation under
 * it records the `/users/{user-id}` address it aliases, when one exists, so the duplication is a RECORD
 * rather than a silent doubling of the surface.
 *
 * ## Nothing here holds a message, a file or an audit row
 *
 * Every field an `operation` entity carries is a NAME: an HTTP method, a path shape with its parameters as
 * placeholders, a query parameter name, a response field name. The voluminous families — mail, files and the
 * unified audit log — are enumerated as operations and declared as such, and never publish a row per record.
 * That is a disposition, not an exclusion: see `dispositions.ts`.
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
 * The on-disk schema version. Bump only with a real layout change; `store.ts` refuses to read a generation
 * declaring a different version, naming the reset remedy.
 */
export const MICROSOFT365_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — Graph, the admin centres and Entra are SURFACES of this one
 * atlas, which is the whole point of the kit contract's header.
 */
export const MICROSOFT365_ATLAS_PLATFORM = "microsoft365";

/**
 * Every kind this atlas publishes a file for — one per resource root in the pinned specification, plus
 * `page` for the browser surface.
 *
 * Written out rather than computed so the list stays a literal union a caller can be checked against, and
 * pinned to the specification by `censusLock.ts`, which a sync asserts EXACT equality against. A root the
 * vendor adds tomorrow is therefore a REFUSAL to publish rather than a silent widening.
 */
export const MICROSOFT365_KINDS = [
  "admin",
  "agreementAcceptances",
  "agreements",
  "appCatalogs",
  "applicationTemplates",
  "applications",
  "auditLogs",
  "authenticationMethodConfigurations",
  "authenticationMethodsPolicy",
  "certificateBasedAuthConfiguration",
  "chats",
  "communications",
  "compliance",
  "connections",
  "contacts",
  "contracts",
  "copilot",
  "dataPolicyOperations",
  "deviceAppManagement",
  "deviceManagement",
  "devices",
  "directory",
  "directoryObjects",
  "directoryRoleTemplates",
  "directoryRoles",
  "domainDnsRecords",
  "domains",
  "drives",
  "education",
  "employeeExperience",
  "external",
  "filterOperators",
  "functions",
  "groupLifecyclePolicies",
  "groupSettingTemplates",
  "groupSettings",
  "groups",
  "identity",
  "identityGovernance",
  "identityProtection",
  "identityProviders",
  "informationProtection",
  "invitations",
  "me",
  "oauth2PermissionGrants",
  "organization",
  "page",
  "permissionGrants",
  "places",
  "planner",
  "policies",
  "print",
  "privacy",
  "reports",
  "roleManagement",
  "schemaExtensions",
  "scopedRoleMemberships",
  "search",
  "security",
  "servicePrincipals",
  "shares",
  "sites",
  "solutions",
  "storage",
  "subscribedSkus",
  "subscriptions",
  "teams",
  "teamsTemplates",
  "teamwork",
  "tenantRelationships",
  "users",
] as const;

/** One kind this atlas publishes. */
export type Microsoft365Kind = (typeof MICROSOFT365_KINDS)[number];

/**
 * The kind that holds browser pages rather than Graph operations.
 *
 * Named rather than inferred because two things branch on it: the sync must not stale it, and the walk must
 * not touch any other kind.
 */
export const MICROSOFT365_PAGE_KIND = "page";

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what the other already knew.
 *
 * `compiled` is the vendor's own published specification, read offline; `api` is a live Graph call; `browser`
 * is a page walked in the owner's real Chrome. The first two are NOT the same channel, and conflating them is
 * the error this split exists to prevent: a specification declaring an endpoint says nothing whatever about
 * whether this tenant's credential may call it.
 */
export const MICROSOFT365_CHANNELS = ["compiled", "api", "browser"] as const;

export type Microsoft365Channel = (typeof MICROSOFT365_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type Microsoft365EvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type Microsoft365CoverageState = AtlasCoverageState;

/**
 * The claim boundary a coverage cell carries — one per channel, because the three ceilings are unrelated.
 *
 * The compiled channel's ceiling is a DOCUMENT and no tenant at all; the API channel's is whatever an Entra
 * application registration is consented for; the browser channel's is whatever the signed-in person's own
 * directory roles open. One `visibilityScope` for the atlas would be false about two channels whichever
 * value it took.
 *
 * @internal
 */
export const MICROSOFT365_VISIBILITY_SCOPES = [
  "compiled-published-specification",
  "api-application-consent",
  "browser-signed-in-roles",
] as const;

/**
 * The claim boundary one channel reads under.
 * @internal
 */
export type Microsoft365VisibilityScope = (typeof MICROSOFT365_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one channel reads under.
 *
 * @param channel the channel that produced the cell
 * @returns that channel's own ceiling
 */
export function microsoft365VisibilityScopeFor({
  channel,
}: {
  channel: Microsoft365Channel;
}): Microsoft365VisibilityScope {
  if (channel === "compiled") {
    return "compiled-published-specification";
  }
  if (channel === "api") {
    return "api-application-consent";
  }
  return "browser-signed-in-roles";
}

/**
 * The permanent claim boundary — what "complete" can ever mean for this installation's access.
 *
 * Stated in the credentials' own terms rather than as a reassurance, and it names the one that does not
 * exist: there is no Entra application registration on this installation, so the live Graph channel has no
 * ceiling yet because it has no floor.
 */
export const MICROSOFT365_VISIBILITY_SCOPE =
  "the compiled channel sees exactly one pinned, publicly published Microsoft Graph v1.0 specification and " +
  "no tenant at all; the live Graph channel sees whatever an Entra application registration is consented " +
  "for, and this installation holds none, so it has never read anything; the browser channel sees whatever " +
  "the signed-in person's own Entra directory roles and Microsoft 365 licences open, reached through two " +
  "JumpCloud SSO assignments and a SaaS-management account. None of the three implies either other, and " +
  "'complete' here is always complete for the channel named on the cell";

const isoSchema = z.iso.datetime();

/** One artifact backing a fact — a proof screenshot. Kit-owned. */
const microsoft365ArtifactRefSchema = atlasArtifactRefSchema;

export type Microsoft365ArtifactRef = z.infer<typeof microsoft365ArtifactRefSchema>;

/**
 * Where a record came from, through one channel.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const microsoft365SourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(MICROSOFT365_CHANNELS) })
  .strict();

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type Microsoft365Source = z.infer<typeof microsoft365SourceSchema>;

/**
 * What this atlas may do with one operation, decided per operation rather than per family.
 *
 * - `reachable` — configuration or identity a person or a system CREATED, listable exhaustively. The atlas
 *   may call it once a credential exists, and stores what it returns.
 * - `voluminous` — time-series OBSERVATIONS: emitted by the platform, unbounded, growing with the clock,
 *   identified by an instant rather than by a name somebody chose. The operation is enumerated and declared;
 *   its rows are never stored whole. A DISPOSITION, not an exclusion — the family has been looked at and
 *   deliberately not kept, which an excluded family cannot say about itself.
 * - `excluded` — the atlas will never call it: every mutation, and the reads whose own act has an effect.
 *
 * `docs/atlas-intent/06-holdings.md` is the authority, and the criterion cuts THROUGH a family rather than along it:
 * `GET /auditLogs/signIns` is voluminous and `GET /auditLogs/signIns/{id}` addresses one row somebody can
 * name, while `GET /users/{user-id}/mailFolders` is the folder list a person authored and is reachable
 * configuration inside the mail family this atlas otherwise declares voluminous.
 */
const MICROSOFT365_DISPOSITIONS = ["reachable", "voluminous", "excluded"] as const;

export type Microsoft365Disposition = (typeof MICROSOFT365_DISPOSITIONS)[number];

/**
 * What the compiled channel knows about one operation: everything the pinned specification states about it,
 * reduced to names.
 *
 * There is no response VALUE here and there cannot be — this channel never called anything. `responseFields`
 * are the property names the declared success schema carries, resolved one `$ref` deep plus its `allOf`
 * bases, which is where Graph puts an entity's own properties.
 */
const microsoft365OperationCompiledDetailSchema = z
  .object({
    /** The `/users/{user-id}` address this `me` operation aliases, or `null` when it is not an alias. */
    aliasOf: z.string().min(1).nullable(),
    /** What this atlas may do with the operation, and why. */
    disposition: z.enum(MICROSOFT365_DISPOSITIONS),
    /** The rule that decided the disposition, in English. Never empty, including for `reachable`. */
    dispositionReason: z.string().min(1),
    /** The HTTP method, upper-cased. */
    method: z.string().min(1),
    /** Graph's own operation id, e.g. `users.user.ListUser`. */
    operationId: z.string().min(1),
    /** Path template parameter names, in declaration order. */
    pathParams: z.array(z.string().min(1)),
    /** The path shape, parameters left as placeholders. */
    pathShape: z.string().min(1),
    /** Query parameter names the specification declares, sorted. */
    queryParams: z.array(z.string().min(1)),
    /** The `$ref` name of the declared success schema, or `null` when it declares none. */
    responseSchema: z.string().min(1).nullable(),
    /** Property names that schema carries, sorted. Empty when the schema is open or undeclared. */
    responseFields: z.array(z.string().min(1)),
    /** The specification's own one-line summary, or `null` when it declares none. */
    summary: z.string().min(1).nullable(),
    /** Graph's own tags, which are its workload grouping. */
    tags: z.array(z.string().min(1)),
  })
  .strict();

export type Microsoft365OperationCompiledDetail = z.infer<typeof microsoft365OperationCompiledDetailSchema>;

/**
 * What the browser saw one declared PAGE be: whether it was reached at all, what it settled on, and how much
 * of its own traffic the walk actually accounted for.
 *
 * The screenshot is not here — it is a {@link Microsoft365Source} artifact, addressed by digest, because the
 * ruling is that the atlas HOLDS the picture rather than a link to one. `unreachableBecause` is what makes a
 * declared page nobody could open a recorded row rather than a silent absence.
 *
 * @internal
 */
export const microsoft365PageDetailSchema = z
  .object({
    /** Which admin centre this page belongs to, e.g. `entra`, `microsoft365-admin`. */
    console: z.string().min(1),
    /** The address the browser ended on, which a redirect may have changed. */
    finalUrl: z.string().min(1).nullable(),
    /** Whether the client sent this page somewhere other than where it was asked to go. */
    redirected: z.boolean(),
    statusCode: z.number().int().nullable(),
    /** The document title the page settled on. */
    title: z.string(),
    /** Why this declared page is not held, or `null` when it is. */
    unreachableBecause: z.string().min(1).nullable(),
  })
  .strict();

/**
 * What the browser saw one declared page be.
 *
 * @internal
 */
export type Microsoft365PageDetail = z.infer<typeof microsoft365PageDetailSchema>;

/** One channel's independent view of one entity. A successful look replaces only this channel's own detail. */
const microsoft365ChannelEntitySchema = z
  .object({
    channel: z.enum(MICROSOFT365_CHANNELS),
    /** What this channel knows about this entity. Shape depends on the kind — see the detail schemas. */
    detail: z.unknown().nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: microsoft365SourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

export type Microsoft365ChannelEntity = z.infer<typeof microsoft365ChannelEntitySchema>;

/** One tracked entity: a stable identity, plus whatever each channel independently knows about it. */
export const microsoft365AtlasEntitySchema = z
  .object({
    channels: z
      .object({
        api: microsoft365ChannelEntitySchema.nullable(),
        browser: microsoft365ChannelEntitySchema.nullable(),
        compiled: microsoft365ChannelEntitySchema.nullable(),
      })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(MICROSOFT365_KINDS),
    /**
     * The provider's own key: `<METHOD> <path shape>` for an operation, the declared route for a page. This
     * is what the channels are matched on, byte-exactly.
     */
    providerId: z.string().min(1),
  })
  .strict();

export type Microsoft365AtlasEntity = z.infer<typeof microsoft365AtlasEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel. `lastSuccessAt` and
 * `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one timestamp cannot answer
 * "is this still current" after a run that failed following one that succeeded.
 */
const microsoft365CoverageCellSchema = z
  .object({
    artifacts: z.array(microsoft365ArtifactRefSchema),
    channel: z.enum(MICROSOFT365_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.enum(MICROSOFT365_VISIBILITY_SCOPES),
  })
  .strict();

export type Microsoft365CoverageCell = z.infer<typeof microsoft365CoverageCellSchema>;

/** A gap, as stored. This atlas's own condition vocabulary plus kind — see `gaps.ts`. */
const microsoft365AtlasGapSchema = z
  .object({
    condition: z.string().min(1),
    /** Which names the surfaces disagree about. Empty unless the condition is a disagreement. */
    fields: z.array(z.string().min(1)),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(MICROSOFT365_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    /** Which channels this gap concerns. Two, for a disagreement; empty when channel-independent. */
    surfaces: z.array(z.enum(MICROSOFT365_CHANNELS)),
  })
  .strict();

export type Microsoft365AtlasGap = z.infer<typeof microsoft365AtlasGapSchema>;

/** One kind's file on disk. */
export const microsoft365AtlasKindFileSchema = z
  .object({
    coverage: z.array(microsoft365CoverageCellSchema),
    entities: z.array(microsoft365AtlasEntitySchema),
    gaps: z.array(microsoft365AtlasGapSchema),
    kind: z.enum(MICROSOFT365_KINDS),
    platform: z.literal(MICROSOFT365_ATLAS_PLATFORM),
    schemaVersion: z.literal(MICROSOFT365_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type Microsoft365AtlasKindFile = z.infer<typeof microsoft365AtlasKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const microsoft365AtlasKindStatusSchema = z
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

/** @internal */
export type Microsoft365AtlasKindStatus = z.infer<typeof microsoft365AtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const microsoft365AtlasManifestSchema = z
  .object({
    kinds: z.record(z.enum(MICROSOFT365_KINDS), microsoft365AtlasKindStatusSchema),
    platform: z.literal(MICROSOFT365_ATLAS_PLATFORM),
    schemaVersion: z.literal(MICROSOFT365_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type Microsoft365AtlasManifest = z.infer<typeof microsoft365AtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialMicrosoft365Manifest({ updatedAt }: { updatedAt: string }): Microsoft365AtlasManifest {
  const empty: Microsoft365AtlasKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  // `as`: Object.fromEntries widens keys to string; this is built from the exhaustive MICROSOFT365_KINDS, so
  // the narrower kind-keyed type is sound. Same convention as `cloudflare/reset.ts`.
  // oxlint-disable-next-line no-unsafe-type-assertion
  const kinds = Object.fromEntries(MICROSOFT365_KINDS.map((kind) => [kind, empty])) as Record<
    Microsoft365Kind,
    Microsoft365AtlasKindStatus
  >;
  return {
    kinds,
    platform: MICROSOFT365_ATLAS_PLATFORM,
    schemaVersion: MICROSOFT365_ATLAS_SCHEMA_VERSION,
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
export function emptyMicrosoft365KindFile({
  kind,
  updatedAt,
}: {
  kind: Microsoft365Kind;
  updatedAt: string;
}): Microsoft365AtlasKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: MICROSOFT365_ATLAS_PLATFORM,
    schemaVersion: MICROSOFT365_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}
