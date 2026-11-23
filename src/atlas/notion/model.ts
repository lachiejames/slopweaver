/**
 * The Notion atlas's on-disk vocabulary — the generation that holds BOTH surfaces, and the schemas that
 * refuse to trust it.
 *
 * ## This atlas is a SURFACE MAP, and the corpus holds the entities
 *
 * Owner's rule, for Slack and Notion alike: where something
 * else better suited already holds a platform's entities, the atlas holds the surface map — every reachable
 * settings and admin page, screenshotted, and every page of that surface known to exist. Notion's pages,
 * databases and their content are the world model's, and `src/corpus/notion/reach.ts` already enumerates
 * every id the integration can see on every refresh. So there is no page-inventory kind here, and
 * `descriptor.ts`'s `excludes` says so rather than leaving a reader to notice the absence.
 *
 * ## Two channels, and for Notion they are almost entirely DISJOINT
 *
 * `api` is the public REST surface the installed `@notionhq/client` declares, under `api.notion.com/v1`.
 * `browser` is what the first-party web client actually calls, which is a different, undocumented API under
 * `www.notion.so/api/v3`. An entity's `providerId` is `<METHOD> <path shape>`, matched byte-exactly, so the
 * two channels do not fold together and the disjointness is a RECORD rather than an assertion — which is
 * precisely the both-surfaces finding this atlas exists to produce.
 *
 * ## Nothing here holds a value
 *
 * Every field a `method` entity carries is a NAME: an HTTP method, a path shape with its parameters as
 * placeholders, a query or body parameter name, a response field name. A `page` entity holds a title, a URL
 * and a screenshot — the one place bytes of the real workspace are deliberately kept, by the ruling that an
 * atlas holds the picture rather than a link to one.
 *
 * ## The two ceilings are unrelated, so a coverage cell carries whichever one produced it
 *
 * The API channel sees exactly what the internal integration has been GRANTED — a per-page share, nothing
 * to do with any human's role. The browser channel sees exactly what the signed-in person's own workspace
 * role opens. Neither implies the other, and the two are granted independently so can differ on any
 * workspace, so one `visibilityScope` for the atlas would be false about one channel whichever value it took.
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
import { type AtlasPageDetail, atlasPageDetailSchema } from "../kit/pageObservation.js";
import { atlasPermissionBlockSchema } from "../kit/permissionBlock.js";

/**
 * The on-disk schema version for the Notion atlas. Bump only with a real layout change; `store.ts` refuses
 * to read a generation declaring a different version, naming the reset remedy.
 */
export const NOTION_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — the REST API and the web client are two SURFACES of this
 * one atlas, which is the whole point of the kit contract's header.
 */
export const NOTION_ATLAS_PLATFORM = "notion";

/** The entity kinds this atlas holds. Iterated by the reader, never derived from the directory listing. */
export const NOTION_ATLAS_KINDS = ["method", "page"] as const;

export type NotionAtlasKind = (typeof NOTION_ATLAS_KINDS)[number];

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what the other already knew.
 */
export const NOTION_ATLAS_CHANNELS = ["api", "browser"] as const;

