/**
 * What the Inngest atlas holds, and the permanent boundary of what it can ever claim.
 *
 * ## Nothing else here holds an Inngest app, so this atlas holds the ENTITIES
 *
 * `docs/atlas-intent/06-holdings.md` is a test an atlas applies to its own platform: does something better suited
 * already hold this platform's entities? For Slack the corpus does, so its atlas maps the interface alone.
 * Here the answer is NO — no app, function, environment, event key, signing key, event type, webhook or
 * integration of this account exists anywhere else in this installation — so the answer is everything
 * reachable, entities included, minus the highly voluminous.
 *
 * ## Runs and events are the voluminous family, and they are a DISPOSITION rather than an exclusion
 *
 * A function RUN and an EVENT are time-series observations in exactly the sense `docs/atlas-intent/06-holdings.md`
 * names: emitted by the platform rather than created by a person, identified by an instant, and growing with
 * the clock. So neither is a kind. The operations that list them are still rows on the `operation` kind,
 * classed `voluminous` with the rule that decided it — an atlas that omitted them would answer "Inngest
 * offers no way to read a run", which is false. The complement is configuration somebody authored: an app,
 * a function's definition, an event KEY, an event TYPE's schema. Those are entities and are held.
 *
 * ## Three channels, and the third is the only one that can see this account at all
 *
 * `compiled` is what Inngest publishes to anybody — the REST catalogue its own API reference serves, and the
 * dashboard's own route table, which the application ships to a signed-out visitor. `api` is a live call to
 * `api.inngest.com` under a credential this installation does not have. `browser` is a page walked in the
 * owner's real Chrome, which is signed in — so on this platform the browser is the INGEST fallback
 * (`docs/atlas-intent/07-browser-fallback.md`) rather than a corroboration afterthought.
 *
 * ## A kind is a DECLARATION, never a claim that anything has been read
 *
 * Eight of the eleven kinds below can only be filled by a channel holding a credential or a signed-in
 * browser. Each carries its own coverage cell saying what actually happened to it, per channel, which is the
 * difference between an atlas that is honest about its gaps and one that looks empty.
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
import { atlasPageDetailSchema } from "../kit/pageObservation.js";
import { atlasPermissionBlockSchema } from "../kit/permissionBlock.js";

/**
 * The on-disk schema version. Bump only with a real layout change; `store.ts` refuses to read a generation
 * declaring a different version, naming the reset remedy.
 */
export const INNGEST_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — the published catalogue, the REST API, the GraphQL endpoint
 * and the dashboard are SURFACES of this one atlas, which is the whole point of the kit contract's header.
 */
export const INNGEST_ATLAS_PLATFORM = "inngest";

/**
 * Every kind this atlas publishes a file for.
 *
 * Three map the platform — `operation` for the published REST surface, `graphql-operation` for what the
 * dashboard's own client sends to an endpoint whose introspection is disabled, and `page` for the
 * dashboard's routes. The other eight are this account's own configuration, which exists in no other store
 * in this installation.
 */
export const INNGEST_KINDS = [
  "app",
  "environment",
  "event-key",
  "event-type",
  "function",
  "graphql-operation",
  "integration",
  "operation",
  "page",
  "signing-key",
  "webhook",
] as const;

/** One kind this atlas tracks. */
export type InngestKind = (typeof INNGEST_KINDS)[number];

/**
 * The kind that holds the published REST surface rather than an account entity.
 *
 * Named rather than inferred because two things branch on it: `surfaceFill.ts` uses it in the denominator of
 * the compiled surface, and a walk must never touch it.
 */
export const INNGEST_OPERATION_KIND = "operation";

/**
 * The kind that holds dashboard routes.
 *
 * Named rather than inferred because the sync declares its rows from the application's own route table while
 * the walk fills their browser channel, so both writers need the name and neither may touch another kind.
 */
export const INNGEST_PAGE_KIND = "page";

/**
 * The kind that holds the operations the dashboard's client sends to `api.inngest.com/gql`.
 *
 * Named because it is the one kind NO published source can fill: introspection on that endpoint is disabled,
 * so every row here is something only a driven browser saw. It is the sharpest instance of
 * `docs/atlas-intent/02-both-surfaces.md` on this platform.
 */
export const INNGEST_GRAPHQL_OPERATION_KIND = "graphql-operation";

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what another already knew.
 *
 * `compiled` and `api` are NOT the same channel: a catalogue declaring an operation says nothing whatever
 * about whether this installation may call it.
 */
export const INNGEST_CHANNELS = ["compiled", "api", "browser"] as const;

