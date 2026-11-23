/**
 * The Nx Cloud atlas's on-disk vocabulary — the generation that holds BOTH surfaces, and the schemas that
 * refuse to trust it.
 *
 * ## This atlas holds EVERYTHING REACHABLE, because nothing else holds it
 *
 * `docs/atlas-intent/06-holdings.md` makes what an atlas holds a per-platform test: does something better suited
 * already hold this platform's entities? For Slack the answer is yes and the atlas maps the interface
 * alone. For Nx Cloud it is no — the world model holds what people SAID about a build, and the repository
 * holds what the build was configured to do, but neither holds what the build actually DID. So the
 * organisation, the workspace and the reachable surface all live here.
 *
 * ## The voluminous families are DECLARED, not stored
 *
 * The same section's one bound: a highly voluminous surface is enumerated and declared rather than stored
 * whole, and the criterion cuts THROUGH a product area rather than along it — a family is voluminous when
 * its records are time-series OBSERVATIONS, emitted by the platform, unbounded, growing with the clock, and
 * identified by an instant rather than by a name somebody chose. CI pipeline executions, runs, tasks and
 * agents are all that; the organisation and the workspace are configuration and are held in full.
 *
 * A {@link NxCloudFamilyDetail} is what "enumerated and declared" means concretely: the family exists, this
 * is the endpoint that serves it, these are the response field names one bounded call returned, and this
 * many records were counted in the window sampled. It is deliberately not a row per record, and it is
 * deliberately not silence either — an atlas that simply omitted them would answer "this platform has no
 * run history", which is false.
 *
 * ## Two channels, and neither may erase the other
 *
 * `web-data` is the first-party HTTP surface reached with the owner's own signed-in session and no browser:
 * React Router loader routes (`<path>.data`) and the JSON resource routes beside them. `browser` is the
 * page walk in the owner's real Chrome — screenshots, the route table the client itself declares, and the calls a
 * page makes while it renders. An entity's `providerId` is matched byte-exactly across the two, so a
 * disagreement is a RECORD rather than an assertion.
 *
 * ## Nothing here holds a credential, and that is enforced rather than intended
 *
 * The loader payloads carry an `ENV` block with a Rollbar access token, a PostHog API key and an Auth0
 * client id, plus an avatar URL and an email hash. `projection.ts` is an allowlist — a field Nx Cloud adds
 * next month is dropped at the boundary rather than stored because nobody thought to exclude it — and
 * `sensitivity.ts` refuses the whole generation rather than redacting one.
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
export const NX_CLOUD_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — the session HTTP surface and the web client are two
 * SURFACES of this one atlas, which is the whole point of the kit contract's header.
 */
export const NX_CLOUD_ATLAS_PLATFORM = "nx-cloud";

/**
 * The entity kinds this atlas holds. Iterated by the reader, never derived from the directory listing.
 *
 * `family` is the kind that carries the voluminous surfaces — see this file's header on why declaring them
 * is content rather than an exclusion.
 */
export const NX_CLOUD_ATLAS_KINDS = ["organization", "workspace", "route", "endpoint", "family"] as const;

export type NxCloudAtlasKind = (typeof NX_CLOUD_ATLAS_KINDS)[number];

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what the other already knew.
 */
export const NX_CLOUD_ATLAS_CHANNELS = ["web-data", "browser"] as const;

