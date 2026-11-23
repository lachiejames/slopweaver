/**
 * The Hex atlas's on-disk vocabulary — the generation that holds every surface, and the schemas that refuse
 * to trust it.
 *
 * ## Hex is the SURFACE MAP case, and the reason is a constraint rather than a holder
 *
 * `docs/atlas-intent/06-holdings.md` makes what an atlas holds a per-platform test — does something better suited
 * already hold this platform's entities? For Slack the answer is yes and the corpus is the holder. For Hex
 * nothing else here holds a project, a collection or a data connection, so §6 alone would say "everything
 * reachable, entities included".
 *
 * **It does not, and the reason is the owner's own, as ruled for Hex's scope: this
 * atlas stores NO CUSTOMER DATA LOCALLY.** A Hex project is a notebook over the organisation's warehouse,
 * so the thing on the other side of almost every interesting operation is a result set — rows a query
 * returned. The owner's line, and it is the design brief rather than a caveat: a surface map holds the EXISTENCE
 * and SHAPE of projects and pages, never their result sets.
 *
 * That is a THIRD disposition rather than a narrower §6 answer, and `disposition.ts` carries the criterion.
 * `entity` and `shape-index` are §6's own two; `withheld` is what this platform adds, and the difference
 * matters to a reader: a shape-indexed family was reached and deliberately not stored a row at a time, and
 * a withheld one is mapped in full — its method, its path, its parameters, its response field names — and
 * never called for a body at all.
 *
 * ## Five surfaces, two channels
 *
 * `spec-declared` compiles Hex's own published OpenAPI document, pinned by digest — the authority on what
 * the public API can be ASKED. `unauthenticated-probe` is the measured census of which `/api/v1` nouns are
 * mounted, taken with no credential and with a control that has to fail for the method to mean anything.
 * `client-bundle` is the shipped web client's own router table and GraphQL operation names, compiled out of
 * the closed JavaScript graph. All three are the `api` channel, because all three describe what can be
 * asked rather than what this workspace holds. `workspace-api` is the credentialled read that would fill
 * the entity kinds and has no token. `web-app` is the `browser` channel: `app.hex.tech` walked in the
 * owner's own Chrome, authoritative for the navigation surface and never more than `discovery` for the
 * operations it observes — seeing the first-party client call something establishes that it EXISTS, and
 * nothing about what a token may ask for.
 */
import { z } from "zod";

import { channelSchemas } from "../kit/channelSchemas.js";
import { type AtlasCoverageState, type AtlasEvidenceRole, atlasArtifactRefSchema } from "../kit/contract.js";

/**
 * The on-disk schema version. Bump only with a real layout change; `store.ts` refuses to read a generation
 * declaring a different version, naming the reset remedy.
 */
export const HEX_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — the published document, the unauthenticated census, the
 * shipped client and the web app are four SURFACES of this one atlas.
 */
export const HEX_ATLAS_PLATFORM = "hex";

/**
 * The entity kinds this atlas holds. Iterated by the reader, never derived from the directory listing.
 *
 * `api`, `method` and `page` are the surface map. `project` and `resource` are the workspace's own
 * configuration, declared before anything fills them because a kind nothing declares is a kind no
 * generation can publish a non-`synced` state for — it reads as a kind that does not exist.
 *
 * `project` gets a kind of its own and every other workspace object shares `resource`, and that is the owner's
 * ruling rather than a taxonomy: the project is the thing the owner named, and a collection, a group, a data
 * connection and a workspace member are all configuration somebody created and addressed by its own id.
 * Neither kind ever holds a cell's output — see this file's header.
 */
export const HEX_ATLAS_KINDS = ["api", "method", "page", "project", "resource"] as const;

export type HexAtlasKind = (typeof HEX_ATLAS_KINDS)[number];

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what the other already knew.
 */
export const HEX_ATLAS_CHANNELS = ["api", "browser"] as const;