/** One channel this atlas reaches through. */
export type InngestChannel = (typeof INNGEST_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type InngestEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type InngestCoverageState = AtlasCoverageState;

/**
 * The claim boundary a coverage cell carries — one per channel, because the three ceilings are unrelated.
 * @internal
 */
export const INNGEST_VISIBILITY_SCOPES = [
  "compiled-published-catalogue",
  "api-signing-key",
  "browser-signed-in-account",
] as const;

/**
 * The claim boundary one channel reads under.
 * @internal
 */
export type InngestVisibilityScope = (typeof INNGEST_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one channel reads under.
 *
 * @param channel the channel that produced the cell
 * @returns that channel's own ceiling
 */
export function inngestVisibilityScopeFor({ channel }: { channel: InngestChannel }): InngestVisibilityScope {
  if (channel === "compiled") {
    return "compiled-published-catalogue";
  }
  if (channel === "api") {
    return "api-signing-key";
  }
  return "browser-signed-in-account";
}

/**
 * The permanent claim boundary — what "complete" can ever mean for this installation's access.
 *
 * Stated in the credentials' own terms rather than as a reassurance, and it names the one that does not
 * exist: no Inngest signing key is configured here, so the live REST channel has no ceiling yet because it
 * has no floor.
 */
export const INNGEST_VISIBILITY_SCOPE =
  "the compiled channel sees exactly what Inngest publishes to every reader — its API reference catalogue " +
  "and the route table the dashboard ships to a signed-out visitor — and no account at all; the REST " +
  "channel sees whatever environment a signing key is scoped to, and this installation holds none, so it " +
  "has never called anything; the browser channel sees whatever the signed-in person's own Inngest account, " +
  "organisation role and environment access open. None of the three implies either other, and 'complete' " +
  "here is always complete for the channel named on the cell";

const isoSchema = z.iso.datetime();

/**
 * One artifact backing a fact — a proof screenshot. Kit-owned.
 *
 * @internal
 */
export const inngestArtifactRefSchema = atlasArtifactRefSchema;

/** One artifact backing a fact. */
export type InngestArtifactRef = z.infer<typeof inngestArtifactRefSchema>;

/**
 * Where a record came from, through one channel.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const inngestSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(INNGEST_CHANNELS) })
  .strict();

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type InngestSource = z.infer<typeof inngestSourceSchema>;

/**
 * What this atlas may do with one operation.
 *
 * - `reachable` — configuration a person CREATED, listable exhaustively. The atlas may call it once a
 *   credential exists, and stores what it returns.
 * - `voluminous` — time-series OBSERVATIONS: identified by an instant rather than by a name somebody chose,
 *   and growing with the clock. The operation is enumerated and declared; its rows are never stored whole.
 * - `excluded` — the atlas will never call it: every mutation, and the reads whose own act has an effect.
 *
 * The three member names are the Microsoft 365 atlas's, deliberately: it landed the vocabulary first and a
 * reader grepping `voluminous` across atlases should find both.
 *
 * @internal
 */
export const INNGEST_DISPOSITIONS = ["reachable", "voluminous", "excluded"] as const;

/** What this atlas may do with one operation. */
export type InngestDisposition = (typeof INNGEST_DISPOSITIONS)[number];

/**
 * Which published REST version an operation belongs to.
 *
 * Inngest's own catalogue structure, not an invented taxonomy: `api-docs.inngest.com/llms.txt` groups every
 * operation under `v1` or `v2`, and the two behave differently enough under probe that the distinction is
 * load-bearing rather than cosmetic — see {@link INNGEST_PROBE_EVIDENCE}.
 *
 * @internal
 */
export const INNGEST_REST_VERSIONS = ["v1", "v2"] as const;

/** One published REST version. */
export type InngestRestVersion = (typeof INNGEST_REST_VERSIONS)[number];

/**
 * What an unauthenticated request established about one route, as a closed vocabulary.
 *
 * `unprobeable-control-agrees` is the member that matters and the reason this is not a boolean. A surface
 * whose invented control answers exactly what a real route answers has established NOTHING, and recording
 * that as "not found" or as "exists" would both be lies. MEASURED and reproducible with
 * `slopweaver atlas inngest sync`: the whole `/v2` REST surface and every dashboard route below a layout
 * segment are in this state, while `/v1` and the dashboard's own root discriminate cleanly.
 *
 * @internal
 */
export const INNGEST_PROBE_EVIDENCE = [
  "exists-auth-required",
  "exists-method-not-allowed",
  "exists-unauthenticated",
  "exists-sign-in-redirect",
  "absent-404",
  "unprobeable-control-agrees",
  "unprobeable-parameterised",
  "unprobeable-mutating",
  "probe-failed",
] as const;

/** What an unauthenticated request established about one route. */
export type InngestProbeEvidence = (typeof INNGEST_PROBE_EVIDENCE)[number];

/**
 * What the compiled channel knows about one REST operation: everything Inngest's own published catalogue
 * states about it, plus what an unauthenticated request established about its address.
 *
 * There is no response VALUE here and there cannot be — this channel presented no credential, so every
 * request it made was refused before it reached data.
 *
 * @internal
 */
export const inngestOperationCompiledDetailSchema = z
  .object({
    /** The catalogue's own grouping, e.g. `Events`, `Function runs`, `Sandboxes`. */
    group: z.string().min(1),
    /** What this atlas may do with the operation, and why. */
    disposition: z.enum(INNGEST_DISPOSITIONS),
    /** The rule that decided the disposition, in English. Never empty, including for `reachable`. */
    dispositionReason: z.string().min(1),
    /** The catalogue's own description, or `null` when it prints none. */
    description: z.string().min(1).nullable(),
    /** The origin this operation is served from. */
    host: z.string().min(1),
    /** The catalogue's own operation id, e.g. `ListEvents` — unique within its version and group. */
    operationId: z.string().min(1),
    /** What an unauthenticated request established about the address, or why nothing could be. */
    probeEvidence: z.enum(INNGEST_PROBE_EVIDENCE),
    /** The exact address probed and the status it answered, or `null` when no request was sent. */
    probeNote: z.string().min(1).nullable(),
    /** The catalogue page this was compiled from — the reproduction handle. */
    referenceUrl: z.url(),
    /** The catalogue's own heading for this operation. */
    title: z.string().min(1),
    version: z.enum(INNGEST_REST_VERSIONS),
  })
  .strict();

/**
 * What the compiled channel knows about one REST operation.
 *
 * @internal
 */
export type InngestOperationCompiledDetail = z.infer<typeof inngestOperationCompiledDetailSchema>;

/**
 * What the compiled channel knows about one dashboard ROUTE, before any browser has opened it.
 *
 * The route itself comes from the application's own route table, which it ships to a signed-out visitor — so
 * this is the vendor's own statement of its navigation surface rather than a list somebody guessed. The
 * probe is corroboration on top of that, and it succeeds only at the depths where the control fails.
 *
 * @internal
 */
export const inngestPageCompiledDetailSchema = z
  .object({
    /** The section of the dashboard this route sits in, derived from its own first path segment. */
    section: z.string().min(1),
    /** Whether the route table's own path carries a `$param` segment, so no concrete address exists. */
    parameterised: z.boolean(),
    /** The concrete address probed, or `null` when the route is parameterised. */
    probedUrl: z.url().nullable(),
    /** What an unauthenticated request established about the address, or why nothing could be. */
    probeEvidence: z.enum(INNGEST_PROBE_EVIDENCE),
    /** The status and any redirect target, exactly as observed. `null` when no request was sent. */
    probeNote: z.string().min(1).nullable(),
    /** The route exactly as the application's own table declares it, `$param` segments intact. */
    routePath: z.string().min(1),
  })
  .strict();

/**
 * What the compiled channel knows about one dashboard route.
 *
 * @internal
 */
export type InngestPageCompiledDetail = z.infer<typeof inngestPageCompiledDetailSchema>;

/**
 * What the BROWSER saw one declared page be. Kit-owned, plus which dashboard section it sits in.
 *
 * The screenshot is not here — it is an {@link InngestSource} artifact, addressed by digest, because the
 * ruling is that the atlas HOLDS the picture rather than a link to one.
 * @internal
 */
export const inngestPageDetailSchema = atlasPageDetailSchema
  .extend({
    /** The section of the dashboard this route sits in, as the compiled registry names it. */
    section: z.string().min(1),
  })
  .strict();

/**
 * What the browser saw one declared page be. @internal
 *
 * @internal
 */
export type InngestPageDetail = z.infer<typeof inngestPageDetailSchema>;

/**
 * What the browser saw one GraphQL operation be.
 *
 * `api.inngest.com/gql` answers `introspection disabled`, so no published source declares this surface at
 * all: every row here is an operation the dashboard's own client sent while it was being walked. There is no
 * response payload — the walk records the operation NAME, its type and the routes that caused it, never what
 * it answered about this account's runs.
 * @internal
 */
export const inngestGraphqlOperationDetailSchema = z
  .object({
    /** The document's own operation name, e.g. `GetApps`. */
    operationName: z.string().min(1),
    /** `query`, `mutation` or `subscription`, as the sent document declares it. */
    operationType: z.enum(["query", "mutation", "subscription", "unnamed"]),
    /** The walked routes that caused this call, sorted — where a reader goes to see it happen again. */
    onPages: z.array(z.string().min(1)),
    /** The origin the call was made against. */
    origin: z.url(),
    /** The root selection names the sent document asks for, sorted. Empty when no document was carried. */
    rootFields: z.array(z.string().min(1)),
  })
  .strict();

/**
 * What the browser saw one GraphQL operation be. @internal
 *
 * @internal
 */
export type InngestGraphqlOperationDetail = z.infer<typeof inngestGraphqlOperationDetailSchema>;

/**
 * One channel's independent view of one entity. A successful look replaces only this channel's own detail.
 *
 * @internal
 */
export const inngestChannelEntitySchema = z
  .object({
    channel: z.enum(INNGEST_CHANNELS),
    /** What this channel knows about this entity. Shape depends on the kind — see the detail schemas. */
    detail: z.unknown().nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: inngestSourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

/** One channel's independent view of one entity. */
export type InngestChannelEntity = z.infer<typeof inngestChannelEntitySchema>;

/**
 * One tracked entity: a stable identity, plus whatever each channel independently knows about it.
 *
 * @internal
 */
export const inngestAtlasEntitySchema = z
  .object({
    channels: z
      .object({
        api: inngestChannelEntitySchema.nullable(),
        browser: inngestChannelEntitySchema.nullable(),
        compiled: inngestChannelEntitySchema.nullable(),
      })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(INNGEST_KINDS),
    /**
     * The provider's own key: `<version> <operationId>` for a REST operation, the declared route for a page,
     * the operation name for a GraphQL call, Inngest's own id or slug for an entity. This is what the
     * channels are matched on, byte-exactly.
     */
    providerId: z.string().min(1),
  })
  .strict();

/** One tracked entity. */
export type InngestAtlasEntity = z.infer<typeof inngestAtlasEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel. `lastSuccessAt` and
 * `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one timestamp cannot answer
 * "is this still current" after a run that failed following one that succeeded.
 *
 * @internal
 */
export const inngestCoverageCellSchema = z
  .object({
    artifacts: z.array(inngestArtifactRefSchema),
    channel: z.enum(INNGEST_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.enum(INNGEST_VISIBILITY_SCOPES),
  })
  .strict();

/** One coverage cell. */
export type InngestCoverageCell = z.infer<typeof inngestCoverageCellSchema>;

/**
 * A gap, as stored. This atlas's own condition vocabulary plus kind — see `gaps.ts`.
 *
 * @internal
 */
export const inngestAtlasGapSchema = z
  .object({
    condition: z.string().min(1),
    /** Which names the surfaces disagree about. Empty unless the condition is a disagreement. */
    fields: z.array(z.string().min(1)),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(INNGEST_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    /** Which channels this gap concerns. Two, for a disagreement; empty when channel-independent. */
    surfaces: z.array(z.enum(INNGEST_CHANNELS)),
  })
  .strict();

/** A gap, as stored. */
export type InngestAtlasGap = z.infer<typeof inngestAtlasGapSchema>;

/** One kind's file on disk. */
export const inngestAtlasKindFileSchema = z
  .object({
    coverage: z.array(inngestCoverageCellSchema),
    entities: z.array(inngestAtlasEntitySchema),
    gaps: z.array(inngestAtlasGapSchema),
    kind: z.enum(INNGEST_KINDS),
    platform: z.literal(INNGEST_ATLAS_PLATFORM),
    schemaVersion: z.literal(INNGEST_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

/** One kind's file on disk. */
export type InngestAtlasKindFile = z.infer<typeof inngestAtlasKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const inngestAtlasKindStatusSchema = z
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

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export type InngestAtlasKindStatus = z.infer<typeof inngestAtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const inngestAtlasManifestSchema = z
  .object({
    kinds: z.record(z.enum(INNGEST_KINDS), inngestAtlasKindStatusSchema),
    platform: z.literal(INNGEST_ATLAS_PLATFORM),
    schemaVersion: z.literal(INNGEST_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

/** The manifest. */
export type InngestAtlasManifest = z.infer<typeof inngestAtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialInngestManifest({ updatedAt }: { updatedAt: string }): InngestAtlasManifest {
  const empty: InngestAtlasKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  // `as`: Object.fromEntries widens keys to string; this is built from the exhaustive INNGEST_KINDS, so the
  // narrower kind-keyed type is sound. Same convention as `cloudflare/reset.ts`.
  // oxlint-disable-next-line no-unsafe-type-assertion
  const kinds = Object.fromEntries(INNGEST_KINDS.map((kind) => [kind, empty])) as Record<
    InngestKind,
    InngestAtlasKindStatus
  >;
  return {
    kinds,
    platform: INNGEST_ATLAS_PLATFORM,
    schemaVersion: INNGEST_ATLAS_SCHEMA_VERSION,
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
export function emptyInngestKindFile({
  kind,
  updatedAt,
}: {
  kind: InngestKind;
  updatedAt: string;
}): InngestAtlasKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: INNGEST_ATLAS_PLATFORM,
    schemaVersion: INNGEST_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}
