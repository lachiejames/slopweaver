/**
 * The Slack atlas's on-disk vocabulary — the generation that holds BOTH surfaces, and the schemas that
 * refuse to trust it.
 *
 * ## Why this atlas gained a generation when `atlas slack-api` deliberately has none
 *
 * `slackApiRun.ts` argues, correctly, that a map of the installed SDK must be built on demand: its subject
 * changes only when `yarn.lock` does, so a stored generation would go stale silently on a dependency bump.
 * That argument is about the API surface and it still holds. It does not extend to the browser surface,
 * whose subject is a live first-party web client that ships several times a week under an account whose
 * own entitlements move — exactly the "this is what was there at 09:00" case a stored generation exists
 * for. So the SDK half is still recomputed on every build; what a generation preserves is what the browser
 * SAW, and when.
 *
 * ## Two channels, matched on the provider's own key, byte-exact
 *
 * An entity's id is derived from the dotted method name and nothing else (owner's call), and
 * that exactness IS the disagreement detector. A normalising or fuzzy match would fold
 * `conversations.history` and a `.v2` sibling into one entity and manufacture an agreement that was never
 * observed — which would hide precisely the browser-only surface this atlas was built to find. A name seen
 * on one surface and not the other is therefore a RECORD, never a match failure:
 *
 *  - both channels filled — comparable: the parameter and response-path diffs are real findings;
 *  - `api` only — the SDK declares a method the walked session's web client never called;
 *  - `browser` only — an UNDOCUMENTED surface, which is the finding the both-surfaces ruling is about.
 *
 * ## Nothing here holds a value
 *
 * Every field a `method` entity carries is a NAME: a method, a parameter, a response field path. The
 * reduction that guarantees it is `harObservations.ts`, which is committed and tested precisely so it can be
 * reviewed rather than trusted, and which every driven-browser observation passes through before it reaches
 * this shape. A `page` entity holds a title, a URL and a screenshot — see {@link slackPageDetailSchema} on
 * why the screenshot is the one place bytes of a real workspace are deliberately kept.
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
 * The on-disk schema version for the Slack atlas. Bump only with a real layout change; `atlasStore.ts`
 * refuses to read a generation declaring a different version, naming the reset remedy.
 */
export const SLACK_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — `slack`, never `slack-api`. The API and the browser are
 * two SURFACES of this one atlas, which is the whole point of the kit contract's header.
 */
export const SLACK_ATLAS_PLATFORM = "slack";

/** The entity kinds this atlas holds. Iterated by the reader, never derived from the directory listing. */
export const SLACK_ATLAS_KINDS = ["method", "page"] as const;

export type SlackAtlasKind = (typeof SLACK_ATLAS_KINDS)[number];

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what the other already knew.
 */
export const SLACK_ATLAS_CHANNELS = ["api", "browser"] as const;

