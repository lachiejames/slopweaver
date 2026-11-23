/**
 * The WorkOS atlas's on-disk vocabulary — the generation that holds BOTH surfaces, and the schemas that
 * refuse to trust it.
 *
 * ## This atlas holds EVERYTHING REACHABLE, entities included
 *
 * Owner's ruling (`docs/atlas-intent/06-holdings.md`): what an atlas holds is per-platform, and the test
 * is whether something better suited already holds that platform's entities. For WorkOS the answer is no.
 * The corpus holds GitHub, Slack, Linear and Notion; the JumpCloud atlas holds an ACCOUNT record saying
 * a person has a WorkOS login, which is a fact about JumpCloud rather than about WorkOS. Nothing here
 * holds a WorkOS organisation, user, SSO connection or directory, so those are kinds here rather than
 * `held-elsewhere` cells pointing somewhere better.
 *
 * ## Six kinds, two of which are the surface MAP and four of which are content
 *
 * `operation` is one (method, path) route measured against the running API; `page` is one dashboard
 * address. Together they are "every endpoint, every method, every parameter … and every page and sub page"
 * (`docs/atlas-intent/02-both-surfaces.md`). `organization`, `user`, `connection` and `directory` are what the API
 * actually holds — the four families its list endpoints return — and they stay empty until a key exists.
 *
 * ## The two channels are NOT symmetrical here, and the atlas has to say so
 *
 * `api` is `api.workos.com`, and it can be mapped with NO credential at all: the running server answers
 * `401` for a route that exists and a distinguishable `404` for one that does not, so the route table is
 * measured rather than asserted (`routeProbe.ts` carries the exact oracle and its one-way limit).
 * `browser` is `dashboard.workos.com`, and it CANNOT: measured, every unauthenticated dashboard
 * path — including a nonsense one — answers the same `307` to `/signin?redirect=<path>`, so the dashboard
 * yields no route oracle to anyone who is not signed in. That asymmetry is why the page map is `compiled`
 * and DECLARED while the walk stays a separate, unfilled surface: one half is evidence and the other is an
 * expectation, and collapsing them would let an address nobody has opened read as a page somebody saw.
 *
 * ## Nothing here holds a credential, by construction
 *
 * A probe verdict is a status code and a classification. A parameter is a NAME the server itself echoed
 * back in a validation body. A page is an address. There is no schema in this file with anywhere to put a
 * key, a client secret, a session token or a Vault value — see `exclusions.ts` on why that is a refusal
 * rather than an omission.
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
export const WORKOS_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — the REST API and the dashboard are two SURFACES of this
 * one atlas, which is the whole point of the kit contract's header.
 */
export const WORKOS_ATLAS_PLATFORM = "workos";

/** The entity kinds this atlas holds. Iterated by the reader, never derived from the directory listing. */
export const WORKOS_ATLAS_KINDS = ["operation", "page", "organization", "user", "connection", "directory"] as const;

export type WorkosAtlasKind = (typeof WORKOS_ATLAS_KINDS)[number];

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what the other already knew.
 */
export const WORKOS_ATLAS_CHANNELS = ["api", "browser"] as const;