export type NxCloudAtlasChannel = (typeof NX_CLOUD_ATLAS_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type NxCloudEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type NxCloudCoverageState = AtlasCoverageState;

/**
 * The claim boundary a coverage cell carries.
 *
 * Both channels present the SAME credential — the owner's signed-in browser session — so unlike the Notion
 * atlas there is one ceiling here rather than a pair, and it is the signed-in session's Nx Cloud role. A
 * workspace member role reads the workspace and is refused its settings page with a 403, so "complete" here
 * can never mean more than what that role sees.
 *
 * @internal
 */
export const NX_CLOUD_VISIBILITY_SCOPES = ["session-member-role"] as const;

/**
 * The claim boundary this atlas reads under.
 *
 * @internal
 */
export type NxCloudVisibilityScope = (typeof NX_CLOUD_VISIBILITY_SCOPES)[number];

const isoSchema = z.iso.datetime();

/** One artifact backing a fact — a proof screenshot. Kit-owned.  *
 * @internal
 */
export const nxCloudArtifactRefSchema = atlasArtifactRefSchema;

/**
 * One artifact backing a fact — a proof screenshot, addressed by the digest of its own bytes.
 *
 * @internal
 */
export type NxCloudArtifactRef = z.infer<typeof nxCloudArtifactRefSchema>;

/**
 * Where a record came from, and the link that proves it to a human.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const nxCloudSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(NX_CLOUD_ATLAS_CHANNELS) })
  .strict();

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type NxCloudSource = z.infer<typeof nxCloudSourceSchema>;

/**
 * What is known about one organisation: its identity, its plan, and the shape of its licence.
 *
 * Every field here is configuration somebody chose, which is why the whole entity is held rather than
 * shape-indexed. `contributorCount` and `currentUsagePercentage` are numbers the platform computes rather
 * than a person authored, but they are single scalars on a configuration record rather than a time series,
 * so holding them costs one number and answers "is CI throttled" without a live call.
 */
const nxCloudOrganizationDetailSchema = z
  .object({
    /** How many contributors the plan currently counts. */
    contributorCount: z.number().int().nonnegative().nullable(),
    /** How much of the plan's credit allowance is consumed, as the platform reports it. */
    currentUsagePercentage: z.number().nullable(),
    /** Whether the organisation is enabled, as the platform reports it. */
    enabled: z.boolean().nullable(),
    /** Whether the signed-in session holds admin on the organisation — the reason a settings page 403s. */
    isAdmin: z.boolean().nullable(),
    /** How many memberships the organisation holds. A COUNT: the members themselves are not held. */
    membershipCount: z.number().int().nonnegative().nullable(),
    name: z.string().min(1),
    /** The plan name the platform reports, e.g. `TEAM`. */
    plan: z.string().min(1).nullable(),
    /** Which VCS provider the organisation is wired to. */
    vcsProvider: z.string().min(1).nullable(),
  })
  .strict();

export type NxCloudOrganizationDetail = z.infer<typeof nxCloudOrganizationDetailSchema>;

/** What is known about one workspace: its identity, the repository it maps, and its access defaults. */
const nxCloudWorkspaceDetailSchema = z
  .object({
    /** The branch CI treats as the baseline, which decides what a comparison is measured against. */
    defaultBranch: z.string().min(1).nullable(),
    /** What a workspace id alone may do, e.g. `READ_ONLY`. */
    idAccessLevel: z.string().min(1).nullable(),
    name: z.string().min(1),
    /** The organisation this workspace belongs to. */
    organizationId: z.string().min(1),
    /** What a personal access token may do, e.g. `READ_ONLY`. */
    patAccessLevel: z.string().min(1).nullable(),
    /** The VCS provider backing the workspace. */
    vcsProvider: z.string().min(1).nullable(),
    /** The repository this workspace maps, as the platform names it — the join to the world model. */
    vcsRepositoryFullName: z.string().min(1).nullable(),
    /** Whether the repository is public, as the platform reports it. */
    vcsRepositoryVisibility: z.string().min(1).nullable(),
  })
  .strict();

export type NxCloudWorkspaceDetail = z.infer<typeof nxCloudWorkspaceDetailSchema>;

/**
 * What is known about one page of the web client: whether it was reached, and what proves it.
 *
 * The screenshot is not here — it is a {@link NxCloudSource} artifact, addressed by digest, because the
 * ruling is that the atlas HOLDS the picture rather than a link to one. `unreachableBecause` is what makes
 * a declared route that 403s a recorded row rather than a silent absence, and Nx Cloud has real ones: the
 * workspace settings page answers 403 to a member role and the organisation settings path does not exist.
 *
 * @internal
 */
export const nxCloudRouteDetailSchema = z
  .object({
    /** How many first-party calls this page caused while it was being walked. */
    callCount: z.number().int().nonnegative(),
    /** Whether every eligible response body was read; false means the walk saw less than it looks like. */
    captureComplete: z.boolean(),
    /** The address the browser ended on, which a redirect may have changed. */
    finalUrl: z.string().min(1).nullable(),
    /** The route id the client's own manifest gave this route, when the walk learned one. */
    manifestRouteId: z.string().min(1).nullable(),
    /** The path PATTERN, parameters as placeholders — `orgs/:orgId/workspaces/:workspaceId/runs`. */
    pathPattern: z.string().min(1),
    /** Whether the client sent this page somewhere other than where it was asked to go. */
    redirected: z.boolean(),
    /** What the walk saw against what it kept, so incompleteness is a number rather than a silence. */
    responseAccounting: z
      .object({
        bodyFailed: z.number().int().nonnegative(),
        bodySucceeded: z.number().int().nonnegative(),
        eligible: z.number().int().nonnegative(),
        seen: z.number().int().nonnegative(),
      })
      .strict(),
    statusCode: z.number().int().nullable(),
    /** The document title the page settled on. */
    title: z.string(),
    /** Why this route is not held, or `null` when it is. */
    unreachableBecause: z.string().min(1).nullable(),
  })
  .strict();

/**
 * What one channel knows about one page of the web client.
 *
 * @internal
 */
export type NxCloudRouteDetail = z.infer<typeof nxCloudRouteDetailSchema>;

/**
 * What is known about one HTTP operation: its shape, and never its payload.
 *
 * `responseFields` are field-name PATHS from `kit/responseShape.ts`, so a 200-row page contributes
 * `runs[].status` once rather than two hundred times, and every value-shaped path segment is redacted
 * before it is stored.
 *
 * @internal
 */
export const nxCloudEndpointDetailSchema = z
  .object({
    /** How many times this operation was observed or called. A frequency, never a payload. */
    callCount: z.number().int().positive(),
    /** The `text/x-script` loader payloads name the route each block belongs to; kept when one was seen. */
    loaderRouteIds: z.array(z.string().min(1)),
    /** Every query parameter NAME observed on this operation, sorted. */
    queryParams: z.array(z.string().min(1)),
    /** Every response field path observed, sorted and redacted. */
    responseFields: z.array(z.string().min(1)),
    /** Which walked routes caused this call, sorted. Empty when the operation was called directly. */
    seenOnRoutes: z.array(z.string().min(1)),
    /** The last HTTP status observed for it. */
    statusCode: z.number().int(),
  })
  .strict();

/**
 * What one channel knows about one HTTP operation — names only, never a payload.
 *
 * @internal
 */
export type NxCloudEndpointDetail = z.infer<typeof nxCloudEndpointDetailSchema>;

/**
 * What is known about one VOLUMINOUS family: that it exists, where it lives, what it returns, and how much
 * of it there is — with not one of its records stored.
 *
 * `windowDescription` and `recordsInWindow` are what stop this being an unfalsifiable claim. "There are
 * runs" is a sentence anybody can write; "one call over this window returned this many records carrying
 * these field names" is a measurement a later run can contradict.
 *
 * @internal
 */
export const nxCloudFamilyDetailSchema = z
  .object({
    /** The endpoint that serves this family, as a path pattern. */
    endpoint: z.string().min(1),
    /** Every response field path one bounded call returned, sorted and redacted. */
    responseFields: z.array(z.string().min(1)),
    /** Why this family is not stored whole, in this atlas's own words. */
    voluminousBecause: z.string().min(1),
    /** How many records the bounded call actually returned, or `null` when the call could not be made. */
    recordsInWindow: z.number().int().nonnegative().nullable(),
    /** What the bounded call asked for — the window, in English. */
    windowDescription: z.string().min(1),
    /** The platform's own count of the whole family, when it reports one. */
    reportedTotal: z.number().int().nonnegative().nullable(),
  })
  .strict();

/**
 * What one channel knows about one voluminous family: its shape and its size, never its rows.
 *
 * @internal
 */
export type NxCloudFamilyDetail = z.infer<typeof nxCloudFamilyDetailSchema>;

/** One channel's independent view of one entity. A successful look replaces only this channel's own detail. */
const nxCloudChannelEntitySchema = z
  .object({
    channel: z.enum(NX_CLOUD_ATLAS_CHANNELS),
    /** What this channel knows about this entity. Shape depends on the kind — see the five detail schemas. */
    detail: z.unknown().nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: nxCloudSourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

export type NxCloudChannelEntity = z.infer<typeof nxCloudChannelEntitySchema>;

/** One tracked entity: a stable identity, plus whatever each channel independently knows about it. */
const nxCloudAtlasEntitySchema = z
  .object({
    channels: z
      .object({
        browser: nxCloudChannelEntitySchema.nullable(),
        "web-data": nxCloudChannelEntitySchema.nullable(),
      })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(NX_CLOUD_ATLAS_KINDS),
    /**
     * The provider's own key: the organisation or workspace id, the route's path PATTERN, `<METHOD> <path
     * pattern>` for an endpoint, and the family's own name. This is what the two channels are matched on,
     * byte-exactly.
     */
    providerId: z.string().min(1),
    /** The workspace or organisation this entity sits under, or `null` for an account-level one. */
    scope: z.string().min(1),
  })
  .strict();

export type NxCloudAtlasEntity = z.infer<typeof nxCloudAtlasEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel. `lastSuccessAt` and
 * `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one timestamp cannot answer
 * "is this still current" after a run that failed following one that succeeded.
 */
const nxCloudCoverageCellSchema = z
  .object({
    artifacts: z.array(nxCloudArtifactRefSchema),
    channel: z.enum(NX_CLOUD_ATLAS_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.enum(NX_CLOUD_VISIBILITY_SCOPES),
  })
  .strict();

export type NxCloudCoverageCell = z.infer<typeof nxCloudCoverageCellSchema>;

/**
 * A gap, as stored. This atlas's own condition vocabulary plus kind — see `gaps.ts`.
 *
 * `fields` and `surfaces` carry the CONTENT of a disagreement: which names one surface has and the other
 * does not, and which two surfaces those were. A disagreement gap without them says only that a
 * disagreement happened, which is a notification rather than a finding.
 */
const nxCloudAtlasGapSchema = z
  .object({
    condition: z.string().min(1),
    /** Which names the two surfaces disagree about. Empty unless the condition is a disagreement. */
    fields: z.array(z.string().min(1)),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(NX_CLOUD_ATLAS_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    /** Which surfaces this gap concerns. Two, for a disagreement; empty when surface-independent. */
    surfaces: z.array(z.enum(NX_CLOUD_ATLAS_CHANNELS)),
  })
  .strict();

export type NxCloudAtlasGap = z.infer<typeof nxCloudAtlasGapSchema>;

/** One kind's file on disk. */
export const nxCloudAtlasKindFileSchema = z
  .object({
    coverage: z.array(nxCloudCoverageCellSchema),
    entities: z.array(nxCloudAtlasEntitySchema),
    gaps: z.array(nxCloudAtlasGapSchema),
    kind: z.enum(NX_CLOUD_ATLAS_KINDS),
    platform: z.literal(NX_CLOUD_ATLAS_PLATFORM),
    schemaVersion: z.literal(NX_CLOUD_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type NxCloudAtlasKindFile = z.infer<typeof nxCloudAtlasKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const nxCloudAtlasKindStatusSchema = z
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

/** @internal */
export type NxCloudAtlasKindStatus = z.infer<typeof nxCloudAtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const nxCloudAtlasManifestSchema = z
  .object({
    kinds: z.record(z.enum(NX_CLOUD_ATLAS_KINDS), nxCloudAtlasKindStatusSchema),
    platform: z.literal(NX_CLOUD_ATLAS_PLATFORM),
    schemaVersion: z.literal(NX_CLOUD_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type NxCloudAtlasManifest = z.infer<typeof nxCloudAtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialNxCloudManifest({ updatedAt }: { updatedAt: string }): NxCloudAtlasManifest {
  const empty: NxCloudAtlasKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  return {
    kinds: { endpoint: empty, family: empty, organization: empty, route: empty, workspace: empty },
    platform: NX_CLOUD_ATLAS_PLATFORM,
    schemaVersion: NX_CLOUD_ATLAS_SCHEMA_VERSION,
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
export function emptyNxCloudKindFile({
  kind,
  updatedAt,
}: {
  kind: NxCloudAtlasKind;
  updatedAt: string;
}): NxCloudAtlasKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: NX_CLOUD_ATLAS_PLATFORM,
    schemaVersion: NX_CLOUD_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}
