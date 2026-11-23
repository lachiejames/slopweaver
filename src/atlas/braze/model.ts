/**
 * What the Braze atlas holds, and the permanent boundary of what it can ever claim.
 *
 * ## One platform, two published sources, and neither is the product
 *
 * Braze publishes no OpenAPI document. What it does publish is TWO independent machine-readable
 * descriptions of the same REST surface: the endpoint reference on its own documentation site, which
 * server-renders a `<div class="api_type">` block carrying the method and path into every endpoint page, and
 * the official Postman collection it links from that same reference. Those are two CHANNELS of one atlas,
 * never two atlases, and the disagreement between them is an OUTPUT rather than a build-time detail —
 * `docs/atlas-intent/04-corroboration.md` is explicit that corroboration is a thing the atlas shows.
 *
 * MEASURED, reproduce with `slopweaver atlas braze report`: 146 documented operations across 15
 * families, 95 distinct operations in the collection, 56 documented operations the collection omits — whole
 * families among them — and 5 operations the collection ships that the documentation does not describe at
 * all.
 *
 * ## This atlas holds ENTITIES too, once it can reach them
 *
 * `docs/atlas-intent/06-holdings.md` is a test an atlas applies to its own platform: does something better suited
 * already hold this platform's entities? Here it is NO. No campaign, canvas, segment, catalogue, content
 * block or subscription group exists anywhere else in this installation — the corpus holds the engineering
 * conversation ABOUT Braze and none of Braze's own configuration. So the answer is everything reachable,
 * entities included, minus the highly voluminous. The `api` channel is where those land, and it is
 * `declared-unfilled` because no workspace API key is configured; the two published channels do not wait on
 * that.
 *
 * A kind here is a DECLARATION, never a claim that anything has been read. Each kind's own coverage cell
 * says what actually happened to it, per channel.
 *
 * ## Kinds are Braze's own documentation families
 *
 * Not an invented taxonomy: the first path segment under `/docs/api/endpoints/` in Braze's own sitemap, so a
 * reader who knows the reference knows the kind. `undocumented` is the one kind that is not one of those, and
 * it is deliberate — see {@link BRAZE_UNDOCUMENTED_KIND}.
 *
 * ## Nothing here holds an engagement row
 *
 * Every field an `operation` entity carries is a NAME: an HTTP method, a path shape, a request parameter
 * name, a response field name. The voluminous families — every `*_data_series` analytics stream and the
 * user-population exports — are enumerated and declared, and never publish a row per record. That is a
 * disposition, not an exclusion: see `dispositions.ts`.
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
export const BRAZE_ATLAS_SCHEMA_VERSION = 1;

/** The platform discriminator. ONE per SaaS app — the reference, the collection, the REST API and the
 * dashboard are SURFACES of this one atlas. */
export const BRAZE_ATLAS_PLATFORM = "braze";

/**
 * Every kind this atlas publishes a file for — one per documentation family, plus two the reference has no
 * segment for.
 *
 * Written out rather than computed so the list stays a literal union a caller can be checked against, and
 * pinned by `specLock.ts`, which a sync asserts EXACT equality against. A family Braze adds tomorrow is
 * therefore a REFUSAL to publish rather than a silent widening.
 */
export const BRAZE_KINDS = [
  "apps",
  "catalogs",
  "cdi",
  "data_objects",
  "email",
  "export",
  "messaging",
  "page",
  "preference_center",
  "scim",
  "sdk_authentication",
  "sms",
  "subscription_groups",
  "templates",
  "translations",
  "undocumented",
  "user_data",
] as const;

/** One kind this atlas publishes. */
export type BrazeKind = (typeof BRAZE_KINDS)[number];

/**
 * The kind that holds browser routes rather than REST operations.
 *
 * Named rather than inferred because two things branch on it: a sync must not stale it, and a walk must not
 * touch any other kind.
 */
export const BRAZE_PAGE_KIND = "page";

/**
 * The kind that holds operations Braze's own collection ships and its documentation does not describe.
 *
 * It names PROVENANCE rather than subject, which is unusual and is the point. The five operations in it have
 * no documentation family to belong to — their reference pages return Braze's soft-404 shell, measured
 * — so filing them under a family invented for them would be exactly the re-skinning this repository's
 * sibling atlases warn against, and dropping them would hide the finding that they exist. A kind makes them
 * greppable in one file and keeps the disagreement visible in the store rather than only in a report.
 */
