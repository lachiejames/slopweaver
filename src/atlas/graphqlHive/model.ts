/**
 * The GraphQL Hive atlas's on-disk vocabulary — the generation that holds BOTH surfaces, and the schemas
 * that refuse to trust it.
 *
 * ## This atlas holds EVERYTHING REACHABLE, entities included
 *
 * Owner's ruling (`docs/atlas-intent/06-holdings.md`): what an atlas holds is per-platform, and the test
 * is whether something better suited already holds that platform's entities. For Hive the answer is no —
 * the corpus holds GitHub, Slack, Linear and Notion, and nothing anywhere holds this organisation's schema
 * registry. So the registry's own organisations, projects and targets are kinds here, not `held-elsewhere`
 * cells pointing somewhere better.
 *
 * ## Six kinds, two of which are the API surface MAP and four of which are content
 *
 * Hive's API is a single GraphQL endpoint, so "every endpoint, every method, every parameter" is the
 * introspected schema rather than a table of paths: `operation` is one root field of `Query`, `Mutation` or
 * `Subscription` with its arguments, and `type` is one named type with its own field names. Together they
 * are the whole callable surface, obtained in one request. `organization`, `project` and `target` are what
 * the registry actually holds, and `page` is the console's browser surface.
 *
 * ## Two channels, and they are matched on a byte-exact provider id
 *
 * `api` is `api.graphql-hive.com/graphql`; `browser` is what the console at `app.graphql-hive.com` calls
 * and shows. An entity's `providerId` is matched byte-exactly across the two, so a thing one channel sees
 * and the other does not is a RECORD rather than a match failure — which is the corroboration output
 * `docs/atlas-intent/04-corroboration.md` asks for.
 *
 * ## The SDL is held as an artifact, never inlined
 *
 * A target's composed schema is the typed surface an end-to-end map would otherwise rediscover, and it is
 * the single most valuable thing in this registry. It is also large. So a `target` carries the SDL's digest
 * and byte length in its detail and the bytes themselves live under `<root>/artifacts/schemas/<sha256>.graphql`,
 * addressed by their own digest — the same shape a page screenshot uses, for the same reason: a proof that
 * depends on a remote fetch still succeeding is not a proof.
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
export const HIVE_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — the registry API and the console are two SURFACES of this
 * one atlas, which is the whole point of the kit contract's header.
 */
export const HIVE_ATLAS_PLATFORM = "graphql-hive";

/** The entity kinds this atlas holds. Iterated by the reader, never derived from the directory listing. */
export const HIVE_ATLAS_KINDS = ["operation", "type", "organization", "project", "target", "page"] as const;

export type HiveAtlasKind = (typeof HIVE_ATLAS_KINDS)[number];

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what the other already knew.
 */
export const HIVE_ATLAS_CHANNELS = ["api", "browser"] as const;

