/**
 * The 1Password atlas's on-disk vocabulary, and the schemas that refuse to trust it.
 *
 * ## Detail is an ALLOWLIST, and that is the whole sensitivity guard
 *
 * The Vanta atlas stores `detail: z.unknown()` — the provider's payload wholesale, minus one excluded
 * field. That is a denylist, and a denylist is exactly wrong for this platform: a field 1Password adds next
 * month lands in the atlas silently, and on this platform the field that lands could be a password.
 *
 * So every kind declares a CLOSED detail schema naming the exact fields it copies, and the provider's raw
 * JSON is parsed THROUGH it. Zod strips unknown keys by default, so an unrecognised field is dropped rather
 * than stored, and there is no code path by which one could arrive. `detail` is never `unknown` here.
 *
 * ## Item titles are not stored, deliberately
 *
 * A vault's item COUNT is held; its items are not, not even their titles. A 1Password item title routinely
 * carries the secret's own subject — an account number, a hostname, a customer name — and neither question
 * this atlas answers ("who can reach this vault", "how many items are in it") needs one. There is no
 * `item` kind and no title field anywhere below; see `inventory.ts`, where the reading verbs that would
 * produce one are absent from a CLOSED command allowlist rather than merely unused.
 *
 * ## Coverage is permanently scoped to what the credential can see
 *
 * Every coverage cell carries a literal `visibilityScope: 'admin-visible'`. 1Password gates the roster to
 * an account holding administrative permissions, so "complete" here always means complete for what this
 * credential's role can reach — never a claim that nothing exists beyond it.
 */
import { z } from "zod";

import { absentAsNull } from "#lib/absent.js";
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
 * The on-disk schema version for the 1Password atlas. Bump only with a real layout change; `store.ts`
 * refuses to read a generation declaring a different version, naming `onepassword reset` as the remedy.
 */
export const ONEPASSWORD_ATLAS_SCHEMA_VERSION = 1;

/** The platform discriminator, written alongside the version so one atlas can never be misread as another's. */
export const ONEPASSWORD_ATLAS_PLATFORM = "onepassword";

/**
 * The seven entity kinds this atlas holds. Iterated by the reader, never derived from the directory
 * listing. Note what is NOT here: there is no `item` kind, and adding one is a decision about this
 * repository's hard lines rather than an increment — see this file's header.
 */
export const ONEPASSWORD_KINDS = [
  "user",
  "group",
  "group-member",
  "vault",
  "vault-grant",
  "integration",
  "event",
] as const;

export type OnepasswordKind = (typeof ONEPASSWORD_KINDS)[number];

/**
 * How a fact was reached.
 *
 * - `admin-cli` — the `op` CLI signed in as an administrative account. The roster's source of record.
 * - `events-api` — 1Password's read-only reporting feed. Structurally incapable of returning item content.
 * - `browser` — the administrative console, driven. Declared and unfilled; see `descriptor.ts`.
 */
export const ONEPASSWORD_CHANNELS = ["admin-cli", "events-api", "browser"] as const;

export type OnepasswordChannel = (typeof ONEPASSWORD_CHANNELS)[number];

/** What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`. */
export type OnepasswordEvidenceRole = AtlasEvidenceRole;

/** How far this atlas has got with one surface, through one channel. Kit-owned and closed. */
export type OnepasswordCoverageState = AtlasCoverageState;

/** The permanent claim boundary every coverage cell carries. See this file's header. */
export const ONEPASSWORD_VISIBILITY_SCOPE = "admin-visible";

const isoSchema = z.iso.datetime();

