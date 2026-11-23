/**
 * The Google Admin atlas's on-disk vocabulary, and the schemas that refuse to trust it.
 *
 * ## This atlas holds the SURFACE MAP, not the entities
 *
 * `docs/atlas-intent/06-holdings.md` makes what an atlas holds a per-platform test: does something better suited
 * already hold this platform's entities? Here the answer is yes on both halves of what the Admin console
 * administers. The corpus holds the people; the Gmail, Drive and Calendar doors hold this account's mail,
 * files and diary, each with its own row and its own OAuth grant. What NOTHING holds is the console
 * itself — which settings pages exist, what each one is called, which API method reaches the same fact,
 * what a caller may ask for and which administrator scope it would have to be granted first.
 *
 * That is the map, and it is the deliverable. Reading it as an entity index is how a fully covered
 * platform ends up looking empty.
 *
 * ## Three channels, because this platform genuinely has three surfaces
 *
 * `discovery` is compiled from the eleven machine-readable documents Google publishes for the APIs behind
 * the Admin console, and it needs no credential at all — it is filled on every install. `admin-api` is
 * the same API actually CALLED, which needs administrator-granted OAuth scopes this installation's grant
 * does not carry. `admin-console` is the walk of `admin.google.com` in the owner's own Chrome. The three
 * are kept apart rather than folded, because what one can reach and another cannot is the finding, and one
 * surface succeeding must never erase what another already knew.
 *
 * ## Nothing here holds an administrator's data
 *
 * An `operation` entity carries NAMES — a method id, a path template, parameter names, response field
 * names, the scopes Google declares. A record SHAPE is not a record: no person, no device, no audit event,
 * nothing that grows with the clock. The whole `discovery` channel is publishable on an install that holds
 * no Google Workspace administrator credential whatsoever, which is exactly what this one is.
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
import { googleAdminEntityDetailSchema } from "./entityDetail.js";

/**
 * The on-disk schema version. Bump only with a real layout change; `store.ts` refuses to read a generation
 * declaring a different version, naming the reset remedy.
 */
export const GOOGLE_ADMIN_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — the published documents, the live Admin APIs and the
 * console are three SURFACES of this one atlas, which is `kit/contract.ts`'s whole header.
 */
export const GOOGLE_ADMIN_ATLAS_PLATFORM = "google-admin";

/**
 * Every kind this atlas publishes a file for.
 *
 * Eighty-two of them are Google's own resource nouns, taken from each discovery document's own `resources`
 * nesting rather than invented — `surfaceNaming.ts` carries the derivation and the one override it needs.
 * `src/__tests__/unit/atlas/googleAdmin/model.test.ts` asserts EXACT equality with the generated registry's
 * kinds, so a document Google grows cannot leave a kind undeclared.
 *
 * There is deliberately NO `operation` kind. The surface map is filed under the resource it maps, so
 * `slopweaver atlas google-admin read --kind directory-users` returns every operation that reaches a user
 * AND Google's own declaration of what a user record is, together.
 *
 * `page` is the eighty-third and it is the only one the compiled channel never fills: it holds what a
 * console walk saw. One entity per route the console LINKED, with its `admin-console` channel filled only
 * on the routes the walk actually opened. The two are deliberately different sets — a linked route is a
 * page this atlas can say EXISTS, which is `docs/atlas-intent/05-browser-proof.md`'s floor, and an opened one is a page
 * it has looked at.
 *
 * A kind here is a DECLARATION, never a claim that anything has been read: each kind's own coverage cell
 * says what actually happened to it.
 */