export type NotionAtlasChannel = (typeof NOTION_ATLAS_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type NotionEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type NotionCoverageState = AtlasCoverageState;

/**
 * The claim boundary a coverage cell carries — one per channel, because the two ceilings are unrelated.
 * See this file's header.
 *
 * @internal
 */
export const NOTION_VISIBILITY_SCOPES = ["api-integration-grants", "browser-signed-in-role"] as const;

/**
 * The claim boundary one channel reads under.
 *
 * @internal
 */
export type NotionVisibilityScope = (typeof NOTION_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one channel reads under.
 *
 * @param channel the channel that produced the cell
 * @returns that channel's own ceiling
 */
export function notionVisibilityScopeFor({ channel }: { channel: NotionAtlasChannel }): NotionVisibilityScope {
  return channel === "api" ? "api-integration-grants" : "browser-signed-in-role";
}

const isoSchema = z.iso.datetime();

/** One artifact backing a fact — a proof screenshot. Kit-owned. */
const notionArtifactRefSchema = atlasArtifactRefSchema;

export type NotionArtifactRef = z.infer<typeof notionArtifactRefSchema>;

/**
 * Where a record came from, and the link that proves it to a human.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const notionSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(NOTION_ATLAS_CHANNELS) })
  .strict();

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type NotionSource = z.infer<typeof notionSourceSchema>;

/**
 * How a deep link was come by. Kit-owned, and read off the source schema rather than restated, so a widening
 * of the kit's own vocabulary cannot leave this atlas quietly declaring a narrower one.
 * @internal
 */
export type NotionDeepLinkStatus = NotionSource["deepLinkStatus"];

/**
 * What the API surface knows about one method: everything the installed SDK's own generated source states
 * about that endpoint, reduced to names.
 *
 * `module` and `name` are the SDK's own handles for the endpoint, kept so a reader can go straight to the
 * declaration; `description` is the one-line JSDoc the package ships above it.
 *
 * ONE ROUTE CAN HAVE SEVERAL SDK HANDLES, which is what `alsoDeclaredAs` exists for. Measured on
 * `@notionhq/client` 5.26.0: `agents.updateSession` and `agents.updateSessionStream` declare an identical
 * `post` + `sessions` + body-param set, differing ONLY by `headers: { Accept: "text/event-stream" }` — one
 * content-negotiated route, two helpers. An atlas of the API surface maps the route, so the two fold into
 * one entity and the extra handles are recorded rather than discarded.
 */
const notionMethodApiDetailSchema = z
  .object({
    /**
     * Every OTHER `<module>.<name>` the SDK declares for this same method-and-path, sorted; empty for the
     * ordinary one-handle endpoint. Defaulted so a generation published before this field existed still
     * parses as what it meant — no extra handles were known.
     */
    alsoDeclaredAs: z.array(z.string().min(1)).default([]),
    bodyParams: z.array(z.string().min(1)),
    /** The SDK's own one-line description, or `null` when it declares none — never an empty string. */
    description: z.string().min(1).nullable(),
    /** The `api-endpoints/<module>` the endpoint is declared in. */
    module: z.string().min(1),
    /** The exported constant's name, e.g. `listUsers`. */
    name: z.string().min(1),
    pathParams: z.array(z.string().min(1)),
    queryParams: z.array(z.string().min(1)),
  })
  .strict();

export type NotionMethodApiDetail = z.infer<typeof notionMethodApiDetailSchema>;

/**
 * What the browser surface saw one operation do: how often the first-party client called it, and the
 * response field NAMES it got back.
 *
 * `seenOnPages` is which declared pages caused the call, which is what turns a list of undocumented
 * operations into something a reader can act on — an operation is a lead, and the page it fires on is where
 * that lead can be reproduced.
 */
const notionMethodBrowserDetailSchema = z
  .object({
    /** How many times the walk saw this operation called. A frequency, never a payload. */
    callCount: z.number().int().positive(),
    /** Every response field name observed at the body's top level, sorted. */
    responseFields: z.array(z.string().min(1)),
    /** Which declared page surfaces caused this call, sorted. */
    seenOnPages: z.array(z.string().min(1)),
    /** The last HTTP status observed for it. */
    statusCode: z.number().int(),
  })
  .strict();

export type NotionMethodBrowserDetail = z.infer<typeof notionMethodBrowserDetailSchema>;

/**
 * What the browser saw one declared PAGE be: whether it was reached at all, what it settled on, and how
 * much of its own traffic the walk actually accounted for.
 *
 * The screenshot is not here — it is a {@link NotionSource} artifact, addressed by digest, because the
 * ruling is that the atlas HOLDS the picture rather than a link to one. `unreachableBecause` is what makes
 * a declared page that 404s a recorded row rather than a silent absence.
 *
 * @internal
 */
export const notionPageDetailSchema = atlasPageDetailSchema;

export type NotionPageDetail = AtlasPageDetail;

/**
 * What the browser saw one declared settings TAB be — the `page`-kind detail an entity whose provider id
 * starts `settings/` carries instead of {@link NotionPageDetail}.
 *
 * A tab has no address, no status code and no response accounting (`settingsWalk.ts`), so none of the page
 * fields apply. What it carries is what the settings transport can witness: whether the modal's rail was
 * showing, how many rail entries matched the tab's names, and whether the client marked it selected. The
 * screenshot, as for a page, is the channel source's artifact rather than a field here.
 *
 * @internal
 */
export const notionSettingsTabDetailSchema = z
  .object({
    dialogOpen: z.boolean(),
    /** The rail group the tab sits in, as `settingsTabs.ts` declares it. */
    group: z.string().min(1),
    /** Every accessible name the tab was asked for under. */
    names: z.array(z.string().min(1)),
    notRenderedBecause: z.string().min(1).nullable(),
    screenshotMissingBecause: z.string().min(1).nullable(),
    /** Whether the client marked the requested tab selected — the witness a capture is graded on. */
    selectionVerified: z.boolean(),
    tabId: z.string().min(1),
    tabMatches: z.number().int().nullable(),
  })
  .strict();

export type NotionSettingsTabDetail = z.infer<typeof notionSettingsTabDetailSchema>;

/** One channel's independent view of one entity. A successful look replaces only this channel's own detail. */
const notionChannelEntitySchema = z
  .object({
    channel: z.enum(NOTION_ATLAS_CHANNELS),
    /** What this channel knows about this entity. Shape depends on the kind — see the three detail schemas. */
    detail: z.unknown().nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: notionSourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

export type NotionChannelEntity = z.infer<typeof notionChannelEntitySchema>;

/** One tracked entity: a stable identity, plus whatever each channel independently knows about it. */
const notionAtlasEntitySchema = z
  .object({
    channels: z
      .object({ api: notionChannelEntitySchema.nullable(), browser: notionChannelEntitySchema.nullable() })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(NOTION_ATLAS_KINDS),
    /**
     * The provider's own key: `<METHOD> <path shape>` for a method, the declared route for a page. This is
     * what the two channels are matched on, byte-exactly.
     */
    providerId: z.string().min(1),
  })
  .strict();

export type NotionAtlasEntity = z.infer<typeof notionAtlasEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel. `lastSuccessAt` and
 * `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one timestamp cannot answer
 * "is this still current" after a run that failed following one that succeeded.
 */
const notionCoverageCellSchema = z
  .object({
    artifacts: z.array(notionArtifactRefSchema),
    channel: z.enum(NOTION_ATLAS_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.enum(NOTION_VISIBILITY_SCOPES),
  })
  .strict();

export type NotionCoverageCell = z.infer<typeof notionCoverageCellSchema>;

/**
 * A gap, as stored. This atlas's own condition vocabulary plus kind — see `gaps.ts`.
 *
 * `fields` and `surfaces` carry the CONTENT of a disagreement: which names one surface has and the other
 * does not, and which two surfaces those were. A disagreement gap without them says only that a
 * disagreement happened, which is a notification rather than a finding.
 */
export const notionAtlasGapSchema = z
  .object({
    condition: z.string().min(1),
    /** Which names the two surfaces disagree about. Empty unless the condition is a disagreement. */
    fields: z.array(z.string().min(1)),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(NOTION_ATLAS_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    /** Which surfaces this gap concerns. Two, for a disagreement; empty when surface-independent. */
    surfaces: z.array(z.enum(NOTION_ATLAS_CHANNELS)),
  })
  .strict();

export type NotionAtlasGap = z.infer<typeof notionAtlasGapSchema>;

/** One kind's file on disk. */
export const notionAtlasKindFileSchema = z
  .object({
    coverage: z.array(notionCoverageCellSchema),
    entities: z.array(notionAtlasEntitySchema),
    gaps: z.array(notionAtlasGapSchema),
    kind: z.enum(NOTION_ATLAS_KINDS),
    platform: z.literal(NOTION_ATLAS_PLATFORM),
    schemaVersion: z.literal(NOTION_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type NotionAtlasKindFile = z.infer<typeof notionAtlasKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const notionAtlasKindStatusSchema = z
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
export type NotionAtlasKindStatus = z.infer<typeof notionAtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const notionAtlasManifestSchema = z
  .object({
    kinds: z.record(z.enum(NOTION_ATLAS_KINDS), notionAtlasKindStatusSchema),
    platform: z.literal(NOTION_ATLAS_PLATFORM),
    schemaVersion: z.literal(NOTION_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type NotionAtlasManifest = z.infer<typeof notionAtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialNotionManifest({ updatedAt }: { updatedAt: string }): NotionAtlasManifest {
  const empty: NotionAtlasKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  return {
    kinds: { method: empty, page: empty },
    platform: NOTION_ATLAS_PLATFORM,
    schemaVersion: NOTION_ATLAS_SCHEMA_VERSION,
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
export function emptyNotionKindFile({
  kind,
  updatedAt,
}: {
  kind: NotionAtlasKind;
  updatedAt: string;
}): NotionAtlasKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: NOTION_ATLAS_PLATFORM,
    schemaVersion: NOTION_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}