/*
 * Every provider field declared optional below is optional in 1Password's own contract, and an omitted one is
 * stored as `null` — the schema's declared value for "not sent" (`.nullable().default(null)`), so the stored
 * shape never carries `undefined`. The Events API's published OpenAPI document
 * (https://i.1password.com/media/1password-events-reporting/1password-events-api.yaml) declares NO `required`
 * array on `AuditEvent`, `Session` or `Location`; `op`'s JSON output has no published schema at all, and its
 * reference documents only that a row carries an `id`. So the fields this file REQUIRES (`id`, `name`,
 * `email`, an event's `uuid`/`timestamp`/`action`) are this atlas's own floor — identity and the facts it
 * exists to hold — and a record missing one is refused by `projection.ts` rather than stored half-understood.
 * A vault's `items` count is the one left on its old spelling: it is the fact the vault surface exists to
 * hold, so an omitted one may mean a malformed answer rather than a field not sent, and it stays counted
 * until a refusal for it is decided.
 */

/** A provider timestamp, which 1Password sometimes omits entirely rather than sending null. */
const providerInstantSchema = z.string().min(1).nullable().default(null);

/** A provider string field that may be absent. Stored as `null` when omitted, so the stored shape has no `undefined`. */
const optionalTextSchema = z.string().nullable().default(null);

/** One artifact backing a fact — a proof screenshot, an extracted page. Kit-owned. */
const onepasswordArtifactRefSchema = atlasArtifactRefSchema;

export type OnepasswordArtifactRef = z.infer<typeof onepasswordArtifactRefSchema>;

/**
 * Where a record came from, and the link that proves it to a human.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the same one every atlas carries. The one substitution is this atlas's: it names
 * its acquisition path `channel` rather than the kit's `surface`, matching the Vanta atlas it was ported
 * from, so a reader moving between the two meets one vocabulary.
 */
const onepasswordSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(ONEPASSWORD_CHANNELS) })
  .strict();

export type OnepasswordSource = z.infer<typeof onepasswordSourceSchema>;

/**
 * One coverage cell: what we know about one surface through one channel. `lastSuccessAt` and
 * `latestAttemptFailed` are the freshness inputs `kit/freshness.ts`'s `assessFreshness` needs.
 */
