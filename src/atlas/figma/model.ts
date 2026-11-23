/**
 * The Figma atlas's on-disk vocabulary — the generation that holds BOTH surfaces AND the entities, and the
 * schemas that refuse to trust it.
 *
 * ## This atlas holds EVERYTHING REACHABLE, which is the opposite of Notion's and Slack's
 *
 * `docs/atlas-intent/06-holdings.md` states the test: does something better suited already hold this platform's
 * entities? For Slack and Notion the answer is yes — the corpus holds their channels, people and pages — so
 * those atlases map the interface alone. For Figma the answer is no, and nothing else comes close: no
 * corpus source ingests Figma, nothing else in this installation knows a Figma file, component, variable or
 * published library exists. So this atlas holds them, and `kinds.ts` is the list.
 *
 * Today every one of those entity kinds is empty for want of a credential, which is a state each of them
 * SAYS rather than a silence — see `sync.ts` on why sixteen `not-configured` cells are the point rather
 * than an omission.
 *
 * ## Two channels, and on this platform they are FAR from interchangeable
 *
 * `api` is the public REST surface Figma's own OpenAPI document declares, pinned in
 * `generated/specLock.ts`. `browser` is the first-party web client.
 *
 * The asymmetry here is sharper than on any sibling atlas and it is the reason both channels are modelled
 * independently rather than merged. The REST document has no operation that returns a team, an
 * organisation, a membership or an organisation setting — its whole `Users` tag is one endpoint describing
 * the caller — and it names three OAuth endpoints it declares no path for. So the browser is not a
 * corroborating second look here; for several kinds it is the only channel that can see anything at all.
 * `merge.ts` keeps the two independent whichever way a given kind falls, so the corroboration stays a
 * RECORD rather than an assertion (`docs/atlas-intent/04-corroboration.md`).
 *
 * ## The two ceilings are unrelated, so a coverage cell carries whichever one produced it
 *
 * The API channel sees exactly what its token's TYPE and scopes allow — and on Figma the type matters as
 * much as the scopes, since a personal access token and a plan access token are both `X-Figma-Token`
 * headers reaching different operation sets. The browser channel sees exactly what the signed-in person's
 * own Figma role opens. Neither implies the other, so one `visibilityScope` for the atlas would be false
 * about one channel whichever value it took.
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
import { FIGMA_ATLAS_KINDS, type FigmaAtlasKind } from "./kinds.js";

/**
 * The on-disk schema version. Bump only with a real layout change; `store.ts` refuses to read a generation
 * declaring a different version, naming the reset remedy.
 */
export const FIGMA_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — the REST API and the web client are two SURFACES of this
 * one atlas, which is the whole point of the kit contract's header.
 */
export const FIGMA_ATLAS_PLATFORM = "figma";

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what the other already knew.
 */
export const FIGMA_ATLAS_CHANNELS = ["api", "browser"] as const;