export const GOOGLE_ADMIN_ATLAS_KINDS = [
  "alertcenter-alerts",
  "alertcenter-alerts-feedback",
  "alertcenter-settings",
  "chrome-management-apps",
  "chrome-management-apps-android",
  "chrome-management-apps-chrome",
  "chrome-management-apps-web",
  "chrome-management-certificate-provisioning-processes",
  "chrome-management-certificate-provisioning-processes-operations",
  "chrome-management-connector-configs",
  "chrome-management-devices",
  "chrome-management-events",
  "chrome-management-notification-configs",
  "chrome-management-operations",
  "chrome-management-profiles",
  "chrome-management-profiles-commands",
  "chrome-management-reports",
  "chrome-management-security-insights",
  "chrome-management-third-party-profile-users",
  "chrome-management-users",
  "chrome-policy-media",
  "chrome-policy-policies",
  "chrome-policy-policies-groups",
  "chrome-policy-policies-networks",
  "chrome-policy-policies-orgunits",
  "chrome-policy-policy-schemas",
  "cloud-identity-allowlisted-domains",
  "cloud-identity-devices",
  "cloud-identity-devices-device-users",
  "cloud-identity-devices-device-users-client-states",
  "cloud-identity-groups",
  "cloud-identity-groups-memberships",
  "cloud-identity-inbound-oidc-sso-profiles",
  "cloud-identity-inbound-saml-sso-profiles",
  "cloud-identity-inbound-saml-sso-profiles-idp-credentials",
  "cloud-identity-inbound-sso-assignments",
  "cloud-identity-policies",
  "cloud-identity-userinvitations",
  "datatransfer-applications",
  "datatransfer-transfers",
  "directory-asps",
  "directory-buildings",
  "directory-calendars",
  "directory-channels",
  "directory-chromeos",
  "directory-chromeos-commands",
  "directory-chromeosdevices",
  "directory-customers",
  "directory-customers-print-servers",
  "directory-customers-printers",
  "directory-domain-aliases",
  "directory-domains",
  "directory-features",
  "directory-groups",
  "directory-groups-aliases",
  "directory-members",
  "directory-mobiledevices",
  "directory-orgunits",
  "directory-privileges",
  "directory-role-assignments",
  "directory-roles",
  "directory-schemas",
  "directory-tokens",
  "directory-two-step-verification",
  "directory-users",
  "directory-users-aliases",
  "directory-users-photos",
  "directory-verification-codes",
  "groups-migration-archive",
  "groups-settings-groups",
  "licensing-license-assignments",
  "page",
  "reports-activities",
  "reports-channels",
  "reports-customer-usage-reports",
  "reports-entity-usage-reports",
  "reports-user-usage-report",
  "vault-matters",
  "vault-matters-exports",
  "vault-matters-holds",
  "vault-matters-holds-accounts",
  "vault-matters-saved-queries",
  "vault-operations",
] as const;

/** One kind this atlas publishes. */
export type GoogleAdminAtlasKind = (typeof GOOGLE_ADMIN_ATLAS_KINDS)[number];

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what another already knew.
 */
export const GOOGLE_ADMIN_ATLAS_CHANNELS = ["discovery", "admin-api", "admin-console"] as const;

