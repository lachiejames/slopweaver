/**
 * What the Clerk atlas holds, and the permanent boundary of what it can ever claim.
 *
 * ## One platform, four published APIs and one that is not published at all
 *
 * Clerk ships its Backend API, its Frontend API and its beta Platform API as OpenAPI documents, plus a
 * fifth document declaring the webhook events it emits. Those are SURFACES of one atlas rather than four
 * atlases — `kit/contract.ts` makes that a type. MEASURED against the pinned documents (`specLock.ts`,
 * reproduce with `slopweaver atlas clerk sync --json`): 502 operations over 382 paths, 45 webhook events,
 * 463 component schemas.
 *
 * The fifth API is the one the browser half exists to find. The dashboard talks to `dapi.clerk.com`, which
 * no published document declares, and `slopweaver atlas clerk report` is where that shows up. An
 * undocumented endpoint is a usable source rather than a curiosity (`docs/atlas-intent/02-both-surfaces.md`), and it is
 * also a LEAD rather than a capability: seeing the dashboard call something establishes that Clerk holds
 * the data, never that a secret key may ask for it.
 *
 * ## This atlas holds the SURFACE MAP, and the reason is per-platform rather than a preference
 *
 * `docs/atlas-intent/06-holdings.md` is a test an atlas applies to its own platform: does something better suited
 * already hold this platform's entities? Here the entities in question are the PRODUCT'S OWN END USERS —
 * the people who sign in to the application Clerk fronts — and their record of truth is the application's
 * own database, which this installation neither holds nor should. So the atlas maps the interface: every
 * endpoint, method, parameter and response field, every webhook event, and every dashboard page with the
 * exact URL that proves it. It is not an index of who exists.
 *
 * The configuration entities Clerk itself owns — applications, instances, domains — are a genuine `No` on
 * the same test, and they are declared here rather than held, because no Clerk credential exists on this
 * installation at all. `coverage.ts` says that per kind rather than leaving it as a silence.
 *
 * ## Nothing here is a value
 *
 * Every field an `operation` entity carries is a NAME: an HTTP method, a path shape with its parameters as
 * placeholders, a parameter name, a response field name. The browser channel reduces a captured response to
 * its field names and never its contents (`browserReduction.ts`), which matters more on this platform than
 * on most — a signed-in Clerk dashboard renders real people's email addresses, and the walk photographs
 * pages it must therefore keep under the private state home and never print.
 *
 * Two fields under that private home are the stated exception and both are ADDRESSES rather than values: a
 * walked page's settled URL, and the remembered instance root (`instanceRoot.ts`). Both carry the
 * organisation's own application and instance identifiers, both stay out of this repository, and neither is
 * ever printed by a verb.
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
export const CLERK_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — the four published documents, the undocumented dashboard
 * API and the dashboard itself are SURFACES of this one atlas.
 */
export const CLERK_ATLAS_PLATFORM = "clerk";

/**
 * Every kind this atlas publishes a file for.
 *
 * Three, and each answers a different question: `operation` is what can be asked and where, `webhook-event`
 * is what Clerk will tell you without being asked, and `page` is where a human goes to see or change it.
 * There is deliberately no `user` or `organization` kind — see this file's header on the §6 test.
 */
export const CLERK_ATLAS_KINDS = ["operation", "page", "webhook-event"] as const;

/** One kind this atlas publishes. */
export type ClerkAtlasKind = (typeof CLERK_ATLAS_KINDS)[number];

/**
 * The kind that holds dashboard pages rather than API operations.
 *
 * Named rather than inferred because two things branch on it: a compile must not stale it, and a walk must
 * write only it and `operation`.
 */
export const CLERK_PAGE_KIND = "page";

/**
 * The kind that holds one row per operation, whichever surface saw it.
 *
 * The compiled channel and the browser channel fold onto the SAME entity when they agree on its provider
 * key, which is what makes the corroboration in `disagreement.ts` a set operation over stored rows rather
 * than a build-time comparison nobody can re-read.
 */
export const CLERK_OPERATION_KIND = "operation";

/** The kind that holds one row per webhook event the vendor declares. */
export const CLERK_WEBHOOK_EVENT_KIND = "webhook-event";

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what the other already knew.
 *
 * `compiled` is a vendor document read offline; `api` is a live authenticated call, which this installation
 * cannot make; `browser` is the dashboard walked in the owner's own Chrome. The first two are NOT the same
 * channel: a document declaring an endpoint says nothing about whether any credential here may call it.
 */
export const CLERK_CHANNELS = ["compiled", "api", "browser"] as const;

