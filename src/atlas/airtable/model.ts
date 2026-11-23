/**
 * The Airtable atlas's on-disk vocabulary — the generation that holds BOTH surfaces AND the entities, and
 * the schemas that refuse to trust it.
 *
 * ## This atlas holds EVERYTHING REACHABLE, which is the opposite of Notion's and Slack's
 *
 * `docs/atlas-intent/06-holdings.md` states the test: does something better suited already hold this platform's
 * entities? For Slack and Notion the answer is yes — the corpus holds their channels, people and pages — so
 * those atlases map the interface alone. For Airtable the answer is **no, and nothing else even comes
 * close**: no corpus source ingests Airtable, nothing else in this installation knows a base exists, and the
 * handover names the reason it matters — _"ops tables that live nowhere else and are referenced in Slack
 * constantly"_. So this atlas holds the bases, the tables, the fields, the views, the records and the
 * people, and `kinds.ts` is the list.
 *
 * ## Two channels, and here they are COMPLEMENTARY rather than disjoint
 *
 * `api` is the public REST surface Airtable's own OpenAPI document declares, pinned in
 * `generated/specLock.ts`. `browser` is the first-party web client — the only channel that can see a view's
 * configuration, an automation, an interface layout or the admin panel, because the document declares a
 * `workflow` tag and ships zero operations under it.
 *
 * On Notion the two channels were almost entirely disjoint and that disjointness was the finding. Here the
 * expectation is the reverse: most entities should be reachable BOTH ways, which makes an entity only one
 * channel can see the interesting row. Nothing in the merge assumes either outcome — `merge.ts` keeps the
 * two channels independent whichever way it falls, so the corroboration is a RECORD rather than an
 * assertion.
 *
 * ## A cell may hold a VALUE, and that is why `_sensitive` is not expected to stay empty
 *
 * Every sibling atlas that maps a surface stores only names. This one stores a record's cells, because the
 * cells ARE the ops tables. So this is the first atlas here whose generation carries real organisational
 * content, and the consequences are stated rather than discovered: it lives under the private state home,
 * it is never committed, and `sensitiveFields.ts` names the fields withheld from it by KIND — a share's
 * token prefix, a webhook's MAC secret, an export's signed download URL.
 *
 * ## The two ceilings are unrelated, so a coverage cell carries whichever one produced it
 *
 * The API channel sees exactly what its personal access token's SCOPES and resource grant allow — a token
 * property, nothing to do with any human. The browser channel sees exactly what the signed-in person's own
 * Airtable role opens, which here is enterprise admin. Neither implies the other, so one `visibilityScope`
 * for the atlas would be false about one channel whichever value it took.
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
import { AIRTABLE_ATLAS_KINDS, type AirtableAtlasKind } from "./kinds.js";

/**
 * The on-disk schema version. Bump only with a real layout change; `store.ts` refuses to read a generation
 * declaring a different version, naming the reset remedy.
 */
export const AIRTABLE_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — the REST API and the web client are two SURFACES of this
 * one atlas, which is the whole point of the kit contract's header.
 */
export const AIRTABLE_ATLAS_PLATFORM = "airtable";

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what the other already knew.
 */
export const AIRTABLE_ATLAS_CHANNELS = ["api", "browser"] as const;