/** One channel of this atlas. */
export type GoogleAdminAtlasChannel = (typeof GOOGLE_ADMIN_ATLAS_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type GoogleAdminEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type GoogleAdminCoverageState = AtlasCoverageState;

/**
 * The claim boundary a coverage cell carries — one per channel, because the three ceilings are unrelated.
 *
 * The discovery documents' ceiling is what Google chose to publish, and no credential widens it. The Admin
 * API's is the set of administrator scopes one grant actually carries, which on this platform is decided
 * in the Admin console itself. The console's is what the owner's signed-in session can render, which is
 * bounded by the admin ROLE the signed-in account holds rather than by any scope.
 * @internal
 */
export const GOOGLE_ADMIN_VISIBILITY_SCOPES = [
  "published-documents",
  "granted-admin-scopes",
  "console-admin-roles",
] as const;

/**
 * The claim boundary one channel reads under.
 * @internal
 */
export type GoogleAdminVisibilityScope = (typeof GOOGLE_ADMIN_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one channel reads under.
 *
 * @param channel the channel that produced the cell
 * @returns that channel's own ceiling
 */
export function googleAdminVisibilityScopeFor({
  channel,
}: {
  channel: GoogleAdminAtlasChannel;
}): GoogleAdminVisibilityScope {
  if (channel === "discovery") {
    return "published-documents";
  }
  if (channel === "admin-console") {
    return "console-admin-roles";
  }
  return "granted-admin-scopes";
}

const isoSchema = z.iso.datetime();

/**
 * One artifact backing a fact — a proof screenshot. Kit-owned.
 * @internal
 */
export const googleAdminArtifactRefSchema = atlasArtifactRefSchema;

/**
 * One artifact backing a fact.
 * @internal
 */
export type GoogleAdminArtifactRef = z.infer<typeof googleAdminArtifactRefSchema>;

/**
 * Where a record came from, and the link that proves it to a human.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const googleAdminSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(GOOGLE_ADMIN_ATLAS_CHANNELS) })
  .strict();

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type GoogleAdminSource = z.infer<typeof googleAdminSourceSchema>;

/**
 * What one channel knows about one entity. A channel that has never looked is `null`, never an empty record.
 * @internal
 */
export const googleAdminChannelEntitySchema = z
  .object({
    detail: googleAdminEntityDetailSchema,
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: googleAdminSourceSchema,
    state: z.enum(["observed", "stale"]),
  })
  .strict();

/**
 * What one channel knows about one entity.
 * @internal
 */
export type GoogleAdminChannelEntity = z.infer<typeof googleAdminChannelEntitySchema>;

/**
 * What an entity IS, as a closed enum rather than a shape a reader has to infer.
 *
 * The publish gate in `store.ts` refuses a stored RECORD of a shape-indexed kind, so it has to be able to
 * tell one from an operation, a declared record shape and a console page. Nightfall's model carries the
 * incident that makes this a declared field rather than a `providerId` prefix: a prefix-based gate refused
 * the very generation it was written to protect, because every operation key began with the same word.
 */
export const GOOGLE_ADMIN_ENTITY_FAMILIES = ["operation", "record-shape", "page", "record"] as const;

/**
 * What one entity is.
 * @internal
 */
export type GoogleAdminEntityFamily = (typeof GOOGLE_ADMIN_ENTITY_FAMILIES)[number];

/** One entity, with one slot per channel. */
export const googleAdminAtlasEntitySchema = z
  .object({
    channels: z
      .object({
        "admin-api": googleAdminChannelEntitySchema.nullable(),
        "admin-console": googleAdminChannelEntitySchema.nullable(),
        discovery: googleAdminChannelEntitySchema.nullable(),
      })
      .strict(),
    /**
     * What this entity is — the field the publish gate branches on. See
     * {@link GOOGLE_ADMIN_ENTITY_FAMILIES} for why this is declared rather than inferred.
     */
    family: z.enum(GOOGLE_ADMIN_ENTITY_FAMILIES),
    id: z.string().min(1),
    kind: z.enum(GOOGLE_ADMIN_ATLAS_KINDS),
    /**
     * The provider's own key: `<document>:<id>` for an operation, `shape:<SchemaName>` for a declared
     * record shape, the route for a console page, and Google's own resource name once a live channel
     * carries real records. This is what the channels are matched on, byte-exactly.
     */
    providerId: z.string().min(1),
  })
  .strict();

/** One entity, with one slot per channel. */
export type GoogleAdminAtlasEntity = z.infer<typeof googleAdminAtlasEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel.
 *
 * `lastSuccessAt` and `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one
 * timestamp cannot answer "is this still current" after a run that failed following one that succeeded.
 */
const googleAdminCoverageCellSchema = z
  .object({
    artifacts: z.array(googleAdminArtifactRefSchema),
    channel: z.enum(GOOGLE_ADMIN_ATLAS_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.enum(GOOGLE_ADMIN_VISIBILITY_SCOPES),
  })
  .strict();

/** One coverage cell. */
export type GoogleAdminCoverageCell = z.infer<typeof googleAdminCoverageCellSchema>;

/** A gap, as stored. This atlas's own condition vocabulary plus kind — see `gaps.ts`. */
export const googleAdminAtlasGapSchema = z
  .object({
    condition: z.string().min(1),
    /** The names a gap is ABOUT — an operation, a scope, a page. Empty when the gap names none. */
    fields: z.array(z.string().min(1)),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(GOOGLE_ADMIN_ATLAS_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    surfaces: z.array(z.enum(GOOGLE_ADMIN_ATLAS_CHANNELS)),
  })
  .strict();

/** A gap, as stored. */
export type GoogleAdminAtlasGap = z.infer<typeof googleAdminAtlasGapSchema>;

/** One kind's file on disk. */
export const googleAdminAtlasKindFileSchema = z
  .object({
    coverage: z.array(googleAdminCoverageCellSchema),
    entities: z.array(googleAdminAtlasEntitySchema),
    gaps: z.array(googleAdminAtlasGapSchema),
    kind: z.enum(GOOGLE_ADMIN_ATLAS_KINDS),
    platform: z.literal(GOOGLE_ADMIN_ATLAS_PLATFORM),
    schemaVersion: z.literal(GOOGLE_ADMIN_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

/** One kind's file on disk. */
export type GoogleAdminAtlasKindFile = z.infer<typeof googleAdminAtlasKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const googleAdminAtlasKindStatusSchema = z
  .object({
    digest: z.string().min(1).nullable(),
    entityCount: z.number().int().nonnegative(),
    lastAttempt: z
      .object({ at: isoSchema, outcome: z.enum(["ok", "failed"]), reasons: z.array(z.string()) })
      .strict()
      .nullable(),
    lastSuccessAt: isoSchema.nullable(),
    // Absent on older manifests, so nullish rather than required — see
    // `atlasPermissionBlockSchema` in the kit for why the field exists at all.
    permissionBlocked: atlasPermissionBlockSchema.nullish(),
  })
  .strict();

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export type GoogleAdminAtlasKindStatus = z.infer<typeof googleAdminAtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const googleAdminAtlasManifestSchema = z
  .object({
    kinds: z.record(z.enum(GOOGLE_ADMIN_ATLAS_KINDS), googleAdminAtlasKindStatusSchema),
    platform: z.literal(GOOGLE_ADMIN_ATLAS_PLATFORM),
    schemaVersion: z.literal(GOOGLE_ADMIN_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

/** The manifest. */
export type GoogleAdminAtlasManifest = z.infer<typeof googleAdminAtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * Built by iterating {@link GOOGLE_ADMIN_ATLAS_KINDS} rather than by writing eighty-three literal keys,
 * because a hand-written map whose only content is a repetition of the kind list is a map that silently
 * drifts from it.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialGoogleAdminManifest({ updatedAt }: { updatedAt: string }): GoogleAdminAtlasManifest {
  const empty: GoogleAdminAtlasKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  return {
    kinds: byGoogleAdminKind({ build: () => empty }),
    platform: GOOGLE_ADMIN_ATLAS_PLATFORM,
    schemaVersion: GOOGLE_ADMIN_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}

/**
 * Build one value per declared kind, as a total record.
 *
 * The single place this atlas narrows a built-up object to `Record<GoogleAdminAtlasKind, T>`. It is total
 * by construction — it maps the kind constant itself — but `Object.fromEntries` widens the key back to
 * `string`, which no expression can undo. Concentrating the assertion here rather than repeating it in
 * the manifest builder, the reset and the sync is the point.
 *
 * @param build called once per kind, with the kind it is building for
 * @returns a record with every declared kind present
 */
export function byGoogleAdminKind<T>({
  build,
}: {
  build: (input: { kind: GoogleAdminAtlasKind }) => T;
}): Record<GoogleAdminAtlasKind, T> {
  const entries = GOOGLE_ADMIN_ATLAS_KINDS.map((kind) => [kind, build({ kind })] as const);
  // `as`: built from this atlas's own exhaustive kind list, which `Object.fromEntries` widens to string.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return Object.fromEntries(entries) as Record<GoogleAdminAtlasKind, T>;
}

/**
 * An empty kind file.
 *
 * @param kind the kind this file holds
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty kind file
 */
export function emptyGoogleAdminKindFile({
  kind,
  updatedAt,
}: {
  kind: GoogleAdminAtlasKind;
  updatedAt: string;
}): GoogleAdminAtlasKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: GOOGLE_ADMIN_ATLAS_PLATFORM,
    schemaVersion: GOOGLE_ADMIN_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}

/**
 * An entity whose channels are all empty, ready for one channel to be filled onto it.
 *
 * @returns the empty channel map
 */
export function emptyGoogleAdminChannels(): GoogleAdminAtlasEntity["channels"] {
  return { "admin-api": null, "admin-console": null, discovery: null };
}