/** How a fact was reached. */
export type FigmaAtlasChannel = (typeof FIGMA_ATLAS_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type FigmaEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type FigmaCoverageState = AtlasCoverageState;

/**
 * The claim boundary a coverage cell carries — one per channel, because the two ceilings are unrelated.
 * @internal
 */
export const FIGMA_VISIBILITY_SCOPES = ["api-token-scopes", "browser-signed-in-role"] as const;

/**
 * The claim boundary one channel reads under.
 * @internal
 */
export type FigmaVisibilityScope = (typeof FIGMA_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one channel reads under.
 *
 * @param channel the channel that produced the cell
 * @returns that channel's own ceiling
 */
export function figmaVisibilityScopeFor({ channel }: { channel: FigmaAtlasChannel }): FigmaVisibilityScope {
  return channel === "api" ? "api-token-scopes" : "browser-signed-in-role";
}

const isoSchema = z.iso.datetime();

/** One artifact backing a fact — a proof screenshot. Kit-owned. */
const figmaArtifactRefSchema = atlasArtifactRefSchema;

/** One artifact backing a fact. */
export type FigmaArtifactRef = z.infer<typeof figmaArtifactRefSchema>;

/**
 * Where a record came from, and the link that proves it to a human.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const figmaSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(FIGMA_ATLAS_CHANNELS) })
  .strict();

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type FigmaSource = z.infer<typeof figmaSourceSchema>;

/**
 * What the API surface knows about one operation: everything the pinned document states about it, reduced
 * to names, plus what this atlas decided to DO with it.
 *
 * `disposition` is on the stored entity rather than only in the generated registry because a reader asking
 * the atlas "can you tell me about the activity log" needs the answer "yes, and only its shape" from the
 * atlas itself — not from a source file they would have to go and read.
 */
const figmaMethodApiDetailSchema = z
  .object({
    /** Every credential form the document says this operation accepts, sorted. */
    authMethods: z.array(z.string().min(1)),
    /** Whether the document marks this operation deprecated. Still served, and still in the registry. */
    deprecated: z.boolean(),
    disposition: z.enum(["entity", "shape-index", "probe-only", "excluded"]),
    /** Why the disposition is not a plain `entity`, in English. `null` only when it is one. */
    dispositionBecause: z.string().min(1).nullable(),
    /** Which refusal applied. `null` unless the disposition is `excluded`. */
    exclusionReason: z.enum(["mutating", "render-only", "not-enumerable"]).nullable(),
    method: z.string().min(1),
    /** How a caller walks a result set larger than one response. */
    paging: z.string().min(1),
    /** The document's own path template, `{brace}` parameters intact. */
    path: z.string().min(1),
    /** Every OAuth scope the document says this operation requires, sorted. */
    scopes: z.array(z.string().min(1)),
    /** Figma's own one-line summary, or `null` when it publishes none. */
    summary: z.string().min(1).nullable(),
    /** Figma's own first tag, kept so the provider's vocabulary stays greppable beside ours. */
    tag: z.string().min(1),
  })
  .strict();

/** What the API surface knows about one operation. */
export type FigmaMethodApiDetail = z.infer<typeof figmaMethodApiDetailSchema>;

/*
 * There is deliberately NO browser-detail schema here, and its absence is the point rather than an
 * omission waiting to be filled.
 *
 * The Notion and Vanta atlases each declare one, because each ships a walk that produces one. This atlas
 * ships no walk: this installation holds no Figma credential, so a walk in the owner's own Chrome would
 * photograph the sign-in page forty-one times. Declaring the shape a walk WOULD write would be a contract
 * nothing has ever satisfied, and `kit/pageObservation.ts` already owns that shape for the atlases that DO
 * walk — which is the right home for it and also why declaring a local one here would be wrong twice over.
 *
 * The `browser` channel is still real and still stores a detail: `projection.ts` writes what the
 * unauthenticated route probe established. `detail` is `unknown` on the channel entity, so that needs no
 * schema of its own, and the day a walk exists its shape is designed against a real capture rather than
 * guessed at here.
 */

/** One channel's independent view of one entity. A successful look replaces only this channel's own detail. */
const figmaChannelEntitySchema = z
  .object({
    channel: z.enum(FIGMA_ATLAS_CHANNELS),
    /** What this channel knows about this entity. Shape depends on the kind — see the detail schemas. */
    detail: z.unknown().nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: figmaSourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

/** One channel's independent view of one entity. */
export type FigmaChannelEntity = z.infer<typeof figmaChannelEntitySchema>;

/** One tracked entity: a stable identity, plus whatever each channel independently knows about it. */
const figmaAtlasEntitySchema = z
  .object({
    channels: z
      .object({ api: figmaChannelEntitySchema.nullable(), browser: figmaChannelEntitySchema.nullable() })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(FIGMA_ATLAS_KINDS),
    /**
     * The provider's own key: `<METHOD> <path template>` for a method, the declared route for a page, and
     * Figma's own identifier for an entity — a 22-character file key, a numeric team, project or user id,
     * or a component, style or variable key.
     * This is what the two channels are matched on, byte-exactly.
     */
    providerId: z.string().min(1),
    /**
     * Which team, project or file this entity sits under, so a reader can filter without decoding a
     * provider id. `null` for a platform-level row — a method, a page, a team itself.
     */
    scope: z.string().min(1).nullable(),
  })
  .strict();

/** One tracked entity. */
export type FigmaAtlasEntity = z.infer<typeof figmaAtlasEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel. `lastSuccessAt` and
 * `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one timestamp cannot answer
 * "is this still current" after a run that failed following one that succeeded.
 */
const figmaCoverageCellSchema = z
  .object({
    artifacts: z.array(figmaArtifactRefSchema),
    channel: z.enum(FIGMA_ATLAS_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.enum(FIGMA_VISIBILITY_SCOPES),
  })
  .strict();

/** One coverage cell. */
export type FigmaCoverageCell = z.infer<typeof figmaCoverageCellSchema>;

/**
 * A gap, as stored. This atlas's own condition vocabulary plus kind — see `gaps.ts`.
 *
 * `fields` and `surfaces` carry the CONTENT of a disagreement: which names one surface has and the other
 * does not, and which two surfaces those were. A disagreement gap without them says only that a
 * disagreement happened, which is a notification rather than a finding.
 */
export const figmaAtlasGapSchema = z
  .object({
    condition: z.string().min(1),
    /** Which names the two surfaces disagree about. Empty unless the condition is a disagreement. */
    fields: z.array(z.string().min(1)),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(FIGMA_ATLAS_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    /** Which surfaces this gap concerns. Two, for a disagreement; empty when surface-independent. */
    surfaces: z.array(z.enum(FIGMA_ATLAS_CHANNELS)),
  })
  .strict();

/** A gap, as stored. */
export type FigmaAtlasGap = z.infer<typeof figmaAtlasGapSchema>;

/** One kind's file on disk. */
export const figmaAtlasKindFileSchema = z
  .object({
    coverage: z.array(figmaCoverageCellSchema),
    entities: z.array(figmaAtlasEntitySchema),
    gaps: z.array(figmaAtlasGapSchema),
    kind: z.enum(FIGMA_ATLAS_KINDS),
    platform: z.literal(FIGMA_ATLAS_PLATFORM),
    schemaVersion: z.literal(FIGMA_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

/** One kind's file on disk. */
export type FigmaAtlasKindFile = z.infer<typeof figmaAtlasKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const figmaAtlasKindStatusSchema = z
  .object({
    /** A digest of the bytes published, so a later half-write is detectable rather than silent. */
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

/** @internal */
export type FigmaAtlasKindStatus = z.infer<typeof figmaAtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const figmaAtlasManifestSchema = z
  .object({
    kinds: z.record(z.enum(FIGMA_ATLAS_KINDS), figmaAtlasKindStatusSchema),
    platform: z.literal(FIGMA_ATLAS_PLATFORM),
    schemaVersion: z.literal(FIGMA_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

/** The manifest. */
export type FigmaAtlasManifest = z.infer<typeof figmaAtlasManifestSchema>;

/** A never-synced status, shared by every kind in a fresh manifest. */
const NEVER_SYNCED: FigmaAtlasKindStatus = {
  digest: null,
  entityCount: 0,
  lastAttempt: null,
  lastSuccessAt: null,
};

/**
 * One value per kind, with every key spelled out so the COMPILER checks the record is complete.
 *
 * The obvious spelling is `Object.fromEntries(FIGMA_ATLAS_KINDS.map(…))`, and it needs a type assertion to
 * become a `Record<FigmaAtlasKind, T>` because `fromEntries` returns a `Record<string, T>`. That assertion
 * is exactly what `no-unsafe-type-assertion` refuses, and refuses correctly: it would claim completeness
 * rather than establish it, and `figmaAtlasManifestSchema.kinds` is a `z.record`, so a missing key is not a
 * parse error either. Nothing would have caught a kind that stopped being initialised.
 *
 * Eighteen keys is the price of the compiler doing that check, and `atlasHome.ts` pays the same price for
 * the same reason on the same list. Adding a kind fails to compile HERE, which is where it should.
 *
 * @param value what to store under each kind, called once per kind
 * @returns the complete record
 */
function figmaKindRecord<T>({ value }: { value: (kind: FigmaAtlasKind) => T }): Record<FigmaAtlasKind, T> {
  return {
    comment: value("comment"),
    component: value("component"),
    "component-set": value("component-set"),
    credential: value("credential"),
    "dev-resource": value("dev-resource"),
    "event-shape": value("event-shape"),
    file: value("file"),
    "file-version": value("file-version"),
    folder: value("folder"),
    method: value("method"),
    page: value("page"),
    person: value("person"),
    project: value("project"),
    reaction: value("reaction"),
    style: value("style"),
    team: value("team"),
    variable: value("variable"),
    webhook: value("webhook"),
  };
}

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialFigmaManifest({ updatedAt }: { updatedAt: string }): FigmaAtlasManifest {
  return {
    kinds: figmaKindRecord({ value: () => NEVER_SYNCED }),
    platform: FIGMA_ATLAS_PLATFORM,
    schemaVersion: FIGMA_ATLAS_SCHEMA_VERSION,
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
export function emptyFigmaKindFile({
  kind,
  updatedAt,
}: {
  kind: FigmaAtlasKind;
  updatedAt: string;
}): FigmaAtlasKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: FIGMA_ATLAS_PLATFORM,
    schemaVersion: FIGMA_ATLAS_SCHEMA_VERSION,
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
export function heldFigmaKindFile({
  stored,
  kind,
  updatedAt,
}: {
  stored: FigmaAtlasKindFile | null;
  kind: FigmaAtlasKind;
  updatedAt: string;
}): FigmaAtlasKindFile {
  if (stored === null) {
    return emptyFigmaKindFile({ kind, updatedAt });
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
export function heldFigmaManifest({
  manifest,
  updatedAt,
}: {
  manifest: FigmaAtlasManifest | null;
  updatedAt: string;
}): FigmaAtlasManifest {
  if (manifest === null) {
    return initialFigmaManifest({ updatedAt });
  }
  return manifest;
}

/**
 * An empty file for every kind, so a freshly installed generation is complete rather than partial.
 *
 * @param at the ISO timestamp to stamp
 * @returns one empty file per kind
 */
export function emptyFigmaKindFiles({ at }: { at: string }): Readonly<Record<FigmaAtlasKind, FigmaAtlasKindFile>> {
  return figmaKindRecord({ value: (kind) => emptyFigmaKindFile({ kind, updatedAt: at }) });
}
