/**
 * The Prisma Data Platform atlas's on-disk vocabulary — the generation that holds BOTH surfaces AND the
 * entities, and the schemas that refuse to trust it.
 *
 * ## This atlas holds EVERYTHING REACHABLE
 *
 * `docs/atlas-intent/06-holdings.md` states the test: does something better suited already hold this platform's
 * entities? Here the answer is no, and it is not close. No corpus source ingests Prisma; nothing else in
 * this installation knows that a Prisma workspace, project, database, connection string, backup, bucket,
 * service token or Compute service exists. So this atlas holds them, and `kinds.ts` is the list.
 *
 * The one adjacent store is worth naming rather than leaving for someone to rediscover, because it is what
 * makes the test look closer than it is. The Trelica atlas's SaaS-discovery inventory carries a single row
 * for the VENDOR — a display name, a user count, a review status — discovered through the identity
 * provider. That is a fact about the organisation's software estate, not about anything inside the product.
 * It cannot answer which databases exist, and it is why `gaps.ts` opens a permanent
 * `vendor-inventory-disagreement` gap instead of this atlas quietly deferring to it.
 *
 * Today every entity kind is empty for want of a credential, which is a state each of them SAYS rather than
 * a silence — see `sync.ts` on why twenty-three `not-configured` cells are the point rather than an
 * omission.
 *
 * ## Two channels, and this platform splits them unusually
 *
 * `api` is everything reached over HTTP with no browser: the management API's declared surface, what an
 * unauthenticated probe established about it, and the authorization server on `auth.prisma.io`. `browser`
 * is `console.prisma.io`.
 *
 * The asymmetry runs the OPPOSITE way from Figma's, and that is worth stating because it decides what a
 * walk is for here. On Figma the API cannot enumerate its own root and the browser is the only way in. On
 * Prisma the API is complete — every operation confirmed against the live service — and the BROWSER is the
 * side that cannot be mapped at all without signing in: `consoleRoutes.ts` measures a console whose every
 * path, real or invented, answers one sign-in redirect. So the two channels are modelled independently for
 * the usual reason (one succeeding must never erase what the other knew) and the walk that fills `browser`
 * is the one that has everything left to discover.
 *
 * ## The two ceilings are unrelated, so a coverage cell carries whichever one produced it
 *
 * The API channel sees what its credential's TYPE allows — Prisma issues three (`oauth`, `service_token`,
 * `management_token`, per `GET /v1/me`) and a service token never expires while an access token lasts an
 * hour. The browser channel sees what the signed-in person's own workspace role opens. Neither implies the
 * other, so one `visibilityScope` for the atlas would be false about one channel whichever value it took.
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
import { PRISMA_DATA_PLATFORM_ATLAS_KINDS, type PrismaDataPlatformAtlasKind } from "./kinds.js";

/**
 * The on-disk schema version. Bump only with a real layout change; `store.ts` refuses to read a generation
 * declaring a different version, naming the reset remedy.
 */
export const PRISMA_DATA_PLATFORM_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — the management API, the authorization server and the
 * console are three SURFACES of this one atlas, which is the whole point of the kit contract's header.
 */
export const PRISMA_DATA_PLATFORM_ATLAS_PLATFORM = "prisma-data-platform";

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what the other already knew.
 */
export const PRISMA_DATA_PLATFORM_ATLAS_CHANNELS = ["api", "browser"] as const;

