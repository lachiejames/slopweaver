/**
 * What the Gemini / Google AI Studio atlas holds, and the permanent boundary of what it can ever claim.
 *
 * ## One platform, three published API versions
 *
 * `generativelanguage.googleapis.com` is the single addressable API behind Google AI Studio, the Gemini
 * developer API and the Gemini app's own model access, and Google publishes it at three versions at once —
 * `v1`, `v1beta` and `v1alpha`. Those are VERSIONS of one surface rather than three atlases, which is what
 * `kit/contract.ts` makes a type. MEASURED against the pinned documents (`specLock.ts`, reproduce with
 * `slopweaver atlas gemini-ai-studio sync --json`): 222 operations across the three, over 13 resource roots,
 * 86 of them `GET`.
 *
 * ## This atlas holds a SURFACE MAP and no entity, by the owner's own ruling
 *
 * `docs/atlas-intent/06-holdings.md` is a test an atlas applies to its own platform: does something better suited
 * already hold this platform's entities? Here the answer is YES, and it is the reason this row exists at all
 * — the Gemini footprint this organisation actually has is a Google Workspace fact (who is licensed for
 * Gemini, which admin policies govern it, what the console reports as usage), and the Google Admin atlas is
 * the row better suited to hold it. So every kind below carries a `held-elsewhere` coverage cell naming that
 * holder, and this atlas maps the INTERFACE: every operation, its parameters and its declared response
 * fields, plus the AI Studio and Gemini pages that reach the same platform through a browser.
 *
 * The holder is itself a surface map rather than a store, and that is said on the cell rather than implied
 * — `gaps.ts`'s `entities-holder-is-a-surface-map` is open for exactly as long as that stays true. A
 * `held-elsewhere` cell that cannot say where is an unfalsifiable claim, and one a reader takes as "somebody
 * has these" would be the same claim wearing a truer-sounding name.
 *
 * ## Kinds are the discovery documents' own first resource segment
 *
 * Not an invented taxonomy: a reader who knows the Gemini API reference knows the kind. The set is the UNION
 * across the three versions, so a root only one version declares — `environments` and `auth_tokens` exist in
 * `v1beta` and `v1alpha` and not in `v1`, `operations` only in `v1` — is a kind here rather than a silent
 * omission, and which versions declare it is a field on the operation itself.
 *
 * ## Nothing here holds a prompt, a completion or a file's bytes
 *
 * Every field an operation entity carries is a NAME: an HTTP method, a path template with its parameters as
 * placeholders, a query parameter name, a response field name. This atlas has never called the platform and
 * holds no API key to call it with.
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
export const GEMINI_AI_STUDIO_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — the developer API, AI Studio and the Gemini app are
 * SURFACES of this one atlas, which is the whole point of the kit contract's header.
 */
export const GEMINI_AI_STUDIO_ATLAS_PLATFORM = "gemini-ai-studio";

/**
 * Every kind this atlas publishes a file for — the union of first resource segments across the three
 * published discovery documents, plus `page` for the browser surface.
 *
 * Written out rather than computed so the list stays a literal union a caller can be checked against, and
 * pinned to the documents by `specLock.ts`, which a sync asserts against. A root Google adds tomorrow is
 * therefore a REFUSAL to publish rather than a silent widening — which is exactly the unknown unknown this
 * atlas exists to surface.
 */
export const GEMINI_AI_STUDIO_KINDS = [
  "auth_tokens",
  "batches",
  "cachedContents",
  "corpora",
  "dynamic",
  "environments",
  "fileSearchStores",
  "files",
  "generatedFiles",
  "media",
  "models",
  "operations",
  "page",
  "tunedModels",
] as const;

/** One kind this atlas publishes. */
export type GeminiAiStudioKind = (typeof GEMINI_AI_STUDIO_KINDS)[number];

/**
 * The kind that holds browser pages rather than API operations.
 *
 * Named rather than inferred because two things branch on it: the sync must not stale it, and a walk must
 * not touch any other kind.
 */
export const GEMINI_AI_STUDIO_PAGE_KIND = "page";

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what the other already knew.
 *
 * `compiled` is Google's own published discovery document, parsed offline; `api` is a live call to
 * `generativelanguage.googleapis.com`; `browser` is a page walked in the owner's real Chrome. The first two
 * are NOT the same channel: a discovery document declaring an operation says nothing whatever about whether
 * any credential here may call it.
 */