export const BRAZE_UNDOCUMENTED_KIND = "undocumented";

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what another already knew.
 *
 * `docs` is Braze's own endpoint reference, read offline; `collection` is the official Postman collection;
 * `api` is a live REST call against a workspace; `browser` is a dashboard page walked in the owner's real
 * Chrome. The first two are NOT one channel, and conflating them would destroy the only corroboration this
 * atlas can currently produce. Neither says anything whatever about what a credential of this installation's
 * may call.
 */
export const BRAZE_CHANNELS = ["docs", "collection", "api", "browser"] as const;

export type BrazeChannel = (typeof BRAZE_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type BrazeEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type BrazeCoverageState = AtlasCoverageState;

/**
 * The claim boundary a coverage cell carries — one per channel, because the four ceilings are unrelated.
 *
 * The two published channels' ceiling is a DOCUMENT and no workspace at all; the API channel's is whatever a
 * workspace REST key is scoped for; the browser channel's is whatever the signed-in person's Braze role
 * opens. One `visibilityScope` for the atlas would be false about three channels whichever value it took.
 *
 * @internal
 */
export const BRAZE_VISIBILITY_SCOPES = [
  "docs-published-reference",
  "collection-published-postman",
  "api-workspace-key",
  "browser-signed-in-role",
] as const;

/**
 * The claim boundary one channel reads under.
 * @internal
 */
export type BrazeVisibilityScope = (typeof BRAZE_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one channel reads under.
 *
 * @param channel the channel that produced the cell
 * @returns that channel's own ceiling
 */
export function brazeVisibilityScopeFor({ channel }: { channel: BrazeChannel }): BrazeVisibilityScope {
  if (channel === "docs") {
    return "docs-published-reference";
  }
  if (channel === "collection") {
    return "collection-published-postman";
  }
  if (channel === "api") {
    return "api-workspace-key";
  }
  return "browser-signed-in-role";
}

/**
 * The permanent claim boundary — what "complete" can ever mean for this installation's access.
 *
 * Stated in the credentials' own terms rather than as a reassurance, and it names the two that do not exist.
 */
export const BRAZE_VISIBILITY_SCOPE =
  "the docs channel sees exactly the endpoint pages Braze's own sitemap declares and no workspace at all; " +
  "the collection channel sees exactly the official Postman collection Braze publishes, likewise no " +
  "workspace; the REST channel sees whatever a workspace API key is scoped for, and this installation holds " +
  "none, so it has never called anything; the browser channel sees whatever the signed-in person's Braze " +
  "role opens, and this installation has no Braze account at all — measured, the dashboard " +
  "answers a sign-in wall and the mailbox has never received a Braze invitation. None of the four implies " +
  "any other, and 'complete' here is always complete for the channel named on the cell";

const isoSchema = z.iso.datetime();

/** One artifact backing a fact — a proof screenshot. Kit-owned. */
const brazeArtifactRefSchema = atlasArtifactRefSchema;

export type BrazeArtifactRef = z.infer<typeof brazeArtifactRefSchema>;

/**
 * Where a record came from, through one channel.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const brazeSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(BRAZE_CHANNELS) })
  .strict();

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type BrazeSource = z.infer<typeof brazeSourceSchema>;

/**
 * What this atlas may do with one operation, decided per operation rather than per family.
 *
 * - `reachable` — configuration or identity a person or a system CREATED, listable exhaustively. The atlas
 *   may call it once a credential exists, and stores what it returns.
 * - `voluminous` — time-series OBSERVATIONS: emitted by the platform, unbounded, growing with the clock,
 *   identified by an instant rather than by a name somebody chose. The operation is enumerated and declared;
 *   its rows are never stored whole. A DISPOSITION, not an exclusion.
 * - `excluded` — the atlas will never call it: every mutation, and the reads whose own act has an effect.
 *
 * `docs/atlas-intent/06-holdings.md` is the authority, and the criterion cuts THROUGH a family rather than along it.
 * On Braze that cut is unusually sharp in one direction the method alone gets WRONG: this API answers
 * several of its largest READS with `POST`, because their selectors do not fit a query string. So
 * `POST /users/export/ids` is a read and `POST /users/track` is a write, and a rule keyed on the verb would
 * class both the same. See `dispositions.ts`.
 */
export const BRAZE_DISPOSITIONS = ["reachable", "voluminous", "excluded"] as const;

export type BrazeDisposition = (typeof BRAZE_DISPOSITIONS)[number];

/** One request parameter, as a published source declares it. Names and types only — never a value. */
export const brazeParameterSchema = z
  .object({
    name: z.string().min(1),
    required: z.boolean(),
    /** The data type the source states, verbatim, or `null` when it states none. */
    type: z.string().min(1).nullable(),
  })
  .strict();

export type BrazeParameter = z.infer<typeof brazeParameterSchema>;

/**
 * What the docs channel knows about one operation: everything Braze's own endpoint page states about it,
 * reduced to names.
 *
 * There is no response VALUE here and there cannot be — this channel never called anything. `responseFields`
 * are the property names appearing in the page's own example-response blocks, which is where Braze documents
 * an endpoint's shape; it publishes no schema component to resolve instead.
 */
const brazeOperationDocsDetailSchema = z
  .object({
    /** What this atlas may do with the operation, and why. */
    disposition: z.enum(BRAZE_DISPOSITIONS),
    /** The rule that decided the disposition, in English. Never empty, including for `reachable`. */
    dispositionReason: z.string().min(1),
    /** The id of the rule that decided it, so a dead rule can be reported. */
    dispositionRuleId: z.string().min(1),
    /** The HTTP method, upper-cased. */
    method: z.string().min(1),
    /** Request parameters the page's own table declares, in declaration order. Empty when it declares none. */
    parameters: z.array(brazeParameterSchema),
    /** The path shape, exactly as the page's `api_type` block renders it. */
    pathShape: z.string().min(1),
    /** The rate limit the page states, verbatim and truncated, or `null` when it states none. */
    rateLimit: z.string().min(1).nullable(),
    /** Property names the page's example responses carry, sorted. Empty when it shows none. */
    responseFields: z.array(z.string().min(1)),
    /** The page's own `<h1>`, which is Braze's name for the operation. */
    title: z.string().min(1),
  })
  .strict();

export type BrazeOperationDocsDetail = z.infer<typeof brazeOperationDocsDetailSchema>;

/**
 * What the collection channel knows about one operation.
 *
 * Deliberately a different shape from the docs channel's rather than a shared one: the collection declares
 * folders, headers and a request body, and declares no rate limit and no required/optional marking. Forcing
 * both into one type would mean inventing an absent field on each side, and a reader could no longer tell
 * which source actually stated what — the exact thing the two-channel split exists to preserve.
 */
const brazeOperationCollectionDetailSchema = z
  .object({
    /** The folder path inside the collection, outermost first — Braze's own grouping. */
    folders: z.array(z.string().min(1)),
    /** Header names the request declares, sorted. Never a header VALUE. */
    headers: z.array(z.string().min(1)),
    /** The HTTP method, upper-cased. */
    method: z.string().min(1),
    /** The request's name in the collection. */
    name: z.string().min(1),
    /** Query parameter names the request declares, sorted. */
    queryParams: z.array(z.string().min(1)),
    /** The path shape, with the collection's own host variable removed. */
    pathShape: z.string().min(1),
    /** Top-level field names the example request body carries, sorted. Empty when it declares no body. */
    requestBodyFields: z.array(z.string().min(1)),
  })
  .strict();

export type BrazeOperationCollectionDetail = z.infer<typeof brazeOperationCollectionDetailSchema>;

/**
 * What the browser saw one declared dashboard ROUTE be.
 *
 * The screenshot is not here — it is a {@link BrazeSource} artifact, addressed by digest, because the ruling
 * is that the atlas HOLDS the picture rather than a link to one. `unreachableBecause` is what makes a
 * declared route nobody could open a recorded row rather than a silent absence.
 *
 * @internal
 */
export const brazePageDetailSchema = z
  .object({
    /** The address the browser ended on, which a redirect may have changed. */
    finalUrl: z.string().min(1).nullable(),
    /** Whether the client sent this page somewhere other than where it was asked to go. */
    redirected: z.boolean(),
    /** Which dashboard area this route belongs to, e.g. `settings`, `engagement`. */
    section: z.string().min(1),
    statusCode: z.number().int().nullable(),
    /** The document title the page settled on. */
    title: z.string(),
    /** Why this declared route is not held, or `null` when it is. */
    unreachableBecause: z.string().min(1).nullable(),
  })
  .strict();

/**
 * What the browser saw one declared route be.
 *
 * @internal
 */
export type BrazePageDetail = z.infer<typeof brazePageDetailSchema>;

/** One channel's independent view of one entity. A successful look replaces only this channel's own detail. */
const brazeChannelEntitySchema = z
  .object({
    channel: z.enum(BRAZE_CHANNELS),
    /** What this channel knows about this entity. Shape depends on the kind — see the detail schemas. */
    detail: z.unknown().nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: brazeSourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

export type BrazeChannelEntity = z.infer<typeof brazeChannelEntitySchema>;

/** One tracked entity: a stable identity, plus whatever each channel independently knows about it. */
const brazeAtlasEntitySchema = z
  .object({
    channels: z
      .object({
        api: brazeChannelEntitySchema.nullable(),
        browser: brazeChannelEntitySchema.nullable(),
        collection: brazeChannelEntitySchema.nullable(),
        docs: brazeChannelEntitySchema.nullable(),
      })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(BRAZE_KINDS),
    /**
     * The provider's own key: `<METHOD> <path shape>` for an operation, the declared route for a page. This
     * is what the channels are matched on, byte-exactly, and it is why the two published channels normalise
     * their paths the same way — see `pathShape.ts`.
     */
    providerId: z.string().min(1),
  })
  .strict();

export type BrazeAtlasEntity = z.infer<typeof brazeAtlasEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel. `lastSuccessAt` and
 * `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one timestamp cannot answer
 * "is this still current" after a run that failed following one that succeeded.
 */
const brazeCoverageCellSchema = z
  .object({
    artifacts: z.array(brazeArtifactRefSchema),
    channel: z.enum(BRAZE_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.enum(BRAZE_VISIBILITY_SCOPES),
  })
  .strict();

export type BrazeCoverageCell = z.infer<typeof brazeCoverageCellSchema>;

/** A gap, as stored. This atlas's own condition vocabulary plus kind — see `gaps.ts`. */
export const brazeAtlasGapSchema = z
  .object({
    condition: z.string().min(1),
    /** Which names the surfaces disagree about. Empty unless the condition is a disagreement. */
    fields: z.array(z.string().min(1)),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(BRAZE_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    /** Which channels this gap concerns. Two, for a disagreement; empty when channel-independent. */
    surfaces: z.array(z.enum(BRAZE_CHANNELS)),
  })
  .strict();

export type BrazeAtlasGap = z.infer<typeof brazeAtlasGapSchema>;

/** One kind's file on disk. */
export const brazeAtlasKindFileSchema = z
  .object({
    coverage: z.array(brazeCoverageCellSchema),
    entities: z.array(brazeAtlasEntitySchema),
    gaps: z.array(brazeAtlasGapSchema),
    kind: z.enum(BRAZE_KINDS),
    platform: z.literal(BRAZE_ATLAS_PLATFORM),
    schemaVersion: z.literal(BRAZE_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type BrazeAtlasKindFile = z.infer<typeof brazeAtlasKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const brazeAtlasKindStatusSchema = z
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
export type BrazeAtlasKindStatus = z.infer<typeof brazeAtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const brazeAtlasManifestSchema = z
  .object({
    kinds: z.record(z.enum(BRAZE_KINDS), brazeAtlasKindStatusSchema),
    platform: z.literal(BRAZE_ATLAS_PLATFORM),
    schemaVersion: z.literal(BRAZE_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type BrazeAtlasManifest = z.infer<typeof brazeAtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialBrazeManifest({ updatedAt }: { updatedAt: string }): BrazeAtlasManifest {
  const empty: BrazeAtlasKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  // `as`: Object.fromEntries widens keys to string; this is built from the exhaustive BRAZE_KINDS, so the
  // narrower kind-keyed type is sound. Same convention as `cloudflare/reset.ts`.
  // oxlint-disable-next-line no-unsafe-type-assertion
  const kinds = Object.fromEntries(BRAZE_KINDS.map((kind) => [kind, empty])) as Record<BrazeKind, BrazeAtlasKindStatus>;
  return { kinds, platform: BRAZE_ATLAS_PLATFORM, schemaVersion: BRAZE_ATLAS_SCHEMA_VERSION, updatedAt };
}

/**
 * An empty kind file.
 *
 * @param kind the kind this file holds
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty kind file
 */
export function emptyBrazeKindFile({ kind, updatedAt }: { kind: BrazeKind; updatedAt: string }): BrazeAtlasKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: BRAZE_ATLAS_PLATFORM,
    schemaVersion: BRAZE_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}