export type HiveAtlasChannel = (typeof HIVE_ATLAS_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type HiveEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type HiveCoverageState = AtlasCoverageState;

/**
 * The claim boundary a coverage cell carries — one per channel, because the two ceilings are unrelated.
 *
 * The API channel sees exactly what the registry access token's own scopes permit. The browser channel sees
 * exactly what the signed-in person's organisation role opens, and a person can reach Hive through an SSO
 * assignment that has nothing to do with any token. Neither implies the other, so one `visibilityScope` for the
 * atlas would be false about one channel whichever value it took.
 *
 * @internal
 */
export const HIVE_VISIBILITY_SCOPES = ["api-token-scopes", "browser-signed-in-role"] as const;

/**
 * The claim boundary one channel reads under.
 * @internal
 */
export type HiveVisibilityScope = (typeof HIVE_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one channel reads under.
 *
 * @param channel the channel that produced the cell
 * @returns that channel's own ceiling
 */
export function hiveVisibilityScopeFor({ channel }: { channel: HiveAtlasChannel }): HiveVisibilityScope {
  return channel === "api" ? "api-token-scopes" : "browser-signed-in-role";
}

const isoSchema = z.iso.datetime();

/** One artifact backing a fact — a proof screenshot, or a composed schema's own bytes. Kit-owned. */
const hiveArtifactRefSchema = atlasArtifactRefSchema;

export type HiveArtifactRef = z.infer<typeof hiveArtifactRefSchema>;

/**
 * Where a record came from, and the link that proves it to a human.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const hiveSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(HIVE_ATLAS_CHANNELS) })
  .strict();

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type HiveSource = z.infer<typeof hiveSourceSchema>;

/**
 * How a deep link was come by. Kit-owned, and read off the source schema rather than restated, so a
 * widening of the kit's own vocabulary cannot leave this atlas quietly declaring a narrower one.
 * @internal
 */
export type HiveDeepLinkStatus = HiveSource["deepLinkStatus"];

/** One argument a root field declares: a name and the rendered GraphQL type it takes. */
const hiveArgumentSchema = z
  .object({
    /** The rendered type, e.g. `String!` or `[TargetReferenceInput!]`. A NAME, never a value. */
    argType: z.string().min(1),
    /** Whether the schema declares a default. The default's VALUE is not kept — see the file header. */
    hasDefault: z.boolean(),
    name: z.string().min(1),
  })
  .strict();

export type HiveArgument = z.infer<typeof hiveArgumentSchema>;

/**
 * What the API surface knows about one operation: everything Hive's own schema states about that root
 * field, reduced to names.
 *
 * `parentType` is `Query`, `Mutation` or `Subscription` — which of the three roots the operation hangs off,
 * and therefore whether calling it reads or writes.
 */
const hiveOperationApiDetailSchema = z
  .object({
    args: z.array(hiveArgumentSchema),
    /** The schema's own one-line description, or `null` when it declares none — never an empty string. */
    description: z.string().min(1).nullable(),
    /** The `@deprecated` reason the schema carries, or `null` when the field is current. */
    deprecationReason: z.string().min(1).nullable(),
    parentType: z.enum(["Query", "Mutation", "Subscription"]),
    /** The rendered return type, e.g. `Project!`. */
    returnType: z.string().min(1),
  })
  .strict();

export type HiveOperationApiDetail = z.infer<typeof hiveOperationApiDetailSchema>;

/**
 * What the API surface knows about one named type: its GraphQL kind and every field name it declares.
 *
 * This is the response-field half of the surface map. `slopweaver atlas graphql-hive read --kind type
 * --query <field>` is what answers "is there any call that hands me this", offline, which is the same
 * question `atlas slack-api --field` answers for a REST provider.
 */
const hiveTypeApiDetailSchema = z
  .object({
    description: z.string().min(1).nullable(),
    /** Every field, input field or enum value name this type declares, sorted. Names only. */
    fields: z.array(z.string().min(1)),
    /** GraphQL's own type kind: `OBJECT`, `INPUT_OBJECT`, `ENUM`, `INTERFACE`, `UNION`, `SCALAR`. */
    typeKind: z.string().min(1),
  })
  .strict();

export type HiveTypeApiDetail = z.infer<typeof hiveTypeApiDetailSchema>;

/** What the registry holds about one organisation: its slug, and how much hangs off it. */
const hiveOrganizationApiDetailSchema = z
  .object({
    projectCount: z.number().int().nonnegative(),
    slug: z.string().min(1),
  })
  .strict();

export type HiveOrganizationApiDetail = z.infer<typeof hiveOrganizationApiDetailSchema>;

/** What the registry holds about one project: its slug, its type, and the organisation above it. */
const hiveProjectApiDetailSchema = z
  .object({
    organizationSlug: z.string().min(1),
    /** Hive's own project type: `SINGLE`, `FEDERATION` or `STITCHING`. */
    projectType: z.string().min(1),
    slug: z.string().min(1),
    targetCount: z.number().int().nonnegative(),
  })
  .strict();

export type HiveProjectApiDetail = z.infer<typeof hiveProjectApiDetailSchema>;

/**
 * What the registry holds about one target — including the composed schema, by reference.
 *
 * The SDL's bytes are an artifact on the {@link HiveSource}, addressed by digest. What is kept inline is
 * enough to answer "is this the schema I already have" without reading the artifact at all.
 */
const hiveTargetApiDetailSchema = z
  .object({
    /** Where this target's gateway is served from, when the registry records one — never a credential. */
    graphqlEndpointUrl: z.url().nullable(),
    organizationSlug: z.string().min(1),
    projectSlug: z.string().min(1),
    /** The digest of the composed SDL's own bytes, or `null` when this target has published no schema. */
    schemaSha256: z.string().length(64).nullable(),
    /** The composed SDL's byte length, so a reader can size it before opening the artifact. */
    schemaByteLength: z.number().int().nonnegative(),
    /** The registry's own id for the latest valid schema version, or `null` when there is none. */
    schemaVersionId: z.string().min(1).nullable(),
    slug: z.string().min(1),
  })
  .strict();

export type HiveTargetApiDetail = z.infer<typeof hiveTargetApiDetailSchema>;

/**
 * What is known about one declared CONSOLE page: where it is, and — once a walk has run — what was found
 * there.
 *
 * A page row exists from the moment the page is DECLARED, before any browser has been driven, because
 * `docs/atlas-intent/05-browser-proof.md` puts the exact URL first: an agent asked for proof of a Hive setting needs the
 * address to open even on an install whose browser surface has never been filled. `reachedAt` being `null`
 * is what distinguishes a declared address from a witnessed one, and the coverage cell says the same thing
 * at the surface level.
 */
const hivePageDetailSchema = z
  .object({
    /** What this page is for, in one line — written here, never scraped from the page. */
    purpose: z.string().min(1),
    /** Whether reaching this page needs an organisation admin role the owner may not hold. */
    needsAdmin: z.boolean(),
    /** The instant a walk actually landed on it, or `null` when only the address is declared. */
    reachedAt: isoSchema.nullable(),
    /** The address the browser ended on, or `null` when no walk has run. */
    finalUrl: z.string().min(1).nullable(),
    /** The document title the page settled on, or `null` when no walk has run. */
    title: z.string().min(1).nullable(),
    /** Why this declared page is not held, or `null` when it is reached or merely not yet attempted. */
    unreachableBecause: z.string().min(1).nullable(),
  })
  .strict();

export type HivePageDetail = z.infer<typeof hivePageDetailSchema>;

/** One channel's independent view of one entity. A successful look replaces only this channel's own detail. */
const hiveChannelEntitySchema = z
  .object({
    channel: z.enum(HIVE_ATLAS_CHANNELS),
    /** What this channel knows about this entity. Shape depends on the kind — see the detail schemas. */
    detail: z.unknown().nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: hiveSourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

export type HiveChannelEntity = z.infer<typeof hiveChannelEntitySchema>;

/** One tracked entity: a stable identity, plus whatever each channel independently knows about it. */
const hiveAtlasEntitySchema = z
  .object({
    channels: z
      .object({ api: hiveChannelEntitySchema.nullable(), browser: hiveChannelEntitySchema.nullable() })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(HIVE_ATLAS_KINDS),
    /**
     * The provider's own key: `<ParentType>.<field>` for an operation, the type name for a type, the
     * slug path for a registry node, and the declared route for a page. This is what the two channels are
     * matched on, byte-exactly.
     */
    providerId: z.string().min(1),
  })
  .strict();

export type HiveAtlasEntity = z.infer<typeof hiveAtlasEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel. `lastSuccessAt` and
 * `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one timestamp cannot answer
 * "is this still current" after a run that failed following one that succeeded.
 */
const hiveCoverageCellSchema = z
  .object({
    artifacts: z.array(hiveArtifactRefSchema),
    channel: z.enum(HIVE_ATLAS_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable`/`deferred` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.enum(HIVE_VISIBILITY_SCOPES),
  })
  .strict();

export type HiveCoverageCell = z.infer<typeof hiveCoverageCellSchema>;

/**
 * A gap, as stored. This atlas's own condition vocabulary plus kind — see `gaps.ts`.
 *
 * `fields` and `surfaces` carry the CONTENT of a disagreement: which names one surface has and the other
 * does not, and which two surfaces those were. A disagreement gap without them says only that a
 * disagreement happened, which is a notification rather than a finding.
 */
export const hiveAtlasGapSchema = z
  .object({
    condition: z.string().min(1),
    /** Which names the two surfaces disagree about. Empty unless the condition is a disagreement. */
    fields: z.array(z.string().min(1)),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(HIVE_ATLAS_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    /** Which surfaces this gap concerns. Two, for a disagreement; empty when surface-independent. */
    surfaces: z.array(z.enum(HIVE_ATLAS_CHANNELS)),
  })
  .strict();

export type HiveAtlasGap = z.infer<typeof hiveAtlasGapSchema>;

/** One kind's file on disk. */
export const hiveAtlasKindFileSchema = z
  .object({
    coverage: z.array(hiveCoverageCellSchema),
    entities: z.array(hiveAtlasEntitySchema),
    gaps: z.array(hiveAtlasGapSchema),
    kind: z.enum(HIVE_ATLAS_KINDS),
    platform: z.literal(HIVE_ATLAS_PLATFORM),
    schemaVersion: z.literal(HIVE_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type HiveAtlasKindFile = z.infer<typeof hiveAtlasKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const hiveAtlasKindStatusSchema = z
  .object({
    /** A digest of the bytes published, so a later half-write is detectable rather than silent. */
    digest: z.string().min(1).nullable(),
    entityCount: z.number().int().nonnegative(),
    lastAttempt: z
      .object({ at: isoSchema, outcome: z.enum(["ok", "failed"]), reasons: z.array(z.string()) })
      .strict()
      .nullable(),
    lastSuccessAt: isoSchema.nullable(),
    // Absent on every manifest written by an older build, so nullish rather than required — see
    // `atlasPermissionBlockSchema` in the kit for why the field exists at all.
    permissionBlocked: atlasPermissionBlockSchema.nullish(),
  })
  .strict();

/** @internal */
export type HiveAtlasKindStatus = z.infer<typeof hiveAtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const hiveAtlasManifestSchema = z
  .object({
    kinds: z.record(z.enum(HIVE_ATLAS_KINDS), hiveAtlasKindStatusSchema),
    platform: z.literal(HIVE_ATLAS_PLATFORM),
    schemaVersion: z.literal(HIVE_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type HiveAtlasManifest = z.infer<typeof hiveAtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialHiveManifest({ updatedAt }: { updatedAt: string }): HiveAtlasManifest {
  const empty: HiveAtlasKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  return {
    kinds: {
      operation: empty,
      organization: empty,
      page: empty,
      project: empty,
      target: empty,
      type: empty,
    },
    platform: HIVE_ATLAS_PLATFORM,
    schemaVersion: HIVE_ATLAS_SCHEMA_VERSION,
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
export function emptyHiveKindFile({ kind, updatedAt }: { kind: HiveAtlasKind; updatedAt: string }): HiveAtlasKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: HIVE_ATLAS_PLATFORM,
    schemaVersion: HIVE_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}