export const GEMINI_AI_STUDIO_CHANNELS = ["compiled", "api", "browser"] as const;

export type GeminiAiStudioChannel = (typeof GEMINI_AI_STUDIO_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type GeminiAiStudioEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type GeminiAiStudioCoverageState = AtlasCoverageState;

/**
 * The claim boundary a coverage cell carries — one per channel, because the three ceilings are unrelated.
 *
 * The compiled channel's ceiling is a DOCUMENT and no project at all; the API channel's is whatever a
 * Gemini API key is scoped to, and this installation holds none; the browser channel's is whatever the
 * signed-in Google account can open. One `visibilityScope` for the atlas would be false about two channels
 * whichever value it took.
 *
 * @internal
 */
export const GEMINI_AI_STUDIO_VISIBILITY_SCOPES = [
  "compiled-published-discovery",
  "api-project-key",
  "browser-signed-in-account",
] as const;

/**
 * The claim boundary one channel reads under.
 * @internal
 */
export type GeminiAiStudioVisibilityScope = (typeof GEMINI_AI_STUDIO_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one channel reads under.
 *
 * @param channel the channel that produced the cell
 * @returns that channel's own ceiling
 */
export function geminiAiStudioVisibilityScopeFor({
  channel,
}: {
  channel: GeminiAiStudioChannel;
}): GeminiAiStudioVisibilityScope {
  if (channel === "compiled") {
    return "compiled-published-discovery";
  }
  if (channel === "api") {
    return "api-project-key";
  }
  return "browser-signed-in-account";
}

/**
 * The permanent claim boundary — what "complete" can ever mean for this installation's access.
 *
 * Stated in the credentials' own terms rather than as a reassurance, and it names the one that does not
 * exist: there is no Gemini API key on this installation, so the live channel has no ceiling yet because it
 * has no floor.
 */
export const GEMINI_AI_STUDIO_VISIBILITY_SCOPE =
  "the compiled channel sees exactly three publicly published Google API discovery documents and no project " +
  "at all; the live channel sees whatever a Gemini API key is scoped to, and this installation holds none, " +
  "so it has never called anything; the browser channel sees whatever the signed-in Google account can open " +
  "in AI Studio and the Gemini app, reached through a JumpCloud SaaS-management assignment. None of the " +
  "three implies either other, and 'complete' here is always complete for the channel named on the cell. " +
  "This organisation's own Gemini entities are not on any of them — they are the Google Admin atlas's";

const isoSchema = z.iso.datetime();

/** One artifact backing a fact — a proof screenshot. Kit-owned. */
const geminiAiStudioArtifactRefSchema = atlasArtifactRefSchema;

export type GeminiAiStudioArtifactRef = z.infer<typeof geminiAiStudioArtifactRefSchema>;

/**
 * Where a record came from, through one channel.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const geminiAiStudioSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(GEMINI_AI_STUDIO_CHANNELS) })
  .strict();

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type GeminiAiStudioSource = z.infer<typeof geminiAiStudioSourceSchema>;

/**
 * What this atlas may do with one operation, decided per operation rather than per family.
 *
 * - `reachable` — configuration a person or a project CREATED, listable exhaustively. The atlas may call it
 *   once a key exists, and stores what it returns.
 * - `voluminous` — time-series OBSERVATIONS: emitted by the platform, unbounded, growing with the clock,
 *   identified by a generated handle rather than by a name somebody chose. Enumerated and declared; the rows
 *   are never stored whole. A DISPOSITION, not an exclusion.
 * - `excluded` — the atlas will never call it: every mutation, and every inference call, whose act has an
 *   effect and a price whatever its HTTP verb says.
 *
 * `docs/atlas-intent/06-holdings.md` is the authority, and the criterion cuts THROUGH a family rather than along it:
 * `GET /v1beta/files` lists what a person uploaded and is reachable configuration, while
 * `GET /v1beta/generatedFiles` lists what the platform emitted while somebody generated, and grows with the
 * clock. Same product area, opposite dispositions.
 */
const GEMINI_AI_STUDIO_DISPOSITIONS = ["reachable", "voluminous", "excluded"] as const;

export type GeminiAiStudioDisposition = (typeof GEMINI_AI_STUDIO_DISPOSITIONS)[number];

/**
 * What the compiled channel knows about one operation: everything the published discovery document states
 * about it, reduced to names.
 *
 * There is no response VALUE here and there cannot be — this channel never called anything. `responseFields`
 * are the property names the declared response schema carries, resolved one `$ref` deep, which is where a
 * discovery document puts a resource's own properties.
 */
const geminiAiStudioOperationCompiledDetailSchema = z
  .object({
    /** Which published versions declare this operation, sorted — `v1`, `v1alpha`, `v1beta`. */
    apiVersions: z.array(z.string().min(1)).min(1),
    /** What this atlas may do with the operation, and why. */
    disposition: z.enum(GEMINI_AI_STUDIO_DISPOSITIONS),
    /** The rule that decided the disposition, in English. Never empty, including for `reachable`. */
    dispositionReason: z.string().min(1),
    /** Whether the discovery document marks this operation as taking a media upload. */
    hasMediaUpload: z.boolean(),
    /** The HTTP method, upper-cased. */
    method: z.string().min(1),
    /** Google's own dotted method id, e.g. `generativelanguage.models.list`. */
    operationId: z.string().min(1),
    /** Path template parameter names, in declaration order. */
    pathParams: z.array(z.string().min(1)),
    /** The path template, parameters left as placeholders and the version segment stripped. */
    pathShape: z.string().min(1),
    /** Query parameter names the document declares for this method, sorted. Excludes the global set. */
    queryParams: z.array(z.string().min(1)),
    /** The `$ref` name of the declared response schema, or `null` when it declares none. */
    responseSchema: z.string().min(1).nullable(),
    /** Property names that schema carries, sorted. Empty when the schema is open or undeclared. */
    responseFields: z.array(z.string().min(1)),
    /** OAuth scopes the document declares for this method, sorted. Empty when it declares none. */
    scopes: z.array(z.string().min(1)),
    /** The document's own description, first line only, or `null` when it declares none. */
    summary: z.string().min(1).nullable(),
  })
  .strict();

export type GeminiAiStudioOperationCompiledDetail = z.infer<typeof geminiAiStudioOperationCompiledDetailSchema>;

/**
 * What the browser saw one declared PAGE be: whether it was reached at all, what it settled on, and why it
 * could not be if it was not.
 *
 * The screenshot is not here — it is a {@link GeminiAiStudioSource} artifact, addressed by digest, because
 * the ruling is that the atlas HOLDS the picture rather than a link to one.
 *
 * @internal
 */
export const geminiAiStudioPageDetailSchema = z
  .object({
    /** Which product this page belongs to: `ai-studio`, `gemini-app` or `google-admin`. */
    product: z.string().min(1),
    /** The address the browser ended on, which a redirect may have changed. */
    finalUrl: z.string().min(1).nullable(),
    /** Whether the client sent this page somewhere other than where it was asked to go. */
    redirected: z.boolean(),
    statusCode: z.number().int().nullable(),
    /** The document title the page settled on. */
    title: z.string(),
    /** Why this declared page is not held, or `null` when it is. */
    unreachableBecause: z.string().min(1).nullable(),
  })
  .strict();

/**
 * What the browser saw one declared page be.
 *
 * @internal
 */
export type GeminiAiStudioPageDetail = z.infer<typeof geminiAiStudioPageDetailSchema>;

/** One channel's independent view of one entity. A successful look replaces only this channel's own detail. */
const geminiAiStudioChannelEntitySchema = z
  .object({
    channel: z.enum(GEMINI_AI_STUDIO_CHANNELS),
    /** What this channel knows about this entity. Shape depends on the kind — see the detail schemas. */
    detail: z.unknown().nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: geminiAiStudioSourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

export type GeminiAiStudioChannelEntity = z.infer<typeof geminiAiStudioChannelEntitySchema>;

/** One tracked entity: a stable identity, plus whatever each channel independently knows about it. */
const geminiAiStudioAtlasEntitySchema = z
  .object({
    channels: z
      .object({
        api: geminiAiStudioChannelEntitySchema.nullable(),
        browser: geminiAiStudioChannelEntitySchema.nullable(),
        compiled: geminiAiStudioChannelEntitySchema.nullable(),
      })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(GEMINI_AI_STUDIO_KINDS),
    /**
     * The provider's own key: `<METHOD> <path shape>` for an operation, the declared route for a page. This
     * is what the channels are matched on, byte-exactly, and it is deliberately version-INDEPENDENT so the
     * same operation published at three versions is one row carrying all three.
     */
    providerId: z.string().min(1),
  })
  .strict();

export type GeminiAiStudioAtlasEntity = z.infer<typeof geminiAiStudioAtlasEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel. `lastSuccessAt` and
 * `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one timestamp cannot answer
 * "is this still current" after a run that failed following one that succeeded.
 */
const geminiAiStudioCoverageCellSchema = z
  .object({
    artifacts: z.array(geminiAiStudioArtifactRefSchema),
    channel: z.enum(GEMINI_AI_STUDIO_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.enum(GEMINI_AI_STUDIO_VISIBILITY_SCOPES),
  })
  .strict();

export type GeminiAiStudioCoverageCell = z.infer<typeof geminiAiStudioCoverageCellSchema>;

/** A gap, as stored. This atlas's own condition vocabulary plus kind — see `gaps.ts`. */
export const geminiAiStudioAtlasGapSchema = z
  .object({
    condition: z.string().min(1),
    /** Which names the surfaces disagree about. Empty unless the condition is a disagreement. */
    fields: z.array(z.string().min(1)),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(GEMINI_AI_STUDIO_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    /** Which channels this gap concerns. Two, for a disagreement; empty when channel-independent. */
    surfaces: z.array(z.enum(GEMINI_AI_STUDIO_CHANNELS)),
  })
  .strict();

export type GeminiAiStudioAtlasGap = z.infer<typeof geminiAiStudioAtlasGapSchema>;

/** One kind's file on disk. */
export const geminiAiStudioAtlasKindFileSchema = z
  .object({
    coverage: z.array(geminiAiStudioCoverageCellSchema),
    entities: z.array(geminiAiStudioAtlasEntitySchema),
    gaps: z.array(geminiAiStudioAtlasGapSchema),
    kind: z.enum(GEMINI_AI_STUDIO_KINDS),
    platform: z.literal(GEMINI_AI_STUDIO_ATLAS_PLATFORM),
    schemaVersion: z.literal(GEMINI_AI_STUDIO_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type GeminiAiStudioAtlasKindFile = z.infer<typeof geminiAiStudioAtlasKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const geminiAiStudioAtlasKindStatusSchema = z
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
export type GeminiAiStudioAtlasKindStatus = z.infer<typeof geminiAiStudioAtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const geminiAiStudioAtlasManifestSchema = z
  .object({
    kinds: z.record(z.enum(GEMINI_AI_STUDIO_KINDS), geminiAiStudioAtlasKindStatusSchema),
    platform: z.literal(GEMINI_AI_STUDIO_ATLAS_PLATFORM),
    schemaVersion: z.literal(GEMINI_AI_STUDIO_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type GeminiAiStudioAtlasManifest = z.infer<typeof geminiAiStudioAtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialGeminiAiStudioManifest({ updatedAt }: { updatedAt: string }): GeminiAiStudioAtlasManifest {
  const empty: GeminiAiStudioAtlasKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  // `as`: Object.fromEntries widens keys to string; this is built from the exhaustive GEMINI_AI_STUDIO_KINDS,
  // so the narrower kind-keyed type is sound. Same convention as `cloudflare/reset.ts`.
  // oxlint-disable-next-line no-unsafe-type-assertion
  const kinds = Object.fromEntries(GEMINI_AI_STUDIO_KINDS.map((kind) => [kind, empty])) as Record<
    GeminiAiStudioKind,
    GeminiAiStudioAtlasKindStatus
  >;
  return {
    kinds,
    platform: GEMINI_AI_STUDIO_ATLAS_PLATFORM,
    schemaVersion: GEMINI_AI_STUDIO_ATLAS_SCHEMA_VERSION,
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
export function emptyGeminiAiStudioKindFile({
  kind,
  updatedAt,
}: {
  kind: GeminiAiStudioKind;
  updatedAt: string;
}): GeminiAiStudioAtlasKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: GEMINI_AI_STUDIO_ATLAS_PLATFORM,
    schemaVersion: GEMINI_AI_STUDIO_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}