/** How a fact was reached. */
export type PrismaDataPlatformAtlasChannel = (typeof PRISMA_DATA_PLATFORM_ATLAS_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type PrismaDataPlatformEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type PrismaDataPlatformCoverageState = AtlasCoverageState;

/**
 * The claim boundary a coverage cell carries — one per channel, because the two ceilings are unrelated.
 * @internal
 */
export const PRISMA_DATA_PLATFORM_VISIBILITY_SCOPES = ["api-credential-type", "browser-signed-in-role"] as const;

/**
 * The claim boundary one channel reads under.
 * @internal
 */
export type PrismaDataPlatformVisibilityScope = (typeof PRISMA_DATA_PLATFORM_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one channel reads under.
 *
 * @param channel the channel that produced the cell
 * @returns that channel's own ceiling
 */
export function prismaDataPlatformVisibilityScopeFor({
  channel,
}: {
  channel: PrismaDataPlatformAtlasChannel;
}): PrismaDataPlatformVisibilityScope {
  return channel === "api" ? "api-credential-type" : "browser-signed-in-role";
}

const isoSchema = z.iso.datetime();

/**
 * One artifact backing a fact — a proof screenshot. Kit-owned.
 * @internal
 */
export const prismaDataPlatformArtifactRefSchema = atlasArtifactRefSchema;

/** One artifact backing a fact. */
export type PrismaDataPlatformArtifactRef = z.infer<typeof prismaDataPlatformArtifactRefSchema>;

/**
 * Where a record came from, and the link that proves it to a human.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const prismaDataPlatformSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(PRISMA_DATA_PLATFORM_ATLAS_CHANNELS) })
  .strict();

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type PrismaDataPlatformSource = z.infer<typeof prismaDataPlatformSourceSchema>;

/**
 * What the API surface knows about one operation: everything the pinned document states about it, reduced
 * to names, plus what an unauthenticated probe established and what this atlas decided to DO with it.
 *
 * `disposition` and `probeEvidence` are on the stored entity rather than only in the generated registry
 * because a reader asking the atlas "can you tell me about the build log" needs "yes, and only its shape,
 * and the route is confirmed to exist" from the atlas itself — not from two source files they would have to
 * go and read.
 * @internal
 */
export const prismaMethodApiDetailSchema = z
  .object({
    /** Every credential form the document says this operation accepts, sorted. */
    authMethods: z.array(z.string().min(1)),
    /** Whether the document marks this operation deprecated. Still served, and still in the registry. */
    deprecated: z.boolean(),
    disposition: z.enum(["entity", "shape-index", "probe-only", "excluded"]),
    /** Why the disposition is not a plain `entity`. `null` only when it is one. */
    dispositionBecause: z.string().min(1).nullable(),
    /** The docs page for this operation, or `null` when Prisma publishes none — see `surfaceRow.ts`. */
    docsUrl: z.url().nullable(),
    /** Which refusal applied. `null` unless the disposition is `excluded`. */
    exclusionReason: z.enum(["mutating", "not-enumerable"]).nullable(),
    method: z.string().min(1),
    /** How a caller walks a result set larger than one response. */
    paging: z.string().min(1),
    /** The document's own path template, `{brace}` parameters intact. */
    path: z.string().min(1),
    /** What an unauthenticated request established about this route — see `apiProbe.ts`. */
    probeEvidence: z.string().min(1),
    /** How many distinct response field paths the document declares across every status code. */
    responseFieldCount: z.number().int().nonnegative(),
    /** Every OAuth scope the document says this operation requires, sorted. */
    scopes: z.array(z.string().min(1)),
    /** Prisma's own `x-prisma-stability`, with its absence named `stable`. */
    stability: z.enum(["stable", "experimental"]),
    /** Prisma's own one-line summary, or `null` when it publishes none. */
    summary: z.string().min(1).nullable(),
    /** Prisma's own first tag, kept so the provider's vocabulary stays greppable beside ours. */
    tag: z.string().min(1),
  })
  .strict();

/** What the API surface knows about one operation. */
export type PrismaMethodApiDetail = z.infer<typeof prismaMethodApiDetailSchema>;

/*
 * There is deliberately NO browser-walk detail schema here, and its absence is the point rather than an
 * omission waiting to be filled.
 *
 * The Notion and Vanta atlases each declare one, because each ships a walk that produces one. This atlas
 * ships no walk: this installation holds no Prisma credential and the work profile is not signed in to the
 * console, so a walk would photograph the sign-in page. Declaring the shape a walk WOULD write would be a
 * contract nothing has ever satisfied, and `kit/pageObservation.ts` already owns that shape for the atlases
 * that DO walk — which is the right home for it and also why declaring a local one here would be wrong
 * twice over.
 *
 * The `browser` channel is still real and still stores a detail: `projection.ts` writes what the signed-out
 * probe and the application's own route manifest established. `detail` is `unknown` on the channel entity,
 * so that needs no schema of its own, and the day a walk exists its shape is designed against a real
 * capture rather than guessed at here.
 */

/**
 * One channel's independent view of one entity. A successful look replaces only this channel's own detail.
 * @internal
 */
export const prismaChannelEntitySchema = z
  .object({
    channel: z.enum(PRISMA_DATA_PLATFORM_ATLAS_CHANNELS),
    /** What this channel knows about this entity. Shape depends on the kind — see the detail schemas. */
    detail: z.unknown().nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: prismaDataPlatformSourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

/** One channel's independent view of one entity. */
export type PrismaChannelEntity = z.infer<typeof prismaChannelEntitySchema>;

/**
 * One tracked entity: a stable identity, plus whatever each channel independently knows about it.
 * @internal
 */
export const prismaDataPlatformEntitySchema = z
  .object({
    channels: z
      .object({ api: prismaChannelEntitySchema.nullable(), browser: prismaChannelEntitySchema.nullable() })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(PRISMA_DATA_PLATFORM_ATLAS_KINDS),
    /**
     * The provider's own key: `<METHOD> <path template>` for a method, the declared route for a console
     * route, the path for an authorization endpoint, and Prisma's own prefixed identifier for an entity —
     * `wksp_…`, `proj_…`, `con_…`. This is what the two channels are matched on, byte-exactly.
     */
    providerId: z.string().min(1),
    /**
     * Which workspace, project or branch this entity sits under, so a reader can filter without decoding a
     * provider id. `null` for a platform-level row — a method, a console route, an authorization endpoint.
     */
    scope: z.string().min(1).nullable(),
  })
  .strict();

/** One tracked entity. */
export type PrismaDataPlatformEntity = z.infer<typeof prismaDataPlatformEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel. `lastSuccessAt` and
 * `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one timestamp cannot answer
 * "is this still current" after a run that failed following one that succeeded.
 * @internal
 */
export const prismaCoverageCellSchema = z
  .object({
    artifacts: z.array(prismaDataPlatformArtifactRefSchema),
    channel: z.enum(PRISMA_DATA_PLATFORM_ATLAS_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.enum(PRISMA_DATA_PLATFORM_VISIBILITY_SCOPES),
  })
  .strict();

/** One coverage cell. */
export type PrismaCoverageCell = z.infer<typeof prismaCoverageCellSchema>;

/**
 * A gap, as stored. This atlas's own condition vocabulary plus kind — see `gaps.ts`.
 *
 * `fields` and `surfaces` carry the CONTENT of a disagreement: which names or values the two surfaces
 * disagree about, and which two surfaces those were. A disagreement gap without them says only that a
 * disagreement happened, which is a notification rather than a finding.
 * @internal
 */
export const prismaDataPlatformGapSchema = z
  .object({
    condition: z.string().min(1),
    /** Which names the two surfaces disagree about. Empty unless the condition is a disagreement. */
    fields: z.array(z.string().min(1)),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(PRISMA_DATA_PLATFORM_ATLAS_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    /** Which channels this gap concerns. Two, for a disagreement; empty when channel-independent. */
    surfaces: z.array(z.enum(PRISMA_DATA_PLATFORM_ATLAS_CHANNELS)),
  })
  .strict();

/** A gap, as stored. */
export type PrismaDataPlatformGap = z.infer<typeof prismaDataPlatformGapSchema>;

/** One kind's file on disk. */
export const prismaDataPlatformKindFileSchema = z
  .object({
    coverage: z.array(prismaCoverageCellSchema),
    entities: z.array(prismaDataPlatformEntitySchema),
    gaps: z.array(prismaDataPlatformGapSchema),
    kind: z.enum(PRISMA_DATA_PLATFORM_ATLAS_KINDS),
    platform: z.literal(PRISMA_DATA_PLATFORM_ATLAS_PLATFORM),
    schemaVersion: z.literal(PRISMA_DATA_PLATFORM_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

/** One kind's file on disk. */
export type PrismaDataPlatformKindFile = z.infer<typeof prismaDataPlatformKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const prismaDataPlatformKindStatusSchema = z
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
export type PrismaDataPlatformKindStatus = z.infer<typeof prismaDataPlatformKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const prismaDataPlatformManifestSchema = z
  .object({
    kinds: z.record(z.enum(PRISMA_DATA_PLATFORM_ATLAS_KINDS), prismaDataPlatformKindStatusSchema),
    platform: z.literal(PRISMA_DATA_PLATFORM_ATLAS_PLATFORM),
    schemaVersion: z.literal(PRISMA_DATA_PLATFORM_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

/** The manifest. */
export type PrismaDataPlatformManifest = z.infer<typeof prismaDataPlatformManifestSchema>;

/** A never-synced status, shared by every kind in a fresh manifest. */
const NEVER_SYNCED: PrismaDataPlatformKindStatus = {
  digest: null,
  entityCount: 0,
  lastAttempt: null,
  lastSuccessAt: null,
};

/**
 * One value per kind, with every key spelled out so the COMPILER checks the record is complete.
 *
 * The obvious spelling is `Object.fromEntries(PRISMA_DATA_PLATFORM_ATLAS_KINDS.map(…))`, and it needs a type
 * assertion to become a `Record<PrismaDataPlatformAtlasKind, T>` because `fromEntries` returns a
 * `Record<string, T>`. That assertion is exactly what `no-unsafe-type-assertion` refuses, and refuses
 * correctly: it would claim completeness rather than establish it, and the manifest's `kinds` is a
 * `z.record`, so a missing key is not a parse error either. Nothing would have caught a kind that stopped
 * being initialised.
 *
 * Twenty-six keys is the price of the compiler doing that check, and `atlasHome.ts` pays the same price for
 * the same reason on the same list. Adding a kind fails to compile HERE, which is where it should.
 *
 * @param value what to store under each kind, called once per kind
 * @returns the complete record
 */
function prismaKindRecord<T>({
  value,
}: {
  value: (kind: PrismaDataPlatformAtlasKind) => T;
}): Record<PrismaDataPlatformAtlasKind, T> {
  return {
    account: value("account"),
    branch: value("branch"),
    bucket: value("bucket"),
    "bucket-key": value("bucket-key"),
    build: value("build"),
    connection: value("connection"),
    "console-route": value("console-route"),
    "custom-domain": value("custom-domain"),
    database: value("database"),
    "database-backup": value("database-backup"),
    "database-usage": value("database-usage"),
    deployment: value("deployment"),
    "environment-variable": value("environment-variable"),
    "event-shape": value("event-shape"),
    "iac-state": value("iac-state"),
    integration: value("integration"),
    method: value("method"),
    "oauth-endpoint": value("oauth-endpoint"),
    project: value("project"),
    region: value("region"),
    "scm-installation": value("scm-installation"),
    service: value("service"),
    "service-token": value("service-token"),
    "source-repository": value("source-repository"),
    subscription: value("subscription"),
    workspace: value("workspace"),
  };
}

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialPrismaDataPlatformManifest({ updatedAt }: { updatedAt: string }): PrismaDataPlatformManifest {
  return {
    kinds: prismaKindRecord({ value: () => NEVER_SYNCED }),
    platform: PRISMA_DATA_PLATFORM_ATLAS_PLATFORM,
    schemaVersion: PRISMA_DATA_PLATFORM_ATLAS_SCHEMA_VERSION,
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
export function emptyPrismaDataPlatformKindFile({
  kind,
  updatedAt,
}: {
  kind: PrismaDataPlatformAtlasKind;
  updatedAt: string;
}): PrismaDataPlatformKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: PRISMA_DATA_PLATFORM_ATLAS_PLATFORM,
    schemaVersion: PRISMA_DATA_PLATFORM_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}

/**
 * The kind file a run starts from: the one the store held, or an empty one stamped `updatedAt` for a kind
 * that has never been published.
 *
 * @param stored the file the store held for this kind, `null` when it held none
 * @param kind the kind this file holds
 * @param updatedAt the ISO timestamp an empty file is stamped with
 * @returns the stored file, or a valid empty one
 */
export function heldPrismaDataPlatformKindFile({
  stored,
  kind,
  updatedAt,
}: {
  stored: PrismaDataPlatformKindFile | null;
  kind: PrismaDataPlatformAtlasKind;
  updatedAt: string;
}): PrismaDataPlatformKindFile {
  if (stored === null) {
    return emptyPrismaDataPlatformKindFile({ kind, updatedAt });
  }
  return stored;
}

/**
 * The manifest a run starts from: the one the store held, or a never-synced one stamped `updatedAt` for a
 * generation that has never been published.
 *
 * @param manifest the manifest the store held, `null` when it held none
 * @param updatedAt the ISO timestamp a fresh manifest is stamped with
 * @returns the stored manifest, or a valid fresh one
 */
export function heldPrismaDataPlatformManifest({
  manifest,
  updatedAt,
}: {
  manifest: PrismaDataPlatformManifest | null;
  updatedAt: string;
}): PrismaDataPlatformManifest {
  if (manifest === null) {
    return initialPrismaDataPlatformManifest({ updatedAt });
  }
  return manifest;
}

/**
 * An empty file for every kind, so a freshly installed generation is complete rather than partial.
 *
 * @param at the ISO timestamp to stamp
 * @returns one empty file per kind
 */
export function emptyPrismaDataPlatformKindFiles({
  at,
}: {
  at: string;
}): Readonly<Record<PrismaDataPlatformAtlasKind, PrismaDataPlatformKindFile>> {
  return prismaKindRecord({ value: (kind) => emptyPrismaDataPlatformKindFile({ kind, updatedAt: at }) });
}
