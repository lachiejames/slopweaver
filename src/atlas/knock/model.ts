/**
 * The Knock atlas's on-disk vocabulary — the generation that holds BOTH surfaces AND the entities, and the
 * schemas that refuse to trust it.
 *
 * ## This atlas holds EVERYTHING REACHABLE
 *
 * `docs/atlas-intent/06-holdings.md` states the test: does something better suited already hold this platform's
 * entities? Here the answer is no, and it is not close. No corpus source ingests Knock; nothing else in
 * this installation knows that a Knock workflow, guide, broadcast, channel, environment, commit, branch or
 * recipient exists. So this atlas holds them, and `kinds.ts` is the list.
 *
 * Every entity kind is EMPTY today, and the reason is a credential rather than Knock: this installation
 * holds neither a data-API key nor a Management API service token, and the one surface that reads either
 * without one — the dashboard's own `/settings/api-keys` and `/settings/service-tokens` pages — is
 * browser-only. Each kind therefore carries a `not-configured` cell naming what would fill it, because a
 * kind that is empty for want of a token and a kind that is empty because the account holds nothing are the
 * same file with opposite meanings.
 *
 * ## Two channels, and this platform splits them along an unusually sharp line
 *
 * `api` is everything reached over HTTP with no browser: both published OpenAPI documents, and what an
 * unauthenticated probe established about them. `browser` is `dashboard.knock.app`.
 *
 * The line between them is not a matter of degree here. MEASURED from the dashboard's own route
 * table: **19 of the 57 pages a walk visits display something no declared operation reads at all**, and
 * they are not marginal pages — the Agents workspace is the first item in the product's own navigation, and
 * the audit log, the API keys and the service tokens are the three surfaces a security question reaches for
 * first. `docs/atlas-intent/02-both-surfaces.md`'s *"things via the browser you can't get by API"* is a third of this
 * platform's product surfaces rather than an edge case, which is why the browser channel is modelled as an
 * independent, equal peer rather than as a corroboration pass.
 *
 * ## The two ceilings are unrelated, so a coverage cell carries whichever one produced it
 *
 * The API channel sees what its credential's TYPE and environment allow — a data-API key is scoped to one
 * environment and a Management API service token to the whole account. The browser channel sees what the
 * signed-in member's own role opens. Neither implies the other, so one `visibilityScope` for the atlas
 * would be false about one channel whichever value it took.
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
import { KNOCK_ATLAS_KINDS, type KnockAtlasKind } from "./kinds.js";
import { KNOCK_APIS, KNOCK_HTTP_METHODS, KNOCK_PAGING_SHAPES } from "./surfaceNaming.js";

/**
 * The on-disk schema version. Bump only with a real layout change; `store.ts` refuses to read a generation
 * declaring a different version, naming the reset remedy.
 */
export const KNOCK_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — the data API, the Management API and the dashboard are
 * three SURFACES of this one atlas, which is the whole point of the kit contract's header.
 */
export const KNOCK_ATLAS_PLATFORM = "knock";

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what the other already knew.
 */
export const KNOCK_ATLAS_CHANNELS = ["api", "browser"] as const;