export type WorkosAtlasChannel = (typeof WORKOS_ATLAS_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type WorkosEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type WorkosCoverageState = AtlasCoverageState;

/**
 * The claim boundary a coverage cell carries — one per channel, because the two ceilings are unrelated.
 *
 * The API channel's ceiling is an environment: a WorkOS secret key is minted per environment, so a key sees
 * exactly one environment's organisations and users and is blind to every sibling. The browser channel's is
 * a dashboard team role, which spans environments and is granted separately. Neither implies the other —
 * dashboard access through an identity provider's SaaS-management account mints no key at all —
 * so one `visibilityScope` for the atlas would be false about one channel whichever value it took.
 *
 * @internal
 */
export const WORKOS_VISIBILITY_SCOPES = ["api-key-environment", "browser-dashboard-role"] as const;

/**
 * The claim boundary one channel reads under.
 * @internal
 */
export type WorkosVisibilityScope = (typeof WORKOS_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one channel reads under.
 *
 * @param channel the channel that produced the cell
 * @returns that channel's own ceiling
 */
export function workosVisibilityScopeFor({ channel }: { channel: WorkosAtlasChannel }): WorkosVisibilityScope {
  return channel === "api" ? "api-key-environment" : "browser-dashboard-role";
}

const isoSchema = z.iso.datetime();

/** One artifact backing a fact — a dashboard proof screenshot. Kit-owned. */
const workosArtifactRefSchema = atlasArtifactRefSchema;

export type WorkosArtifactRef = z.infer<typeof workosArtifactRefSchema>;

/**
 * Where a record came from, and the link that proves it to a human.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const workosSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(WORKOS_ATLAS_CHANNELS) })
  .strict();

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type WorkosSource = z.infer<typeof workosSourceSchema>;

/**
 * How a deep link was come by. Kit-owned, and read off the source schema rather than restated, so a
 * widening of the kit's own vocabulary cannot leave this atlas quietly declaring a narrower one.
 * @internal
 */
export type WorkosDeepLinkStatus = WorkosSource["deepLinkStatus"];

/**
 * What the running API said about one candidate route, classified.
 *
 * Each member is a DIFFERENT sentence about the platform, which is why this is an enum rather than a
 * boolean over the status code. `routeProbe.ts` owns the mapping and its evidence.
 *
 * - `authenticated` — the route exists and refuses without a key. The ordinary shape of a WorkOS endpoint.
 * - `authenticated-foreign-vocabulary` — the route exists and refuses, in an error vocabulary the rest of
 *   the API does not use. Measured on the Vault family, and worth its own member because it is evidence of
 *   a SECOND service behind one host rather than a quirk.
 * - `validation-echo` — the route exists, takes no credential, and hands back the names of the parameters
 *   it wanted. The only class that yields parameter names with no key at all.
 * - `entity-scoped` — the route exists and is public; what is missing is the entity named in the path.
 * - `redirect` — the route exists and is a browser-facing entry point that redirects rather than answering.
 * - `absent` — this (method, path) pair is not routed. See `routeProbe.ts` on why this proves less than the
 *   others do.
 */
const WORKOS_ROUTE_VERDICTS = [
  "authenticated",
  "authenticated-foreign-vocabulary",
  "validation-echo",
  "entity-scoped",
  "redirect",
  "absent",
] as const;

/** What the running API said about one candidate route. */
export type WorkosRouteVerdict = (typeof WORKOS_ROUTE_VERDICTS)[number];

/** The HTTP methods this atlas probes. A closed set, so a candidate table cannot invent one. */
const WORKOS_HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** One HTTP method this atlas probes. */
export type WorkosHttpMethod = (typeof WORKOS_HTTP_METHODS)[number];

/**
 * What the API surface knows about one route: what it is, what the running server said, and — where the
 * server volunteered them — the parameter names it wanted.
 *
 * `writes` is declared in the candidate table rather than inferred from the method, because WorkOS has
 * read endpoints under `POST` (`/audit_logs/exports` creates an export of existing rows) and the
 * distinction that matters to a reader is whether calling it CHANGES the tenant. It is a fact for a reader
 * to weigh and the atlas never calls any route beyond the probe — see `exclusions.ts`.
 */
const workosOperationApiDetailSchema = z
  .object({
    /** The product family this route belongs to, as the vendor's own documentation groups it. */
    family: z.string().min(1),
    httpMethod: z.enum(WORKOS_HTTP_METHODS),
    /** The path as probed, with `_x`-suffixed placeholders where a real id would go. Never a real id. */
    path: z.string().min(1),
    /** Parameter NAMES the server itself echoed back, sorted. Empty for every verdict but `validation-echo`. */
    declaredParams: z.array(z.string().min(1)),
    /** Whether calling this route changes the tenant. Declared, never called — see `exclusions.ts`. */
    writes: z.boolean(),
    /** The status the probe actually received. Kept beside the verdict so the classification is checkable. */
    statusCode: z.number().int().nonnegative(),
    verdict: z.enum(WORKOS_ROUTE_VERDICTS),
  })
  .strict();

export type WorkosOperationApiDetail = z.infer<typeof workosOperationApiDetailSchema>;

/**
 * What is known about one declared DASHBOARD page: where it is, and — once a walk has run — what was found
 * there.
 *
 * A page row exists from the moment the page is DECLARED, before any browser has been driven, because
 * `docs/atlas-intent/05-browser-proof.md` puts the exact URL first: an agent asked for proof of a WorkOS setting needs
 * the address to open even on an install whose browser surface has never been filled. `reachedAt` being
 * `null` is what distinguishes a declared address from a witnessed one, and the coverage cell says the same
 * thing at the surface level.
 */
const workosPageDetailSchema = z
  .object({
    /** What this page is for, in one line — written here, never scraped from the page. */
    purpose: z.string().min(1),
    /** Whether reaching this page needs a dashboard role above the ordinary member one. */
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

export type WorkosPageDetail = z.infer<typeof workosPageDetailSchema>;

/** What the API knows about one organisation: its name and the domains claimed for it. Filled by a key. */
const workosOrganizationApiDetailSchema = z
  .object({
    /** How many domains the organisation claims. A COUNT — the domains themselves are entity content. */
    domainCount: z.number().int().nonnegative(),
    name: z.string().min(1),
  })
  .strict();

export type WorkosOrganizationApiDetail = z.infer<typeof workosOrganizationApiDetailSchema>;

/** What the API knows about one User Management user. Never a password, a session or a factor secret. */
const workosUserApiDetailSchema = z
  .object({
    emailVerified: z.boolean(),
    /** The organisation ids this user holds a membership in, sorted. */
    organizationIds: z.array(z.string().min(1)),
  })
  .strict();

export type WorkosUserApiDetail = z.infer<typeof workosUserApiDetailSchema>;

/** What the API knows about one SSO connection: which organisation it serves, and what kind it is. */
const workosConnectionApiDetailSchema = z
  .object({
    /** WorkOS's own connection type, e.g. `OktaSAML`, `GoogleOAuth`. A NAME, never a certificate. */
    connectionType: z.string().min(1),
    organizationId: z.string().min(1),
    /** WorkOS's own state for the connection, e.g. `active`, `inactive`. */
    state: z.string().min(1),
  })
  .strict();

export type WorkosConnectionApiDetail = z.infer<typeof workosConnectionApiDetailSchema>;

/** What the API knows about one Directory Sync directory. */
const workosDirectoryApiDetailSchema = z
  .object({
    /** WorkOS's own directory type, e.g. `okta scim v2.0`. A NAME, never an endpoint token. */
    directoryType: z.string().min(1),
    organizationId: z.string().min(1),
    state: z.string().min(1),
  })
  .strict();

export type WorkosDirectoryApiDetail = z.infer<typeof workosDirectoryApiDetailSchema>;

/** One channel's independent view of one entity. A successful look replaces only this channel's own detail. */
const workosChannelEntitySchema = z
  .object({
    channel: z.enum(WORKOS_ATLAS_CHANNELS),
    /** What this channel knows about this entity. Shape depends on the kind — see the detail schemas. */
    detail: z.unknown().nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: workosSourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

export type WorkosChannelEntity = z.infer<typeof workosChannelEntitySchema>;

/** One tracked entity: a stable identity, plus whatever each channel independently knows about it. */
const workosAtlasEntitySchema = z
  .object({
    channels: z
      .object({ api: workosChannelEntitySchema.nullable(), browser: workosChannelEntitySchema.nullable() })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(WORKOS_ATLAS_KINDS),
    /**
     * The provider's own key: `<METHOD> <path>` for an operation, the declared route for a page, and the
     * provider id for a content entity. This is what the two channels are matched on, byte-exactly.
     */
    providerId: z.string().min(1),
  })
  .strict();

export type WorkosAtlasEntity = z.infer<typeof workosAtlasEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel. `lastSuccessAt` and
 * `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one timestamp cannot answer
 * "is this still current" after a run that failed following one that succeeded.
 */
const workosCoverageCellSchema = z
  .object({
    artifacts: z.array(workosArtifactRefSchema),
    channel: z.enum(WORKOS_ATLAS_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable`/`deferred` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.enum(WORKOS_VISIBILITY_SCOPES),
  })
  .strict();

export type WorkosCoverageCell = z.infer<typeof workosCoverageCellSchema>;

/**
 * A gap, as stored. This atlas's own condition vocabulary plus kind — see `gaps.ts`.
 *
 * `fields` and `surfaces` carry the CONTENT of a disagreement: which names one surface has and the other
 * does not, and which two surfaces those were. A disagreement gap without them says only that a
 * disagreement happened, which is a notification rather than a finding.
 */
export const workosAtlasGapSchema = z
  .object({
    condition: z.string().min(1),
    /** Which names the two surfaces disagree about. Empty unless the condition is a disagreement. */
    fields: z.array(z.string().min(1)),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(WORKOS_ATLAS_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    /** Which surfaces this gap concerns. Two, for a disagreement; empty when surface-independent. */
    surfaces: z.array(z.enum(WORKOS_ATLAS_CHANNELS)),
  })
  .strict();

export type WorkosAtlasGap = z.infer<typeof workosAtlasGapSchema>;

/** One kind's file on disk. */
export const workosAtlasKindFileSchema = z
  .object({
    coverage: z.array(workosCoverageCellSchema),
    entities: z.array(workosAtlasEntitySchema),
    gaps: z.array(workosAtlasGapSchema),
    kind: z.enum(WORKOS_ATLAS_KINDS),
    platform: z.literal(WORKOS_ATLAS_PLATFORM),
    schemaVersion: z.literal(WORKOS_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type WorkosAtlasKindFile = z.infer<typeof workosAtlasKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const workosAtlasKindStatusSchema = z
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

/** @internal */
export type WorkosAtlasKindStatus = z.infer<typeof workosAtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const workosAtlasManifestSchema = z
  .object({
    kinds: z.record(z.enum(WORKOS_ATLAS_KINDS), workosAtlasKindStatusSchema),
    platform: z.literal(WORKOS_ATLAS_PLATFORM),
    schemaVersion: z.literal(WORKOS_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type WorkosAtlasManifest = z.infer<typeof workosAtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialWorkosManifest({ updatedAt }: { updatedAt: string }): WorkosAtlasManifest {
  const empty: WorkosAtlasKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  return {
    kinds: {
      connection: empty,
      directory: empty,
      operation: empty,
      organization: empty,
      page: empty,
      user: empty,
    },
    platform: WORKOS_ATLAS_PLATFORM,
    schemaVersion: WORKOS_ATLAS_SCHEMA_VERSION,
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
export function emptyWorkosKindFile({
  kind,
  updatedAt,
}: {
  kind: WorkosAtlasKind;
  updatedAt: string;
}): WorkosAtlasKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: WORKOS_ATLAS_PLATFORM,
    schemaVersion: WORKOS_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}