export type SlackAtlasChannel = (typeof SLACK_ATLAS_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type SlackEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type SlackCoverageState = AtlasCoverageState;

/**
 * The permanent claim boundary every coverage cell carries.
 *
 * Both surfaces are bounded by one account's own entitlements: the API half sees what the installed SDK
 * declares, and the browser half sees what THIS signed-in member's web client chose to fetch. A method a
 * different member's client would call — an admin console's, say — is outside this atlas's reach and always
 * will be, so "complete" here means complete for one member's session. This is permanent, not a placeholder.
 */
export const SLACK_ATLAS_VISIBILITY_SCOPE = "one-member-session";

const isoSchema = z.iso.datetime();

/** One artifact backing a fact — a proof screenshot, an extracted page. Kit-owned.
 * @internal
 */
export const slackArtifactRefSchema = atlasArtifactRefSchema;

export type SlackArtifactRef = z.infer<typeof slackArtifactRefSchema>;

/**
 * Where a record came from, and the link that proves it to a human.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const slackSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(SLACK_ATLAS_CHANNELS) })
  .strict();

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type SlackSource = z.infer<typeof slackSourceSchema>;

/**
 * What the API surface knows about one method: the argument and response NAMES the installed SDK declares.
 *
 * Deliberately not the SDK's own types verbatim. The comparison this atlas exists to make is name-against-
 * name, so the stored shape is the two name sets and the SDK's one-line description, which is what makes a
 * diff against the browser channel a set operation rather than a parse.
 */
export const slackMethodApiDetailSchema = z
  .object({
    /** The SDK's own one-line description, or `""` when it declares none. */
    description: z.string(),
    /** Every argument name the SDK declares, sorted. */
    paramNames: z.array(z.string().min(1)),
    /** Every response field path the SDK declares, top level and one level down, sorted. */
    responsePaths: z.array(z.string().min(1)),
  })
  .strict();

export type SlackMethodApiDetail = z.infer<typeof slackMethodApiDetailSchema>;

/**
 * What the browser surface saw one method do: the parameters the first-party client actually sent and the
 * response field paths it actually got back, both redacted to names by `harObservations.ts`.
 */
export const slackMethodBrowserDetailSchema = z
  .object({
    /** How many times the driven session saw this method called. A frequency, never a payload. */
    callCount: z.number().int().positive(),
    /** Every parameter name observed on the wire, session telemetry already dropped, sorted. */
    paramNames: z.array(z.string().min(1)),
    /** Every response field path observed, value-shaped segments redacted to `<ts>`/`<id>`, sorted. */
    responsePaths: z.array(z.string().min(1)),
    /** How many distinct paths were seen before {@link BROWSER_PATH_CAP} truncated the list. */
    responsePathsTotal: z.number().int().nonnegative(),
  })
  .strict();

export type SlackMethodBrowserDetail = z.infer<typeof slackMethodBrowserDetailSchema>;

/**
 * What the browser surface saw one PAGE be: its title, the address it settled on, and how many API calls it
 * caused.
 *
 * The screenshot itself is not here — it is an {@link SlackSource.artifacts} entry, addressed by digest,
 * because the ruling is that the atlas HOLDS the picture rather than a link to one. A page's title is the
 * one place a real workspace's own words reach a kind file; it is what a reader needs to know which page
 * they are looking at, and it is the workspace's own navigation chrome rather than anybody's content.
 */
export const slackPageDetailSchema = z
  .object({
    /** How many `/api/<method>` calls this page caused while it was being driven. */
    apiCallCount: z.number().int().nonnegative(),
    /** The document title the page settled on. */
    title: z.string(),
    /** The address the browser ended on, which a redirect may have changed. */
    url: z.url(),
  })
  .strict();

/**
 * What the browser saw one page be.
 * @internal
 */
export type SlackPageDetail = z.infer<typeof slackPageDetailSchema>;

/** One channel's independent view of one entity. A successful look replaces only this channel's own detail. */
export const slackChannelEntitySchema = z
  .object({
    channel: z.enum(SLACK_ATLAS_CHANNELS),
    /** What this channel knows about this entity. Shape depends on the kind — see the three detail schemas. */
    detail: z.unknown().nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: slackSourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

export type SlackChannelEntity = z.infer<typeof slackChannelEntitySchema>;

/** One tracked entity: a stable identity, plus whatever each channel independently knows about it. */
const slackAtlasEntitySchema = z
  .object({
    channels: z
      .object({ api: slackChannelEntitySchema.nullable(), browser: slackChannelEntitySchema.nullable() })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(SLACK_ATLAS_KINDS),
    /** The provider's own key: a dotted method name, or a page's own path. This is what the match is on. */
    providerId: z.string().min(1),
  })
  .strict();

export type SlackAtlasEntity = z.infer<typeof slackAtlasEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel. `lastSuccessAt` and
 * `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one timestamp cannot answer
 * "is this still current" after a run that failed following one that succeeded.
 */
const slackCoverageCellSchema = z
  .object({
    artifacts: z.array(slackArtifactRefSchema),
    channel: z.enum(SLACK_ATLAS_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.literal(SLACK_ATLAS_VISIBILITY_SCOPE),
  })
  .strict();

export type SlackCoverageCell = z.infer<typeof slackCoverageCellSchema>;

/**
 * A gap, as stored. This atlas's own condition vocabulary plus kind — see `kit/gaps.ts`.
 *
 * `fields` and `surfaces` are stored rather than dropped, unlike the pre-kit atlases which carry neither.
 * They are the entire content of an `api-browser-disagreement`: WHICH names one surface has and the other
 * does not, and which two surfaces those were. A disagreement gap without them says only that a
 * disagreement happened, which is a notification rather than a finding.
 */
export const slackAtlasGapSchema = z
  .object({
    condition: z.string().min(1),
    /** Which names the two surfaces disagree about. Empty unless the condition is a disagreement. */
    fields: z.array(z.string().min(1)),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(SLACK_ATLAS_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    /** Which surfaces this gap concerns. Two, for a disagreement; empty when surface-independent. */
    surfaces: z.array(z.enum(SLACK_ATLAS_CHANNELS)),
  })
  .strict();

export type SlackAtlasGap = z.infer<typeof slackAtlasGapSchema>;

/** One kind's file on disk. */
export const slackAtlasKindFileSchema = z
  .object({
    coverage: z.array(slackCoverageCellSchema),
    entities: z.array(slackAtlasEntitySchema),
    gaps: z.array(slackAtlasGapSchema),
    kind: z.enum(SLACK_ATLAS_KINDS),
    platform: z.literal(SLACK_ATLAS_PLATFORM),
    schemaVersion: z.literal(SLACK_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type SlackAtlasKindFile = z.infer<typeof slackAtlasKindFileSchema>;

/** What is known about one kind's synchronisation history.
 * @internal
 */
export const slackAtlasKindStatusSchema = z
  .object({
    /** A digest of the bytes published, so a later half-write is detectable rather than silent.
     * @internal
     */
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

export type SlackAtlasKindStatus = z.infer<typeof slackAtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const slackAtlasManifestSchema = z
  .object({
    kinds: z.record(z.enum(SLACK_ATLAS_KINDS), slackAtlasKindStatusSchema),
    platform: z.literal(SLACK_ATLAS_PLATFORM),
    schemaVersion: z.literal(SLACK_ATLAS_SCHEMA_VERSION),
    /** The `@slack/web-api` version the API channel was read from, so a stale generation announces itself. */
    sdkVersion: z.string().min(1),
    updatedAt: isoSchema,
  })
  .strict();

export type SlackAtlasManifest = z.infer<typeof slackAtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param sdkVersion the installed `@slack/web-api` version this generation's API channel was read from
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialSlackAtlasManifest({
  sdkVersion,
  updatedAt,
}: {
  sdkVersion: string;
  updatedAt: string;
}): SlackAtlasManifest {
  const empty: SlackAtlasKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  return {
    kinds: { method: empty, page: empty },
    platform: SLACK_ATLAS_PLATFORM,
    schemaVersion: SLACK_ATLAS_SCHEMA_VERSION,
    sdkVersion,
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
export function emptySlackAtlasKindFile({
  kind,
  updatedAt,
}: {
  kind: SlackAtlasKind;
  updatedAt: string;
}): SlackAtlasKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: SLACK_ATLAS_PLATFORM,
    schemaVersion: SLACK_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}