export type HexAtlasChannel = (typeof HEX_ATLAS_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type HexEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type HexCoverageState = AtlasCoverageState;

/**
 * The claim boundary a coverage cell carries — one per channel, because the two ceilings are unrelated.
 *
 * The `api` channel's ceiling is what Hex publishes to the anonymous internet: its OpenAPI document, the
 * status its router answers an unauthenticated request with, and the JavaScript it serves the login page.
 * None of that needs an account, so none of it can describe THIS workspace. The `browser` channel's ceiling
 * is whatever the signed-in person's role opens. One `visibilityScope` for the atlas would be false about
 * one channel whichever value it took.
 *
 * **Three rather than two**, and the third is on the SAME channel as the first: the
 * workspace entity fill reads `/api/v1` with a token, so its ceiling is that token's ROLE — narrower than
 * the anonymous document and wider than nothing. Deriving the scope from the channel alone would have made
 * a credentialled read claim to describe the product rather than this workspace, which is the exact class of
 * silent overclaim these values exist to prevent. `hexVisibilityScopeFor` still answers the channel-only
 * question; a caller that knows it read with a credential names {@link HEX_TOKEN_VISIBILITY_SCOPE} itself.
 *
 * @internal
 */
export const HEX_VISIBILITY_SCOPES = ["api-anonymous-published", "api-token-role", "browser-signed-in-role"] as const;

/**
 * The claim boundary one channel reads under.
 * @internal
 */
export type HexVisibilityScope = (typeof HEX_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one channel reads under.
 *
 * @param channel the channel that produced the cell
 * @returns that channel's own ceiling
 */
export function hexVisibilityScopeFor({ channel }: { channel: HexAtlasChannel }): HexVisibilityScope {
  return channel === "api" ? "api-anonymous-published" : "browser-signed-in-role";
}

/**
 * The ceiling a credentialled workspace read sits under — what the token's own role opens, and no more.
 *
 * Named rather than derived because no channel implies it: the same `api` channel carries the anonymous
 * document AND the token read, and only the caller knows which it just performed.
 */
export const HEX_TOKEN_VISIBILITY_SCOPE: HexVisibilityScope = "api-token-role";

/**
 * What a caller must do to fill the entity surface. Named in every `not-configured` cell rather than left
 * as "configure a credential", because a cell that cannot say WHAT would unblock it is a complaint. Declared
 * here rather than in `sync.ts` because the descriptor names it too, and `sync.ts` sits on the import path
 * that reaches `coverage.ts`, which reads the descriptor's freshness window.
 *
 * ## It names a WRITE, which is why this surface stays unfilled with the app signed in
 *
 * A Hex API token is minted from the workspace's own settings, and minting one is a WRITE: it creates a
 * durable credential in the workspace this atlas maps. Hex is not in `WRITE_POLICY_REGISTER`
 * (`src/admit/browserSurface.ts`), so under the owner's rule it is `refuse-every-write` by
 * default and the browser-door guard refuses that mint rather than allowing it for want of a policy. Every
 * action this atlas takes in that app is a read, enforced rather than intended, and naming the click here is
 * a remedy for whoever has the standing to take it — never an instruction this atlas may follow for itself.
 *
 * ## And what filling it would and would not buy, which is the part specific to this platform
 *
 * A token would fill the `project` and `resource` kinds with what EXISTS — titles, owners, statuses,
 * collections, data connections, the tables a project queries. It would not fill a single result set: those
 * operations are `withheld` by `disposition.ts` and stay withheld with a token in hand. The credential is
 * the missing half of the surface map, never a route to the data.
 *
 * @internal
 */
export const HEX_ENTITY_UNBLOCKED_BY =
  "the owner minting a Hex API token (workspace settings → API tokens), then `slopweaver secrets " +
  "set hex-api-token`. That first step is the OWNER'S HAND: minting is a WRITE in the workspace this atlas " +
  "maps, Hex is unregistered in `WRITE_POLICY_REGISTER`, and the browser guard refuses a session taking " +
  "one. The other half is that a token has READ verbs to " +
  "feed, so `slopweaver atlas hex sync` fills these kinds the moment one exists. It fills them with what " +
  "EXISTS and changes nothing about what is withheld: a cell's output stays unfetched with a token exactly " +
  "as without one, and reading one is `slopweaver hex output`, which stores nothing anywhere";

/**
 * The permanent claim boundary, stated once for the descriptor.
 *
 * Written in the credentials' own terms rather than as a reassurance: three of the five surfaces need no
 * account at all and therefore can never be workspace-specific, one needs a token this installation does
 * not hold, and the last sees exactly what the signed-in role opens.
 */
export const HEX_VISIBILITY_SCOPE =
  "the published document, the unauthenticated noun census and the shipped client bundle all need NO " +
  "credential, so they describe the product rather than this workspace and can never be narrowed by a " +
  "role; the entity surface needs a Hex API token this installation does not hold; the web app sees " +
  "exactly what the signed-in role opens. 'Complete' here is always complete for the channel named on the " +
  "cell — and on every channel it is complete for the SURFACE, never for the data behind it, because this " +
  "atlas stores no result set at all";

/**
 * One artifact backing a fact — a proof screenshot. Kit-owned.
 *
 * @internal
 */
export const hexArtifactRefSchema = atlasArtifactRefSchema;

export type HexArtifactRef = z.infer<typeof hexArtifactRefSchema>;

/**
 * The stored vocabulary this atlas shares with every other two-channel one — entity, coverage cell, gap,
 * kind file and manifest — specialised to Hex's own channels, kinds, platform and visibility scopes.
 *
 * `kit/channelSchemas.ts` owns the SHAPE and says why each of its load-bearing decisions is the two-surface
 * ruling written down. What stays in this file is what is genuinely Hex's: the DETAIL schemas below.
 *
 * @internal
 */
const shared = channelSchemas({
  // Spelled out rather than assembled from the tuple: the factory only sees a runtime list, so building
  // these there would need a type assertion to recover the exact keys. Every slot stays REQUIRED — a record
  // would make each optional, and an entity that omitted a channel would then validate and read back as one
  // whose channel had never looked.
  channelSlots: ({ channelEntity }) =>
    z.object({
      api: channelEntity.nullable(),
      browser: channelEntity.nullable(),
    }),
  manifestKinds: ({ kindStatus }) =>
    z.object({
      api: kindStatus,
      method: kindStatus,
      page: kindStatus,
      project: kindStatus,
      resource: kindStatus,
    }),
  channels: HEX_ATLAS_CHANNELS,
  kinds: HEX_ATLAS_KINDS,
  platform: HEX_ATLAS_PLATFORM,
  schemaVersion: HEX_ATLAS_SCHEMA_VERSION,
  visibilityScopes: HEX_VISIBILITY_SCOPES,
});

/**
 * Where a record came from, through one channel.
 * @internal
 */
export const hexSourceSchema = shared.source;

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type HexSource = z.infer<typeof hexSourceSchema>;

/**
 * What the API channel knows about one document or inventory it compiled.
 *
 * ONE `api` kind covers three very different artifacts — a published OpenAPI document, a measured status
 * census and a compiled JavaScript graph — because each is the same thing to a reader: a body of evidence
 * about what can be asked, addressed by a URL, with a size and a digest that says whether it has moved.
 * `family` is what tells them apart, and it is stored rather than inferred from the id so a reader
 * filtering the kind never has to know this atlas's naming.
 *
 * @internal
 */
export const hexApiDetailSchema = z
  .object({
    byteLength: z.number().int().nonnegative(),
    /** Which of the three evidence bodies this is. */
    family: z.enum(["openapi-document", "unauthenticated-probe", "client-bundle"]),
    /** Every origin this body's operations answer on, sorted. */
    hosts: z.array(z.string().min(1)),
    /** How many operations, routes or probed nouns it declares. */
    operationCount: z.number().int().nonnegative(),
    /** How many distinct paths it declares; zero for a body that has none. */
    pathCount: z.number().int().nonnegative(),
    /** Every security scheme its operations require, sorted — which credential reaches this API. */
    securitySchemes: z.array(z.string().min(1)),
    sha256: z.string().length(64),
    /** The body's own title, as Hex writes it or as this atlas names the measurement. */
    title: z.string().min(1),
    /** The API version, or the measurement's own version marker. */
    version: z.string().min(1),
  })
  .strict();

export type HexApiDetail = z.infer<typeof hexApiDetailSchema>;

/**
 * What the API channel knows about one operation: everything the compiled evidence states about that method
 * and path, reduced to names.
 *
 * `disposition` is the field this atlas exists to carry — see `disposition.ts` and this file's header.
 * `evidence` says WHICH of the three api-channel surfaces established the operation, because they establish
 * very different things: a published document states a contract, a 401 states that a noun is mounted, and a
 * name in the client's bundle states that the first-party client knows how to call it and nothing more.
 *
 * @internal
 */
export const hexMethodApiDetailSchema = z
  .object({
    /** Whether an observation of this operation may publish rows, only a shape, or nothing at all. */
    disposition: z.enum(["entity", "shape-index", "withheld"]),
    /** Which api-channel surface established it. */
    evidence: z.enum(["openapi-document", "unauthenticated-probe", "client-bundle"]),
    /** Why this operation is never called, or `null` when it is observational. */
    excludedBecause: z.string().min(1).nullable(),
    /** The origin it answers on, or `null` when the evidence declares none. */
    host: z.string().min(1).nullable(),
    /** Whether this atlas may call it at all. A refused operation still gets a row. */
    observational: z.boolean(),
    /** The operation name the provider gives it, when it gives one. */
    operationId: z.string().min(1).nullable(),
    /** Every declared parameter name, from `parameters` and the request body alike, sorted. */
    parameters: z.array(z.string().min(1)),
    /** Response field PATHS to two levels, `[]` marking an array, sorted. Names only, never a value. */
    responseFields: z.array(z.string().min(1)),
    /** The security scheme names it requires, sorted — which credential reaches it. */
    securitySchemes: z.array(z.string().min(1)),
    /**
     * Why a `withheld` operation is withheld, or `null` when it is not one.
     *
     * Stored per row rather than derived at read time, because the whole point of the disposition is that a
     * reader learns the reason WITHOUT having to open this repository's source.
     */
    withheldBecause: z.string().min(1).nullable(),
  })
  .strict();

export type HexMethodApiDetail = z.infer<typeof hexMethodApiDetailSchema>;

/**
 * What the browser surface saw one operation do: how often the first-party client called it, and — only
 * when the operation is not withheld — the response field NAMES it got back.
 *
 * `fieldsWithheldBecause` is what makes an empty `responseFields` legible. On every sibling atlas an empty
 * list means the body carried nothing; here it can also mean the body carried a result set and this atlas
 * refused to describe even its shape, and a reader who cannot tell those apart has been misled by silence.
 *
 * @internal
 */
export const hexMethodBrowserDetailSchema = z
  .object({
    /** How many times the walk saw this operation called. A frequency, never a payload. */
    callCount: z.number().int().positive(),
    /** Why this row carries no response field names, or `null` when it carries what it saw. */
    fieldsWithheldBecause: z.string().min(1).nullable(),
    /** The origin the call went to, so a client-only host is visible as one. */
    host: z.string().min(1),
    /** The GraphQL operation name, when the call carried one — Hex puts it in the query string. */
    operationName: z.string().min(1).nullable(),
    /** Every query parameter NAME the client sent, telemetry dropped, sorted. */
    parameters: z.array(z.string().min(1)),
    /** Every response field name observed, redacted and capped, sorted. Empty when withheld. */
    responseFields: z.array(z.string().min(1)),
    /** Which declared page surfaces caused this call, sorted. */
    seenOnPages: z.array(z.string().min(1)),
    /** The last HTTP status observed for it. */
    statusCode: z.number().int(),
  })
  .strict();

/**
 * What the browser channel knows about one operation the first-party client called.
 *
 * @internal
 */
export type HexMethodBrowserDetail = z.infer<typeof hexMethodBrowserDetailSchema>;

/**
 * What the browser saw one declared PAGE be: whether it was reached at all, what it settled on, and how
 * much of its own traffic the walk actually accounted for.
 *
 * The screenshot is not here — it is a {@link HexSource} artifact, addressed by digest, because the ruling
 * is that the atlas HOLDS the picture rather than a link to one.
 *
 * @internal
 */
export const hexPageDetailSchema = shared.pageDetail;

/**
 * What the browser channel knows about one declared page it visited.
 *
 * @internal
 */
export type HexPageDetail = z.infer<typeof hexPageDetailSchema>;

/**
 * What a credentialled read knows about one workspace PROJECT: who owns it, what state it is in, and which
 * warehouse tables its cells query.
 *
 * Every field here is configuration somebody created. The one that looks closest to data is
 * `queriedTables`, and it is not: a table NAME is what a query could ask for, exactly as a schema column
 * name is under `disposition.ts`'s GraphQL criterion, where a VALUE is what a query returned. Nothing on
 * this row ever holds a row of that table — reading one is `slopweaver hex output`, which stores nothing.
 *
 * @internal
 */
export const hexProjectDetailSchema = z
  .object({
    /** When the project was created. */
    createdAt: z.string().min(1),
    /** The project's own categories, as somebody named them. */
    categories: z.array(z.string().min(1)),
    /** Who created it. */
    creatorEmail: z.string().min(1),
    /** Its description, or `null` when it has none. */
    description: z.string().nullable(),
    /** When it was last edited. */
    lastEditedAt: z.string().min(1),
    /** When it was last published, or `null` when it never was. */
    lastPublishedAt: z.string().nullable(),
    /** Who owns it. */
    ownerEmail: z.string().min(1),
    /** Warehouse tables its cells query, sorted — names, never rows. Bounded by the sync's own limit. */
    queriedTables: z.array(z.string().min(1)),
    /** How many schedules it carries; a published result can refresh with nobody watching. */
    scheduleCount: z.number().int().nonnegative(),
    /** Its workflow status, or `null` when it carries none. */
    status: z.string().nullable(),
    /** Its title. */
    title: z.string().min(1),
    /** The project type Hex reports. */
    type: z.string().min(1),
  })
  .strict();

export type HexProjectDetail = z.infer<typeof hexProjectDetailSchema>;

/**
 * What a credentialled read knows about one workspace RESOURCE — a data connection, a collection or a group.
 *
 * One kind for all three because each is configuration somebody created and addressed by its own id (see
 * the `HEX_ATLAS_KINDS` note); `family` is what tells them apart and is stored rather than inferred from
 * the id, so a reader filtering the kind never has to know this atlas's naming.
 *
 * @internal
 */
export const hexResourceDetailSchema = z
  .object({
    /** The connection's warehouse type, or `null` for a collection or group. */
    connectionType: z.string().min(1).nullable(),
    /** Its description, or `null`. */
    description: z.string().nullable(),
    /** Which of the three this row is. */
    family: z.enum(["data-connection", "collection", "group"]),
    /** Its name, as somebody chose it. */
    name: z.string().min(1),
    /**
     * What a connection points at, in the identifiers that name the warehouse — a BigQuery project id, a
     * Postgres host and database. `null` for a collection, a group, or a connection Hex described without
     * detail. Never a credential: `src/hex/schemas.ts` reads only the identifier fields.
     */
    target: z.string().min(1).nullable(),
  })
  .strict();

export type HexResourceDetail = z.infer<typeof hexResourceDetailSchema>;

/**
 * One channel's independent view of one entity. A successful look replaces only this channel's own detail.
 *
 * @internal
 */
export const hexChannelEntitySchema = shared.channelEntity;

export type HexChannelEntity = z.infer<typeof hexChannelEntitySchema>;

/**
 * One tracked entity: a stable identity, plus whatever each channel independently knows about it.
 *
 * @internal
 */
export const hexAtlasEntitySchema = shared.entity;

export type HexAtlasEntity = z.infer<typeof hexAtlasEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel.
 *
 * @internal
 */
export const hexCoverageCellSchema = shared.coverageCell;

export type HexCoverageCell = z.infer<typeof hexCoverageCellSchema>;

/**
 * A gap, as stored. This atlas's own condition vocabulary plus kind — see `gaps.ts`.
 *
 * @internal
 */
export const hexAtlasGapSchema = shared.gap;

export type HexAtlasGap = z.infer<typeof hexAtlasGapSchema>;

/** One kind's file on disk. */
export const hexAtlasKindFileSchema = shared.kindFile;

export type HexAtlasKindFile = z.infer<typeof hexAtlasKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const hexAtlasKindStatusSchema = shared.kindStatus;

/** @internal */
export type HexAtlasKindStatus = z.infer<typeof hexAtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const hexAtlasManifestSchema = shared.manifest;

export type HexAtlasManifest = z.infer<typeof hexAtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialHexManifest({ updatedAt }: { updatedAt: string }): HexAtlasManifest {
  return shared.initialManifest({ updatedAt });
}

/**
 * An empty kind file.
 *
 * @param kind the kind this file holds
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty kind file
 */
export function emptyHexKindFile({ kind, updatedAt }: { kind: HexAtlasKind; updatedAt: string }): HexAtlasKindFile {
  return shared.emptyKindFile({ kind, updatedAt });
}