export type ClerkChannel = (typeof CLERK_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type ClerkEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type ClerkCoverageState = AtlasCoverageState;

/**
 * Which of Clerk's APIs an operation belongs to.
 *
 * This is the atlas's own vocabulary and it is the join between the two channels, so it is a closed union
 * rather than a host string. Clerk serves the Backend API and the beta Platform API from ONE host and
 * splits them by path prefix, and serves the Frontend API from a per-application host that a document can
 * only write as a template — so neither a host nor a path alone identifies an API, and matching on either
 * would manufacture the disagreements this atlas exists to find honestly.
 *
 * - `bapi` — the Backend API, `api.clerk.com/v1/…`, secret-key authenticated.
 * - `fapi` — the Frontend API, served per application; the dashboard's own is `clerk.clerk.com`.
 * - `platform` — the beta Platform API, `api.clerk.com/v1/platform/…`, which owns applications and
 *   instances and is therefore the half of the surface the owner named first.
 * - `dashboard` — `dapi.clerk.com`, which no published document declares. Browser-only by construction.
 * - `other` — another first-party `clerk.com` host the walk saw (a CDN, a settings edge, a telemetry
 *   proxy). Recorded rather than dropped, because "the client also talks to these" is atlas content.
 */
export const CLERK_APIS = ["bapi", "fapi", "platform", "dashboard", "other"] as const;

/** Which of Clerk's APIs an operation belongs to. */
export type ClerkApi = (typeof CLERK_APIS)[number];

/**
 * The claim boundary one channel reads under — one per channel, because the three ceilings are unrelated.
 *
 * The compiled channel's ceiling is a set of DOCUMENTS and no account at all; the API channel's would be
 * whatever one secret key's own instance opens; the browser channel's is whatever the owner's own dashboard
 * membership renders. One `visibilityScope` for the atlas would be false about two channels whichever value
 * it took.
 *
 * @internal
 */
export const CLERK_VISIBILITY_SCOPES = [
  "compiled-published-specifications",
  "api-secret-key-instance",
  "browser-signed-in-membership",
] as const;

/**
 * The claim boundary one channel reads under.
 * @internal
 */
export type ClerkVisibilityScope = (typeof CLERK_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one channel reads under.
 *
 * @param channel the channel that produced the cell
 * @returns that channel's own ceiling
 */
export function clerkVisibilityScopeFor({ channel }: { channel: ClerkChannel }): ClerkVisibilityScope {
  if (channel === "compiled") {
    return "compiled-published-specifications";
  }
  if (channel === "api") {
    return "api-secret-key-instance";
  }
  return "browser-signed-in-membership";
}

/**
 * The permanent claim boundary — what "complete" can ever mean for this installation's access.
 *
 * Stated in the credentials' own terms rather than as a reassurance, and it names the one that does not
 * exist.
 */
export const CLERK_VISIBILITY_SCOPE =
  "the compiled channel sees exactly four pinned, publicly published Clerk documents and no account at " +
  "all; the live API channel sees whatever one secret key's own instance opens, and this installation " +
  "holds no Clerk credential of any kind, so it has never read anything; the browser channel sees whatever " +
  "the owner's own dashboard membership renders for ONE application and ONE instance — the one the owner's browser " +
  "was left on — so a page another instance would show is a declared gap rather than a silence. None of " +
  "the three implies either other, and 'complete' here is always complete for the channel named on the cell";

const isoSchema = z.iso.datetime();

/** One artifact backing a fact — a proof screenshot. Kit-owned. */
const clerkArtifactRefSchema = atlasArtifactRefSchema;

export type ClerkArtifactRef = z.infer<typeof clerkArtifactRefSchema>;

/**
 * Where a record came from, through one channel.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const clerkSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(CLERK_CHANNELS) })
  .strict();

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type ClerkSource = z.infer<typeof clerkSourceSchema>;

/**
 * What this atlas may do with one operation, decided per operation rather than per family.
 *
 * - `reachable` — configuration or identity a person or a system CREATED, listable exhaustively. The atlas
 *   may call it once a credential exists, and stores what it returns.
 * - `voluminous` — time-series OBSERVATIONS: emitted by the platform, unbounded, growing with the clock,
 *   identified by an instant rather than by a name somebody chose. The operation is enumerated and
 *   declared; its rows are never stored whole. A DISPOSITION, not an exclusion.
 * - `excluded` — the atlas will never call it: every mutation, every operation whose act has an effect on a
 *   real person's session, and every read whose response is the product's own end-user data.
 *
 * `docs/atlas-intent/06-holdings.md` is the authority, and the criterion cuts THROUGH a family rather than along it:
 * `GET /v1/sessions` returns observations that grow with the clock, while `GET /v1/sessions/{id}` addresses
 * one row somebody can name — and both sit in the family a rule stated by family would have taken whole.
 */
const CLERK_DISPOSITIONS = ["reachable", "voluminous", "excluded"] as const;

export type ClerkDisposition = (typeof CLERK_DISPOSITIONS)[number];

/**
 * What the compiled channel knows about one operation: everything the pinned documents state about it,
 * reduced to names.
 *
 * There is no response VALUE here and there cannot be — this channel never called anything.
 * `responseFields` are the property names the declared success schema carries, resolved one `$ref` deep
 * plus its `allOf` bases, which is where Clerk puts an entity's own properties.
 */
const clerkOperationCompiledDetailSchema = z
  .object({
    /** Which of Clerk's APIs declares it. */
    api: z.enum(CLERK_APIS),
    /** What this atlas may do with the operation, and why. */
    disposition: z.enum(CLERK_DISPOSITIONS),
    /** The rule that decided the disposition, in English. Never empty, including for `reachable`. */
    dispositionReason: z.string().min(1),
    /** Which pinned document declared it, so a reader knows which file to open. */
    document: z.string().min(1),
    /** The HTTP method, upper-cased. */
    method: z.string().min(1),
    /** Clerk's own operation id, e.g. `GetUserList`. */
    operationId: z.string().min(1),
    /** How this operation pages, read from its own parameter names — `limit-offset`, `limit-only`, `none`. */
    pagination: z.string().min(1),
    /** Path template parameter names, in declaration order. */
    pathParams: z.array(z.string().min(1)),
    /** Query parameter names the document declares, sorted. */
    queryParams: z.array(z.string().min(1)),
    /** The `$ref` name of the declared success schema, or `null` when it declares none. */
    responseSchema: z.string().min(1).nullable(),
    /** Property names that schema carries, sorted. Empty when the schema is open or undeclared. */
    responseFields: z.array(z.string().min(1)),
    /** The security scheme names the document requires, sorted. Empty means the operation is public. */
    security: z.array(z.string().min(1)),
    /** The document's own one-line summary, or `null` when it declares none. */
    summary: z.string().min(1).nullable(),
    /** Clerk's own tags, which are its product grouping. */
    tags: z.array(z.string().min(1)),
    /** The WIRE path — the server's own prefix plus the declared path. What the browser channel matches. */
    wirePath: z.string().min(1),
  })
  .strict();

export type ClerkOperationCompiledDetail = z.infer<typeof clerkOperationCompiledDetailSchema>;

/**
 * What the browser channel saw one operation be: the call the dashboard actually made, reduced to names.
 *
 * `seenOn` is what turns an undocumented operation from a curiosity into a lead somebody can reproduce: it
 * names the declared PAGE surfaces that caused the call, never a URL, because a dashboard URL carries the
 * application and instance identifiers this repository may not hold.
 */
const clerkOperationBrowserDetailSchema = z
  .object({
    /** Which of Clerk's APIs the host it went to belongs to. */
    api: z.enum(CLERK_APIS),
    /** How many times the walk saw this operation called, across every declared page. */
    callCount: z.number().int().positive(),
    /** The host the call went to. A first-party `clerk.com` host, never a third party. */
    host: z.string().min(1),
    method: z.string().min(1),
    /** Every response field name observed across every page, widened and sorted. Names only. */
    responseFields: z.array(z.string().min(1)),
    /** Which declared page surfaces caused this call, sorted. */
    seenOn: z.array(z.string().min(1)),
    /** The last status code observed for this operation. */
    statusCode: z.number().int(),
    /** The wire path with every value segment replaced, e.g. `/v1/instances/{id}/domains`. */
    wirePath: z.string().min(1),
  })
  .strict();

export type ClerkOperationBrowserDetail = z.infer<typeof clerkOperationBrowserDetailSchema>;

/**
 * What the compiled channel knows about one webhook event: the event Clerk emits, and the payload's shape.
 *
 * Held as its own kind rather than as an operation, because it is the one part of this surface that is not
 * a thing you ask for. A reader wanting to know what Clerk will TELL them reads this kind; a reader wanting
 * to know what they can ASK reads `operation`.
 */
const clerkWebhookEventDetailSchema = z
  .object({
    /** The event type, e.g. `user.created`. Clerk's own name and this row's provider key. */
    event: z.string().min(1),
    /** The document's own description, or `null` when it declares none. */
    description: z.string().min(1).nullable(),
    /** The `$ref` name of the payload's `data` schema, or `null` when it declares none. */
    payloadSchema: z.string().min(1).nullable(),
    /** Property names that payload carries, sorted. */
    payloadFields: z.array(z.string().min(1)),
  })
  .strict();

export type ClerkWebhookEventDetail = z.infer<typeof clerkWebhookEventDetailSchema>;

/**
 * What the browser saw one declared dashboard page be. Kit-owned — see `kit/pageObservation.ts`.
 *
 * The screenshot is not here: it is an artifact on the entity's own source, addressed by digest, because
 * the ruling is that the atlas HOLDS the picture rather than a link to one.
 */
const clerkPageDetailSchema = atlasPageDetailSchema;

export type ClerkPageDetail = z.infer<typeof clerkPageDetailSchema>;

/** One channel's independent view of one entity. A successful look replaces only this channel's own detail. */
const clerkChannelEntitySchema = z
  .object({
    channel: z.enum(CLERK_CHANNELS),
    /** What this channel knows about this entity. Shape depends on the kind — see the detail schemas. */
    detail: z.unknown().nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: clerkSourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

export type ClerkChannelEntity = z.infer<typeof clerkChannelEntitySchema>;

/** One tracked entity: a stable identity, plus whatever each channel independently knows about it. */
const clerkAtlasEntitySchema = z
  .object({
    channels: z
      .object({
        api: clerkChannelEntitySchema.nullable(),
        browser: clerkChannelEntitySchema.nullable(),
        compiled: clerkChannelEntitySchema.nullable(),
      })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(CLERK_ATLAS_KINDS),
    /**
     * The provider's own key: `<METHOD> <api>:<wire path>` for an operation, the event type for a webhook
     * event, the declared surface name for a page. This is what the channels are matched on, byte-exactly.
     */
    providerId: z.string().min(1),
  })
  .strict();

export type ClerkAtlasEntity = z.infer<typeof clerkAtlasEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel. `lastSuccessAt` and
 * `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one timestamp cannot answer
 * "is this still current" after a run that failed following one that succeeded.
 */
const clerkCoverageCellSchema = z
  .object({
    artifacts: z.array(clerkArtifactRefSchema),
    channel: z.enum(CLERK_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.enum(CLERK_VISIBILITY_SCOPES),
  })
  .strict();

export type ClerkCoverageCell = z.infer<typeof clerkCoverageCellSchema>;

/** A gap, as stored. This atlas's own condition vocabulary plus kind — see `gaps.ts`. */
export const clerkAtlasGapSchema = z
  .object({
    condition: z.string().min(1),
    /** Which names the surfaces disagree about. Empty unless the condition is a disagreement. */
    fields: z.array(z.string().min(1)),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(CLERK_ATLAS_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    /** Which channels this gap concerns. Two, for a disagreement; empty when channel-independent. */
    surfaces: z.array(z.enum(CLERK_CHANNELS)),
  })
  .strict();

export type ClerkAtlasGap = z.infer<typeof clerkAtlasGapSchema>;

/** One kind's file on disk. */
export const clerkAtlasKindFileSchema = z
  .object({
    coverage: z.array(clerkCoverageCellSchema),
    entities: z.array(clerkAtlasEntitySchema),
    gaps: z.array(clerkAtlasGapSchema),
    kind: z.enum(CLERK_ATLAS_KINDS),
    platform: z.literal(CLERK_ATLAS_PLATFORM),
    schemaVersion: z.literal(CLERK_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type ClerkAtlasKindFile = z.infer<typeof clerkAtlasKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const clerkAtlasKindStatusSchema = z
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
export type ClerkAtlasKindStatus = z.infer<typeof clerkAtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const clerkAtlasManifestSchema = z
  .object({
    kinds: z.record(z.enum(CLERK_ATLAS_KINDS), clerkAtlasKindStatusSchema),
    platform: z.literal(CLERK_ATLAS_PLATFORM),
    schemaVersion: z.literal(CLERK_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type ClerkAtlasManifest = z.infer<typeof clerkAtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialClerkManifest({ updatedAt }: { updatedAt: string }): ClerkAtlasManifest {
  const empty: ClerkAtlasKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  // `as`: Object.fromEntries widens keys to string; this is built from the exhaustive CLERK_ATLAS_KINDS, so
  // the narrower kind-keyed type is sound. Same convention as `cloudflare/reset.ts`.
  // oxlint-disable-next-line no-unsafe-type-assertion
  const kinds = Object.fromEntries(CLERK_ATLAS_KINDS.map((kind) => [kind, empty])) as Record<
    ClerkAtlasKind,
    ClerkAtlasKindStatus
  >;
  return {
    kinds,
    platform: CLERK_ATLAS_PLATFORM,
    schemaVersion: CLERK_ATLAS_SCHEMA_VERSION,
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
export function emptyClerkKindFile({
  kind,
  updatedAt,
}: {
  kind: ClerkAtlasKind;
  updatedAt: string;
}): ClerkAtlasKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: CLERK_ATLAS_PLATFORM,
    schemaVersion: CLERK_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}