/** How a fact was reached. */
export type AirtableAtlasChannel = (typeof AIRTABLE_ATLAS_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type AirtableEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type AirtableCoverageState = AtlasCoverageState;

/**
 * The claim boundary a coverage cell carries — one per channel, because the two ceilings are unrelated.
 * @internal
 */
export const AIRTABLE_VISIBILITY_SCOPES = ["api-token-scopes", "browser-signed-in-role"] as const;

/**
 * The claim boundary one channel reads under.
 * @internal
 */
export type AirtableVisibilityScope = (typeof AIRTABLE_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one channel reads under.
 *
 * @param channel the channel that produced the cell
 * @returns that channel's own ceiling
 */
export function airtableVisibilityScopeFor({ channel }: { channel: AirtableAtlasChannel }): AirtableVisibilityScope {
  return channel === "api" ? "api-token-scopes" : "browser-signed-in-role";
}

const isoSchema = z.iso.datetime();

/** One artifact backing a fact — a proof screenshot. Kit-owned. */
const airtableArtifactRefSchema = atlasArtifactRefSchema;

/** One artifact backing a fact. */
export type AirtableArtifactRef = z.infer<typeof airtableArtifactRefSchema>;

/**
 * Where a record came from, and the link that proves it to a human.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const airtableSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(AIRTABLE_ATLAS_CHANNELS) })
  .strict();

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type AirtableSource = z.infer<typeof airtableSourceSchema>;

/**
 * What the API surface knows about one operation: everything the pinned document states about it, reduced
 * to names, plus what this atlas decided to DO with it.
 *
 * `disposition` is on the stored entity rather than only in the generated registry because a reader asking
 * the atlas "can you tell me about audit events" needs the answer "yes, and only their shape" from the
 * atlas itself — not from a source file they would have to go and read.
 */
const airtableMethodApiDetailSchema = z
  .object({
    /** Every credential form the document says this operation accepts, sorted. */
    authMethods: z.array(z.string().min(1)),
    disposition: z.enum(["entity", "shape-index", "probe-only", "excluded"]),
    /** Why the disposition is not a plain `entity`, in English. `null` only when it is one. */
    dispositionBecause: z.string().min(1).nullable(),
    /** Which refusal applied. `null` unless the disposition is `excluded`. */
    exclusionReason: z.enum(["mutating", "side-effecting"]).nullable(),
    method: z.string().min(1),
    /** How a caller walks a result set larger than one response. */
    paging: z.string().min(1),
    /** The document's own path template, `{brace}` parameters intact. */
    path: z.string().min(1),
    /** Every OAuth scope the document says this operation requires, sorted. */
    scopes: z.array(z.string().min(1)),
    /** Airtable's own one-line summary, or `null` when it publishes none. */
    summary: z.string().min(1).nullable(),
    /** Airtable's own first tag, kept so the provider's vocabulary stays greppable beside ours. */
    tag: z.string().min(1),
    /** Whether this operation's volume is judged per scope at sync time. See `surfaceRow.ts`. */
    volumeJudgedPerScope: z.boolean(),
  })
  .strict();

/** What the API surface knows about one operation. */
export type AirtableMethodApiDetail = z.infer<typeof airtableMethodApiDetailSchema>;

/*
 * There is deliberately NO browser-detail schema here, and its absence is the point rather than an
 * omission waiting to be filled.
 *
 * The Notion and Vanta atlases each declare one, because each ships a walk that produces one. This atlas
 * ships no walk: `descriptor.ts` records that the account is not a member of the organisation's Airtable
 * enterprise, so every page a walk could reach is a sign-in screen. Declaring the shape a walk WOULD write
 * would be a contract nothing has ever satisfied. `kit/pageObservation.ts` now owns that shape for the
 * atlases that DO walk, which is the right home for it and is also why declaring a local one here would be
 * the wrong move twice over.
 *
 * The `browser` channel is still real and still stores a detail: `projection.ts` writes what the
 * unauthenticated route probe established. `detail` is `unknown` on the channel entity, so that needs no
 * schema of its own, and the day a walk exists its shape is designed against a real capture rather than
 * guessed at here.
 */

/** One channel's independent view of one entity. A successful look replaces only this channel's own detail. */
const airtableChannelEntitySchema = z
  .object({
    channel: z.enum(AIRTABLE_ATLAS_CHANNELS),
    /** What this channel knows about this entity. Shape depends on the kind — see the detail schemas. */
    detail: z.unknown().nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: airtableSourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

/** One channel's independent view of one entity. */
export type AirtableChannelEntity = z.infer<typeof airtableChannelEntitySchema>;

/** One tracked entity: a stable identity, plus whatever each channel independently knows about it. */
const airtableAtlasEntitySchema = z
  .object({
    channels: z
      .object({ api: airtableChannelEntitySchema.nullable(), browser: airtableChannelEntitySchema.nullable() })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(AIRTABLE_ATLAS_KINDS),
    /**
     * The provider's own key: `<METHOD> <path template>` for a method, the declared route for a page, and
     * Airtable's own record id (`app…`, `tbl…`, `fld…`, `viw…`, `rec…`, `usr…`) for an entity. This is what
     * the two channels are matched on, byte-exactly.
     */
    providerId: z.string().min(1),
    /**
     * Which base, workspace or enterprise account this entity sits under, so a reader can filter without
     * decoding a provider id. `null` for a platform-level row — a method, a page, the enterprise itself.
     */
    scope: z.string().min(1).nullable(),
  })
  .strict();

/** One tracked entity. */
export type AirtableAtlasEntity = z.infer<typeof airtableAtlasEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel. `lastSuccessAt` and
 * `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one timestamp cannot answer
 * "is this still current" after a run that failed following one that succeeded.
 */
const airtableCoverageCellSchema = z
  .object({
    artifacts: z.array(airtableArtifactRefSchema),
    channel: z.enum(AIRTABLE_ATLAS_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.enum(AIRTABLE_VISIBILITY_SCOPES),
  })
  .strict();

/** One coverage cell. */
export type AirtableCoverageCell = z.infer<typeof airtableCoverageCellSchema>;

/**
 * A gap, as stored. This atlas's own condition vocabulary plus kind — see `gaps.ts`.
 *
 * `fields` and `surfaces` carry the CONTENT of a disagreement: which names one surface has and the other
 * does not, and which two surfaces those were. A disagreement gap without them says only that a
 * disagreement happened, which is a notification rather than a finding.
 */
export const airtableAtlasGapSchema = z
  .object({
    condition: z.string().min(1),
    /** Which names the two surfaces disagree about. Empty unless the condition is a disagreement. */
    fields: z.array(z.string().min(1)),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(AIRTABLE_ATLAS_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    /** Which surfaces this gap concerns. Two, for a disagreement; empty when surface-independent. */
    surfaces: z.array(z.enum(AIRTABLE_ATLAS_CHANNELS)),
  })
  .strict();

/** A gap, as stored. */
export type AirtableAtlasGap = z.infer<typeof airtableAtlasGapSchema>;

/** One kind's file on disk. */
export const airtableAtlasKindFileSchema = z
  .object({
    coverage: z.array(airtableCoverageCellSchema),
    entities: z.array(airtableAtlasEntitySchema),
    gaps: z.array(airtableAtlasGapSchema),
    kind: z.enum(AIRTABLE_ATLAS_KINDS),
    platform: z.literal(AIRTABLE_ATLAS_PLATFORM),
    schemaVersion: z.literal(AIRTABLE_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

/** One kind's file on disk. */
export type AirtableAtlasKindFile = z.infer<typeof airtableAtlasKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const airtableAtlasKindStatusSchema = z
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
export type AirtableAtlasKindStatus = z.infer<typeof airtableAtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const airtableAtlasManifestSchema = z
  .object({
    kinds: z.record(z.enum(AIRTABLE_ATLAS_KINDS), airtableAtlasKindStatusSchema),
    platform: z.literal(AIRTABLE_ATLAS_PLATFORM),
    schemaVersion: z.literal(AIRTABLE_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

/** The manifest. */
export type AirtableAtlasManifest = z.infer<typeof airtableAtlasManifestSchema>;

/** A never-synced status, shared by every kind in a fresh manifest. */
const NEVER_SYNCED: AirtableAtlasKindStatus = {
  digest: null,
  entityCount: 0,
  lastAttempt: null,
  lastSuccessAt: null,
};

/**
 * One value per kind, with every key spelled out so the COMPILER checks the record is complete.
 *
 * The obvious spelling is `Object.fromEntries(AIRTABLE_ATLAS_KINDS.map(…))`, and it needs a type assertion
 * to become a `Record<AirtableAtlasKind, T>` because `fromEntries` returns a `Record<string, T>`. That
 * assertion is exactly what `no-unsafe-type-assertion` refuses, and refuses correctly: it would claim
 * completeness rather than establish it, and `airtableAtlasManifestSchema.kinds` is a `z.record`, so a
 * missing key is not a parse error either. Nothing would have caught a kind that stopped being initialised.
 *
 * Nineteen keys is the price of the compiler doing that check, and `stateHome.ts` pays the same price for
 * the same reason on the same list. Adding a kind fails to compile HERE, which is where it should.
 *
 * @param value what to store under each kind, called once per kind
 * @returns the complete record
 */
function airtableKindRecord<T>({ value }: { value: (kind: AirtableAtlasKind) => T }): Record<AirtableAtlasKind, T> {
  return {
    base: value("base"),
    comment: value("comment"),
    credential: value("credential"),
    enterprise: value("enterprise"),
    "event-shape": value("event-shape"),
    "export-request": value("export-request"),
    extension: value("extension"),
    field: value("field"),
    group: value("group"),
    interface: value("interface"),
    method: value("method"),
    page: value("page"),
    person: value("person"),
    record: value("record"),
    share: value("share"),
    table: value("table"),
    view: value("view"),
    webhook: value("webhook"),
    workspace: value("workspace"),
  };
}

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialAirtableManifest({ updatedAt }: { updatedAt: string }): AirtableAtlasManifest {
  return {
    kinds: airtableKindRecord({ value: () => NEVER_SYNCED }),
    platform: AIRTABLE_ATLAS_PLATFORM,
    schemaVersion: AIRTABLE_ATLAS_SCHEMA_VERSION,
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
export function emptyAirtableKindFile({
  kind,
  updatedAt,
}: {
  kind: AirtableAtlasKind;
  updatedAt: string;
}): AirtableAtlasKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: AIRTABLE_ATLAS_PLATFORM,
    schemaVersion: AIRTABLE_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}

/**
 * An empty file for every kind, so a freshly installed generation is complete rather than partial.
 *
 * @param at the ISO timestamp to stamp
 * @returns one empty file per kind
 */
export function emptyAirtableKindFiles({
  at,
}: {
  at: string;
}): Readonly<Record<AirtableAtlasKind, AirtableAtlasKindFile>> {
  return airtableKindRecord({ value: (kind) => emptyAirtableKindFile({ kind, updatedAt: at }) });
}