const onepasswordCoverageCellSchema = z
  .object({
    artifacts: z.array(onepasswordArtifactRefSchema),
    channel: z.enum(ONEPASSWORD_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.literal(ONEPASSWORD_VISIBILITY_SCOPE),
  })
  .strict();

export type OnepasswordCoverageCell = z.infer<typeof onepasswordCoverageCellSchema>;

/**
 * One team member, as the administrative surface describes them.
 *
 * Non-strict on purpose, and it is the guard rather than an oversight: this schema PARSES 1Password's own
 * JSON, and Zod strips a key it does not name. Every field a future `op` release adds is dropped here, at
 * the boundary, instead of being stored because nobody thought to exclude it.
 */
export const onepasswordUserDetailSchema = z.object({
  created_at: providerInstantSchema,
  email: z.string().min(1),
  id: z.string().min(1),
  last_auth_at: providerInstantSchema,
  name: z.string().min(1),
  state: optionalTextSchema,
  type: optionalTextSchema,
  updated_at: providerInstantSchema,
});

/** One group. Same allowlist-by-parsing property as {@link onepasswordUserDetailSchema}. */
export const onepasswordGroupDetailSchema = z.object({
  created_at: providerInstantSchema,
  description: optionalTextSchema,
  id: z.string().min(1),
  name: z.string().min(1),
  state: optionalTextSchema,
  type: optionalTextSchema,
  updated_at: providerInstantSchema,
});

/**
 * One vault. `items` is 1Password's own item COUNT for the vault — the atlas's answer to "how big is this"
 * without ever listing what is in it.
 */
export const onepasswordVaultDetailSchema = z.object({
  attribute_version: z.number().int().nullable().default(null),
  content_version: z.number().int().nullable().default(null),
  created_at: providerInstantSchema,
  description: optionalTextSchema,
  id: z.string().min(1),
  items: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((value) => absentAsNull({ value: value })),
  name: z.string().min(1),
  type: optionalTextSchema,
  updated_at: providerInstantSchema,
});

/** One user's membership of one group, and what that membership is worth. */
export const onepasswordGroupMemberDetailSchema = z
  .object({
    group_id: z.string().min(1),
    role: z.string().nullable(),
    user_id: z.string().min(1),
  })
  .strict();

/** Which principal can reach which vault, and with which permissions. */
export const onepasswordVaultGrantDetailSchema = z
  .object({
    permissions: z.array(z.string().min(1)),
    principal_id: z.string().min(1),
    principal_kind: z.enum(["group", "user"]),
    vault_id: z.string().min(1),
  })
  .strict();

/**
 * One integration attached to the account — a Connect server, an Events API integration, a service account.
 * Metadata only: an integration's own TOKEN is never read, and there is no verb in the inventory that
 * would return one.
 */
export const onepasswordIntegrationDetailSchema = z.object({
  created_at: providerInstantSchema,
  id: z.string().min(1),
  integration_kind: z.enum(["connect", "events-api", "service-account"]),
  name: z.string().min(1),
  state: optionalTextSchema,
});

/**
 * One audit event, at the metadata level.
 *
 * Three families of field 1Password returns are deliberately absent, and their absence is this atlas's
 * position rather than an omission: `object_details`/`aux_details`/`aux_info` can carry the acted-on
 * object's own NAME, which for an item is its title; and `location.latitude`/`longitude` pin a named
 * person to a street. Neither is needed to answer what this atlas is for.
 */
export const onepasswordEventDetailSchema = z.object({
  action: z.string().min(1),
  actor_type: optionalTextSchema,
  actor_uuid: optionalTextSchema,
  location: z
    .object({
      city: optionalTextSchema,
      country: optionalTextSchema,
      region: optionalTextSchema,
    })
    .nullable()
    .default(null),
  object_type: optionalTextSchema,
  object_uuid: optionalTextSchema,
  session: z
    .object({
      device_uuid: optionalTextSchema,
      ip: optionalTextSchema,
      login_time: providerInstantSchema,
      uuid: optionalTextSchema,
    })
    .nullable()
    .default(null),
  timestamp: z.string().min(1),
  uuid: z.string().min(1),
});

/**
 * Every shape an entity's `detail` may take — the union a STORED detail is read back through, built from
 * `.strict()` variants of the same schemas.
 *
 * A union rather than `unknown` is the point of this file: `unknown` would admit a password, and a closed
 * set of shapes cannot. `store.ts` validates against this before the first byte of a generation is written,
 * so a projection bug is a refused publish rather than a leak.
 *
 * Two boundaries, deliberately given two different rules. At the PROJECTION the schemas above are permissive
 * by omission: a field they do not name is DROPPED rather than stored, which is the allowlist this atlas is
 * built on. Drift is caught BEFORE them, where a wire answer has a strict boundary — every Events API page
 * goes through `eventsBoundaries.ts`, which refuses a key 1Password adds by name — so permissiveness here
 * decides only what is stored, never what is noticed. At the READ-BACK boundary the input is a file this repo
 * wrote, so its key set is exactly one schema's output — and strictness is what makes the union pick the
 * right member.
 *
 * Without it `z.union` takes the FIRST member that parses, and a vault satisfies the GROUP schema. So every
 * vault came back as a group with `items` — the item COUNT this atlas holds INSTEAD of item titles —
 * silently stripped. Measured on the owner's real generation: every vault lost its count on
 * every read, and the digest disagreement that caused made a perfectly good generation report itself
 * untrusted. `model.test.ts` is the regression, and it also pins the two schemas that were already strict.
 */
const onepasswordDetailSchema = z.union([
  onepasswordUserDetailSchema.strict(),
  onepasswordGroupDetailSchema.strict(),
  onepasswordVaultDetailSchema.strict(),
  onepasswordGroupMemberDetailSchema,
  onepasswordVaultGrantDetailSchema,
  onepasswordIntegrationDetailSchema.strict(),
  onepasswordEventDetailSchema.strict(),
]);

export type OnepasswordDetail = z.infer<typeof onepasswordDetailSchema>;

/** One channel's independent view of one entity. A successful look replaces only this channel's own detail. */
const onepasswordChannelEntitySchema = z
  .object({
    channel: z.enum(ONEPASSWORD_CHANNELS),
    /** The allowlisted projection of the provider's own record. NEVER the raw payload — see the header. */
    detail: onepasswordDetailSchema.nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: onepasswordSourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

export type OnepasswordChannelEntity = z.infer<typeof onepasswordChannelEntitySchema>;

/** One tracked entity: a stable identity, plus whatever each channel independently knows about it. */
const onepasswordEntitySchema = z
  .object({
    channels: z
      .object({
        "admin-cli": onepasswordChannelEntitySchema.nullable(),
        browser: onepasswordChannelEntitySchema.nullable(),
        "events-api": onepasswordChannelEntitySchema.nullable(),
      })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(ONEPASSWORD_KINDS),
    providerId: z.string().min(1),
  })
  .strict();

export type OnepasswordEntity = z.infer<typeof onepasswordEntitySchema>;

/** A gap, as stored. This atlas's own condition vocabulary plus kind/channel — see `gaps.ts`. */
export const onepasswordGapSchema = z
  .object({
    channel: z.enum(ONEPASSWORD_CHANNELS).nullable(),
    condition: z.string().min(1),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(ONEPASSWORD_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
  })
  .strict();

export type OnepasswordGap = z.infer<typeof onepasswordGapSchema>;

/** One kind's file on disk. */
export const onepasswordKindFileSchema = z
  .object({
    coverage: z.array(onepasswordCoverageCellSchema),
    entities: z.array(onepasswordEntitySchema),
    gaps: z.array(onepasswordGapSchema),
    kind: z.enum(ONEPASSWORD_KINDS),
    platform: z.literal(ONEPASSWORD_ATLAS_PLATFORM),
    schemaVersion: z.literal(ONEPASSWORD_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type OnepasswordKindFile = z.infer<typeof onepasswordKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 *
 * @internal
 */
export const onepasswordKindStatusSchema = z
  .object({
    /** A digest of the bytes published, so a later half-write is detectable rather than silent. */
    digest: z.string().min(1).nullable(),
    entityCount: z.number().int().nonnegative(),
    lastAttempt: z
      .object({ at: isoSchema, outcome: z.enum(["ok", "failed"]), reasons: z.array(z.string()) })
      .strict()
      .nullable(),
    lastSuccessAt: isoSchema.nullable(),
    // Absent on an older manifest, so nullish rather than required — see
    // `atlasPermissionBlockSchema` in the kit for why the field exists at all.
    permissionBlocked: atlasPermissionBlockSchema.nullish(),
  })
  .strict();

/**
 * One kind's manifest row.
 *
 * @internal
 */
export type OnepasswordKindStatus = z.infer<typeof onepasswordKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const onepasswordManifestSchema = z
  .object({
    kinds: z.record(z.enum(ONEPASSWORD_KINDS), onepasswordKindStatusSchema),
    platform: z.literal(ONEPASSWORD_ATLAS_PLATFORM),
    schemaVersion: z.literal(ONEPASSWORD_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type OnepasswordManifest = z.infer<typeof onepasswordManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialOnepasswordManifest({ updatedAt }: { updatedAt: string }): OnepasswordManifest {
  const empty: OnepasswordKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  return {
    kinds: {
      event: empty,
      group: empty,
      "group-member": empty,
      integration: empty,
      user: empty,
      vault: empty,
      "vault-grant": empty,
    },
    platform: ONEPASSWORD_ATLAS_PLATFORM,
    schemaVersion: ONEPASSWORD_ATLAS_SCHEMA_VERSION,
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
export function emptyOnepasswordKindFile({
  kind,
  updatedAt,
}: {
  kind: OnepasswordKind;
  updatedAt: string;
}): OnepasswordKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: ONEPASSWORD_ATLAS_PLATFORM,
    schemaVersion: ONEPASSWORD_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}