/** How a fact was reached. */
export type KnockAtlasChannel = (typeof KNOCK_ATLAS_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type KnockEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type KnockCoverageState = AtlasCoverageState;

/**
 * The claim boundary a coverage cell carries — one per channel, because the two ceilings are unrelated.
 * @internal
 */
export const KNOCK_VISIBILITY_SCOPES = ["api-credential-scope", "browser-signed-in-role"] as const;

/**
 * The claim boundary one channel reads under.
 * @internal
 */
export type KnockVisibilityScope = (typeof KNOCK_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one channel reads under.
 *
 * @param channel the channel that produced the cell
 * @returns that channel's own ceiling
 */
export function knockVisibilityScopeFor({ channel }: { channel: KnockAtlasChannel }): KnockVisibilityScope {
  return channel === "api" ? "api-credential-scope" : "browser-signed-in-role";
}

const isoSchema = z.iso.datetime();

/**
 * One artifact backing a fact — a proof screenshot. Kit-owned.
 * @internal
 */
export const knockArtifactRefSchema = atlasArtifactRefSchema;

/** One artifact backing a fact. */
export type KnockArtifactRef = z.infer<typeof knockArtifactRefSchema>;

/**
 * Where a record came from, and the link that proves it to a human.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const knockSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(KNOCK_ATLAS_CHANNELS) })
  .strict();

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type KnockSource = z.infer<typeof knockSourceSchema>;

/**
 * What the API surface knows about one operation: everything the pinned documents state about it, reduced
 * to names, plus what an unauthenticated probe established and what this atlas decided to DO with it.
 *
 * `disposition` and `identifierFrom` are on the stored entity rather than only in the generated registry
 * because a reader asking the atlas "can you list this account's object collections" needs "no, and here is
 * the operation, and here is why nothing can" from the atlas itself — not from two source files they would
 * have to go and read.
 * @internal
 */
export const knockMethodApiDetailSchema = z
  .object({
    api: z.enum(KNOCK_APIS),
    /** Whether the document marks this operation deprecated. Still served, and still in the registry. */
    deprecated: z.boolean(),
    disposition: z.enum(["entity", "shape-index", "probe-only", "excluded"]),
    /** Why the disposition is not a plain `entity`. `null` only when it is one. */
    dispositionBecause: z.string().min(1).nullable(),
    /** Whether the operation takes an `environment` query parameter rather than inheriting one. */
    environmentScoped: z.boolean(),
    /** Which refusal applied. `null` unless the disposition is `excluded`. */
    exclusionReason: z.enum(["mutating", "not-enumerable"]).nullable(),
    /** Where this operation's path identifiers come from — see `surfaceRow.ts`. */
    identifierFrom: z.enum(["none", "same-api", "other-api", "unavailable"]),
    method: z.enum(KNOCK_HTTP_METHODS),
    /** Knock's own `operationId`, carried as a label. Not unique on the data API — see `surfaceRow.ts`. */
    operationId: z.string().min(1),
    /** How a caller walks a result set larger than one response. */
    paging: z.enum(KNOCK_PAGING_SHAPES),
    /** The document's own path template, `{brace}` parameters intact. */
    path: z.string().min(1),
    /** What an unauthenticated request established about this route — see `apiProbe.ts`. */
    probeEvidence: z.string().min(1),
    /** How many distinct response field paths the document declares for this operation's success response. */
    responseFieldCount: z.number().int().nonnegative(),
    /** Knock's own one-line summary, or `null` when it publishes none. */
    summary: z.string().min(1).nullable(),
    /** Knock's own first tag, kept so the provider's vocabulary stays greppable beside ours. */
    tag: z.string().min(1),
  })
  .strict();

/** What the API surface knows about one operation. */
export type KnockMethodApiDetail = z.infer<typeof knockMethodApiDetailSchema>;

/**
 * What is known about one dashboard route, before a walk has ever visited it.
 *
 * Filled from the dashboard's own build manifest, which needs no credential, so a `dashboard-route` entity
 * exists for every route whether or not a walk has reached it. A walk REPLACES this channel's detail with
 * {@link knockPageBrowserDetailSchema}; the two are separate shapes on purpose, because "the application
 * declares this route" and "the browser reached this page" are different claims and collapsing them would
 * let an unvisited route look photographed.
 * @internal
 */
export const knockRouteApiDetailSchema = z
  .object({
    /** Whether any operation this atlas would CALL reads the thing this page displays. */
    apiBacked: z.boolean(),
    /** The atlas kind the page displays, or `null` when no kind covers it. */
    kind: z.string().min(1).nullable(),
    /** Every `[bracket]` parameter the route pattern declares, in path order. */
    parameters: z.array(z.string().min(1)),
    scope: z.enum(["account", "environment", "auth", "integration", "internal"]),
    /** Whether a walk can address this page from a signed-in session alone. */
    walkable: z.boolean(),
  })
  .strict();

/** What the route table knows about one dashboard route. */
export type KnockRouteApiDetail = z.infer<typeof knockRouteApiDetailSchema>;

/**
 * What a walk observed on one dashboard page.
 *
 * `observedCalls` holds the first-party requests the page's own client made, reduced to a method, a
 * redacted wire path and the response's field NAMES — never a value. `browserReduction.ts` is that
 * redaction and it is committed so a reviewer can read it rather than trust it.
 * @internal
 */
export const knockPageBrowserDetailSchema = z
  .object({
    /** Whether the browser settled somewhere other than where it was asked to go. */
    redirected: z.boolean(),
    observedCalls: z.array(
      z
        .object({
          api: z.enum(KNOCK_APIS).nullable(),
          host: z.string().min(1),
          method: z.string().min(1),
          responseFields: z.array(z.string().min(1)),
          statusCode: z.number().int(),
          wirePath: z.string().min(1),
        })
        .strict(),
    ),
    /** The page's own `<title>`, which names the section without naming the account. */
    title: z.string().nullable(),
    /** Why this page is not held, or `null` when it was reached. */
    unreachableBecause: z.string().min(1).nullable(),
  })
  .strict();

/** What a walk observed on one dashboard page. */
export type KnockPageBrowserDetail = z.infer<typeof knockPageBrowserDetailSchema>;

/**
 * One channel's independent view of one entity. A successful look replaces only this channel's own detail.
 * @internal
 */
export const knockChannelEntitySchema = z
  .object({
    channel: z.enum(KNOCK_ATLAS_CHANNELS),
    /** What this channel knows about this entity. Shape depends on the kind — see the detail schemas. */
    detail: z.unknown().nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: knockSourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

/** One channel's independent view of one entity. */
export type KnockChannelEntity = z.infer<typeof knockChannelEntitySchema>;

/**
 * One tracked entity: a stable identity, plus whatever each channel independently knows about it.
 * @internal
 */
export const knockEntitySchema = z
  .object({
    channels: z
      .object({ api: knockChannelEntitySchema.nullable(), browser: knockChannelEntitySchema.nullable() })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(KNOCK_ATLAS_KINDS),
    /**
     * The provider's own key: `<API> <METHOD> <path template>` for a method, the route pattern for a
     * dashboard route, and Knock's own key or id for an entity. This is what the two channels are matched
     * on, byte-exactly.
     *
     * A method's key carries the API because the two documents SHARE paths — both declare
     * `GET /v1/workflows` and they answer different things — so `<METHOD> <path>` alone would collide two
     * genuinely different operations into one row.
     */
    providerId: z.string().min(1),
    /**
     * Which environment or account this entity sits under, so a reader can filter without decoding a
     * provider key. `null` for a platform-level row — a method, a dashboard route.
     */
    scope: z.string().min(1).nullable(),
  })
  .strict();

/** One tracked entity. */
export type KnockEntity = z.infer<typeof knockEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel. `lastSuccessAt` and
 * `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one timestamp cannot answer
 * "is this still current" after a run that failed following one that succeeded.
 * @internal
 */
export const knockCoverageCellSchema = z
  .object({
    artifacts: z.array(knockArtifactRefSchema),
    channel: z.enum(KNOCK_ATLAS_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.enum(KNOCK_VISIBILITY_SCOPES),
  })
  .strict();

/** One coverage cell. */
export type KnockCoverageCell = z.infer<typeof knockCoverageCellSchema>;

/**
 * A gap, as stored. This atlas's own condition vocabulary plus kind — see `gaps.ts`.
 *
 * `fields` and `surfaces` carry the CONTENT of a disagreement: which names or routes the two surfaces
 * disagree about, and which two surfaces those were. A disagreement gap without them says only that a
 * disagreement happened, which is a notification rather than a finding.
 * @internal
 */
export const knockGapSchema = z
  .object({
    condition: z.string().min(1),
    /** Which names the two surfaces disagree about. Empty unless the condition is a disagreement. */
    fields: z.array(z.string().min(1)),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(KNOCK_ATLAS_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    /** Which channels this gap concerns. Two, for a disagreement; empty when channel-independent. */
    surfaces: z.array(z.enum(KNOCK_ATLAS_CHANNELS)),
  })
  .strict();

/** A gap, as stored. */
export type KnockGap = z.infer<typeof knockGapSchema>;

/** One kind's file on disk. */
export const knockKindFileSchema = z
  .object({
    coverage: z.array(knockCoverageCellSchema),
    entities: z.array(knockEntitySchema),
    gaps: z.array(knockGapSchema),
    kind: z.enum(KNOCK_ATLAS_KINDS),
    platform: z.literal(KNOCK_ATLAS_PLATFORM),
    schemaVersion: z.literal(KNOCK_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

/** One kind's file on disk. */
export type KnockKindFile = z.infer<typeof knockKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const knockKindStatusSchema = z
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
export type KnockKindStatus = z.infer<typeof knockKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const knockManifestSchema = z
  .object({
    kinds: z.record(z.enum(KNOCK_ATLAS_KINDS), knockKindStatusSchema),
    platform: z.literal(KNOCK_ATLAS_PLATFORM),
    schemaVersion: z.literal(KNOCK_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

/** The manifest. */
export type KnockManifest = z.infer<typeof knockManifestSchema>;

/** A never-synced status, shared by every kind in a fresh manifest. */
const NEVER_SYNCED: KnockKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };

/**
 * One value per kind, with every key spelled out so the COMPILER checks the record is complete.
 *
 * The obvious spelling is `Object.fromEntries(KNOCK_ATLAS_KINDS.map(…))`, and it needs a type assertion to
 * become a `Record<KnockAtlasKind, T>` because `fromEntries` returns a `Record<string, T>`. That assertion
 * is exactly what `no-unsafe-type-assertion` refuses, and refuses correctly: it would claim completeness
 * rather than establish it, and the manifest's `kinds` is a `z.record`, so a missing key is not a parse
 * error either. Nothing would have caught a kind that stopped being initialised.
 *
 * Thirty-two keys is the price of the compiler doing that check, and `atlasHome.ts` pays the same price for
 * the same reason on the same list. Adding a kind fails to compile HERE, which is where it should.
 *
 * @param value what to store under each kind, called once per kind
 * @returns the complete record
 */
function knockKindRecord<T>({ value }: { value: (kind: KnockAtlasKind) => T }): Record<KnockAtlasKind, T> {
  return {
    account: value("account"),
    asset: value("asset"),
    audience: value("audience"),
    branch: value("branch"),
    broadcast: value("broadcast"),
    channel: value("channel"),
    "channel-group": value("channel-group"),
    commit: value("commit"),
    "dashboard-route": value("dashboard-route"),
    "email-layout": value("email-layout"),
    environment: value("environment"),
    "event-shape": value("event-shape"),
    goal: value("goal"),
    guide: value("guide"),
    "item-schema": value("item-schema"),
    member: value("member"),
    "message-type": value("message-type"),
    method: value("method"),
    object: value("object"),
    partial: value("partial"),
    "preference-category": value("preference-category"),
    "preference-center": value("preference-center"),
    "preference-set": value("preference-set"),
    schedule: value("schedule"),
    source: value("source"),
    subscription: value("subscription"),
    tag: value("tag"),
    tenant: value("tenant"),
    translation: value("translation"),
    user: value("user"),
    variable: value("variable"),
    workflow: value("workflow"),
  };
}

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialKnockManifest({ updatedAt }: { updatedAt: string }): KnockManifest {
  return {
    kinds: knockKindRecord({ value: () => NEVER_SYNCED }),
    platform: KNOCK_ATLAS_PLATFORM,
    schemaVersion: KNOCK_ATLAS_SCHEMA_VERSION,
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
export function emptyKnockKindFile({ kind, updatedAt }: { kind: KnockAtlasKind; updatedAt: string }): KnockKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: KNOCK_ATLAS_PLATFORM,
    schemaVersion: KNOCK_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}

/**
 * An empty file for every kind, so a freshly installed generation is complete rather than partial.
 *
 * @param at the ISO timestamp to stamp
 * @returns one empty file per kind
 */
export function emptyKnockKindFiles({ at }: { at: string }): Readonly<Record<KnockAtlasKind, KnockKindFile>> {
  return knockKindRecord({ value: (kind) => emptyKnockKindFile({ kind, updatedAt: at }) });
}
