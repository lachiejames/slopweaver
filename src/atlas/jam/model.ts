/**
 * What the Jam atlas holds, and the permanent boundary of what it can ever claim.
 *
 * ## Nothing else here holds a Jam workspace, so this atlas holds the ENTITIES — with one scoping
 *
 * `docs/atlas-intent/06-holdings.md` is a test an atlas applies to its own platform: does something better suited
 * already hold this platform's entities? For Slack the corpus does, so its atlas maps the interface alone.
 * Here the answer is NO — no Jam team, member, connected application or recording exists anywhere else in
 * this installation — so the answer is everything reachable, entities included.
 *
 * The scoping is the ask's own, and it is a DISCLOSURE bound rather than a volume one, which is the Small
 * Improvements case rather than the Datadog one: **a jam is a screen recording of a real working session**,
 * so its frames, its console log, its network log and its DOM snapshot are customer-adjacent material. The
 * atlas holds a jam's EXISTENCE and its metadata and never its payload. That is why there is a `jam` shape
 * in the `web-app` page vocabulary and no `jam` KIND: a kind would be a row per recording, and the row this
 * atlas is commissioned to hold is the page that lists them.
 *
 * ## Three channels, and the compiled one is the only one filled today
 *
 * `compiled` is Jam's own published OpenAPI description and its three OAuth discovery documents, read
 * offline from a committed table; `api` is a live call to the MCP resource under a bearer token this
 * installation does not hold; `browser` is the application walked in the owner's real Chrome. The first two
 * are NOT one channel: a document declaring an endpoint says nothing about whether a token may call it.
 *
 * ## The finding the kinds are shaped around
 *
 * MEASURED: the document Jam titles "Jam Public API" declares fourteen operations and **not one
 * of them returns a jam, a team, a member or an integration** — it is an OAuth authorisation server plus
 * `GET /whoami`. Every product noun this atlas is asked about is reachable only through the MCP resource or
 * the browser. So `operation` and `route` are the surface map, `scope` is the grant vocabulary, `page` is
 * the browser half, and `integration` is the one product noun both published surfaces speak about — which
 * is what makes its two channels' disagreement (nine published pages against twenty-one shipped icons) a
 * finding rather than a mismatch.
 */
import { z } from "zod";

import {
  type AtlasCoverageState,
  type AtlasEvidenceRole,
  atlasArtifactRefSchema,
  atlasSourceSchema,
} from "../kit/contract.js";
import { KIT_GAP_CONDITIONS } from "../kit/gaps.js";
import { generationSchemas } from "../kit/generationSchemas.js";
import { atlasPageDetailSchema } from "../kit/pageObservation.js";

import {
  JAM_MCP_SURFACE,
  JAM_ROUTE_SURFACE,
  JAM_SPEC_SURFACE,
  JAM_WEB_APP_SURFACE,
  JAM_WEB_CLIENT_SURFACE,
} from "./surfaces.js";

/**
 * The on-disk schema version. Bump only with a real layout change; `store.ts` refuses to read a generation
 * declaring a different version, naming the reset remedy.
 */
export const JAM_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — the published description, the MCP resource and the web
 * application are three SURFACES of this one atlas.
 */
export const JAM_ATLAS_PLATFORM = "jam";

/**
 * The entity kinds this atlas holds. Iterated by the reader, never derived from the directory listing.
 *
 * `operation`, `route` and `scope` are filled by the compiled channel; `page` by the walk; `integration` by
 * both, which is the whole reason it is a kind rather than a field. There is deliberately no `jam` kind —
 * see this file's header on the disclosure scoping.
 */
export const JAM_ATLAS_KINDS = ["integration", "operation", "page", "route", "scope"] as const;

/** One kind this atlas tracks. */
export type JamAtlasKind = (typeof JAM_ATLAS_KINDS)[number];

/**
 * The kind that holds published and observed API operations.
 *
 * Named rather than inferred because both publishers write it — the sync fills its compiled channel and the
 * walk fills its browser channel — and `surfaceFill.ts` uses it as part of the compiled denominator.
 */
export const JAM_OPERATION_KIND = "operation";

/** The kind that holds browser pages. Named because the sync must not stale it. */
export const JAM_PAGE_KIND = "page";

/** The kind that holds probed API routes. Named because only the probe table fills it. */
export const JAM_ROUTE_KIND = "route";

/** The kind that holds declared OAuth scopes. */
export const JAM_SCOPE_KIND = "scope";

/** The kind whose two channels are expected to disagree — see this file's header. */
export const JAM_INTEGRATION_KIND = "integration";

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what the other already knew.
 */
export const JAM_ATLAS_CHANNELS = ["compiled", "api", "browser"] as const;

/** One channel this atlas reaches through. */
export type JamAtlasChannel = (typeof JAM_ATLAS_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type JamEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type JamCoverageState = AtlasCoverageState;

/**
 * The claim boundary a coverage cell carries — one per channel, because the three ceilings are unrelated.
 *
 * The compiled channel's ceiling is a public DOCUMENT and no workspace at all; the MCP channel's is whatever
 * scopes a bearer token was granted, and this installation holds none; the browser channel's is whatever the
 * signed-in person's own Jam role opens. One `visibilityScope` for the atlas would be false about two
 * channels whichever value it took.
 *
 * @internal
 */
export const JAM_VISIBILITY_SCOPES = [
  "compiled-published-documents",
  "api-oauth-bearer-token",
  "browser-signed-in-account",
] as const;

/**
 * The claim boundary one channel reads under.
 * @internal
 */
export type JamVisibilityScope = (typeof JAM_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one channel reads under.
 *
 * @param channel the channel that produced the cell
 * @returns that channel's own ceiling
 */
export function jamVisibilityScopeFor({ channel }: { channel: JamAtlasChannel }): JamVisibilityScope {
  if (channel === "compiled") {
    return "compiled-published-documents";
  }
  if (channel === "api") {
    return "api-oauth-bearer-token";
  }
  return "browser-signed-in-account";
}

/**
 * The permanent claim boundary, stated once for the descriptor.
 *
 * Written in the credentials' own terms rather than as a reassurance, and it names the one that does not
 * exist rather than implying it might.
 */
export const JAM_VISIBILITY_SCOPE =
  "the compiled channel sees exactly the OpenAPI description and OAuth discovery documents Jam serves every " +
  "reader, and no workspace at all; the MCP channel sees whatever an OAuth bearer token was granted, and " +
  "this installation holds none, so it has never called anything; the browser channel sees whatever the " +
  "signed-in person's own Jam account and team membership open, which is a member's view rather than an " +
  "administrator's unless that person holds that role. None of the three implies either other, and 'complete' here " +
  "is always complete for the channel named on the cell";

/**
 * Every surface a coverage cell may be recorded under.
 *
 * Spelled here as a tuple because the stored schema is built from it, and imported by name from
 * `surfaces.ts` so the publishers and the reader cannot disagree about a string that a cell is filtered on.
 *
 * @internal
 */
export const JAM_SURFACES = [
  JAM_SPEC_SURFACE,
  JAM_ROUTE_SURFACE,
  JAM_MCP_SURFACE,
  JAM_WEB_APP_SURFACE,
  JAM_WEB_CLIENT_SURFACE,
] as const;

/**
 * One surface a coverage cell may be recorded under.
 *
 * @internal
 */
export type JamSurface = (typeof JAM_SURFACES)[number];

/**
 * Every condition a Jam atlas gap can carry. A closed vocabulary, so closure can match exactly, and so the
 * stored gap schema below can be built from it rather than from a second list.
 *
 * @internal
 */
export const JAM_GAP_CONDITIONS = [
  /**
   * The published description declares no operation that returns a product noun. Permanently open until Jam
   * publishes a product API: it is the single largest fact about this platform's API surface, and an atlas
   * that recorded it only in prose would let a reader conclude the operations it holds are the whole story.
   */
  "published-api-declares-no-product-operation",
  /**
   * A declared OAuth scope that no published operation names. All four are in this state, which is why the
   * condition is a first-class row rather than a footnote on the scope kind.
   */
  "scope-named-by-no-operation",
  /**
   * A host serving a bearer-protected resource that the published description's own `servers` list does not
   * contain. This is `docs/atlas-intent/02-both-surfaces.md` arriving as a measured property rather than as a principle.
   */
  "undeclared-resource-host",
  /**
   * Two documents the VENDOR publishes disagree about which resource a scope belongs to. §4's corroboration
   * output, applied inside one surface rather than between two.
   */
  "discovery-documents-disagree",
  /**
   * An endpoint that answers a malformed request with a 500 rather than a 4xx, so a client cannot tell a bad
   * request from a broken server. A fact about the platform, recorded with the date it was measured.
   */
  "endpoint-error-shape-unserialisable",
  /**
   * Permanently open by construction: the set of routes ASKED about is a table in this repository, because
   * Jam publishes no index of its own API surface. Every verdict is the server's; a route nobody here named
   * is simply never probed.
   */
  "route-denominator-is-local",
  /** The MCP resource has no credential in this installation, so no workspace entity has been read. */
  "mcp-credential-absent",
  /**
   * Permanently open by construction: the browser denominator is the application's own route table plus what
   * the frontier discovered, never a list Jam publishes. See `webRoutes.ts`.
   */
  "web-denominator-is-harvested",
  /** A route the walk asked for and did not land on. */
  "web-page-unreachable",
  /** A route the walk never got to, because it stopped before its turn. */
  "web-page-not-attempted",
  /** A page reached and not photographed — an incomplete observation, never a silence. */
  "web-screenshot-missing",
  /**
   * The scoping ruling, recorded where a reader meets it rather than only in prose: a jam's payload is
   * customer-adjacent, so existence and metadata are held and frames, logs and DOM snapshots are not.
   * Permanently open, because it is a bound rather than a shortfall.
   */
  "jam-payload-withheld-on-disclosure",
  ...KIT_GAP_CONDITIONS,
] as const;

/** One condition a Jam atlas gap can carry. @internal */
export type JamGapCondition = (typeof JAM_GAP_CONDITIONS)[number];

/** One artifact backing a fact — a proof screenshot. Kit-owned. */
const jamArtifactRefSchema = atlasArtifactRefSchema;

/** One artifact backing a fact. */
export type JamArtifactRef = z.infer<typeof jamArtifactRefSchema>;

/**
 * Where a record came from, through one channel.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const jamSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(JAM_ATLAS_CHANNELS) })
  .strict();

/** Where a record came from, through one channel. @internal */
type JamSource = z.infer<typeof jamSourceSchema>;

/**
 * What the compiled channel knows about one published operation.
 *
 * Every field is a NAME: this channel called nothing, so there is no response value here and there cannot
 * be one.
 */
const jamOperationCompiledDetailSchema = z
  .object({
    /** Whether this atlas may call it. Every operation on this surface is a read or an OAuth exchange. */
    callable: z.boolean(),
    /** Why it is not callable, or `null` when it is. */
    excludedBecause: z.string().min(1).nullable(),
    /** The HTTP method, upper-cased. */
    method: z.string().min(1),
    /** Every declared parameter name, sorted. */
    parameters: z.array(z.string().min(1)),
    /** The path template, `{brace}` parameters intact. */
    path: z.string().min(1),
    /** Response field paths to the declared depth, `[]` marking an array, sorted. Names only. */
    responseFields: z.array(z.string().min(1)),
    /** The scopes the document says this operation needs. Empty for all fourteen — see the gap. */
    scopes: z.array(z.string().min(1)),
    /** The security schemes it declares, sorted; empty when it declares none. */
    security: z.array(z.string().min(1)),
    /** Where it is sent — the document's first declared server. */
    serverUrl: z.string().min(1),
    /** The document's own summary or description first line, or `null` when it publishes none. */
    synopsis: z.string().min(1).nullable(),
    /** The document's own tag for this operation, or `null` when it carries none. */
    tag: z.string().min(1).nullable(),
  })
  .strict();

/** What the compiled channel knows about one published operation. */
export type JamOperationCompiledDetail = z.infer<typeof jamOperationCompiledDetailSchema>;

/**
 * What the BROWSER saw one operation be: a call the application actually made.
 *
 * There is no response field list here and there cannot be: the walk stores a call's method, origin and path
 * SHAPE, never its body. On this platform that boundary is the disclosure scoping in the header — a jam's
 * payload travels through exactly these calls.
 * @internal
 */
export const jamOperationBrowserDetailSchema = z
  .object({
    /** The HTTP method, upper-cased. */
    method: z.string().min(1),
    /** The origin the call was made against, which distinguishes the published API from the app's backend. */
    origin: z.string().min(1),
    /** The path with anything identifier-shaped folded to `{id}`, so two calls to one endpoint are one row. */
    pathShape: z.string().min(1),
  })
  .strict();

/** What the browser saw one operation be. @internal */
export type JamOperationBrowserDetail = z.infer<typeof jamOperationBrowserDetailSchema>;

/**
 * How one probed route answered, in the three states Jam's own infrastructure actually distinguishes.
 *
 * MEASURED with no credential, and this is the oracle that makes the route surface worth having:
 * a path the application router received answers with Fastify's own JSON not-found NAMING the method, and a
 * path the edge never routed answers a flat `text/plain` `404 Not Found`. So a served PREFIX is establishable
 * without an account. `routeProbe.ts` carries the control that keeps the negative honest.
 *
 * `indeterminate` is the fourth member and it is not a tidiness case. A 404 carrying a content type that is
 * neither shape is a response this oracle CANNOT read, and the two honest-looking alternatives are both
 * over-claims in opposite directions: grading it `routed-no-leaf` asserts a served prefix on no evidence,
 * and grading it `not-routed` asserts an absence on none either. A verdict that cannot say "I could not
 * tell" is a verdict that quietly invents one.
 *
 * @internal
 */
export const JAM_ROUTE_VERDICTS = ["answered", "routed-no-leaf", "not-routed", "indeterminate"] as const;

/** How one probed route answered. */
export type JamRouteVerdict = (typeof JAM_ROUTE_VERDICTS)[number];

/**
 * What the probe established about one route.
 *
 * The BODY is deliberately not stored. What a reader needs is the verdict and the evidence class that
 * produced it; the body of a 404 is the vendor's error template, not a fact about the surface.
 * @internal
 */
export const jamRouteDetailSchema = z
  .object({
    /** The response's own content type, which is the whole discriminator. */
    contentType: z.string().min(1),
    /** The host this route was probed against. */
    host: z.string().min(1),
    /** The HTTP method probed, upper-cased. */
    method: z.string().min(1),
    /** The path probed. */
    path: z.string().min(1),
    /** The status the server returned. */
    statusCode: z.number().int(),
    /** What the pair of status and content type establishes. */
    verdict: z.enum(JAM_ROUTE_VERDICTS),
    /** The rule that decided the verdict, in English. Never empty. */
    verdictBecause: z.string().min(1),
  })
  .strict();

/** What the probe established about one route. @internal */
export type JamRouteDetail = z.infer<typeof jamRouteDetailSchema>;

/**
 * What the compiled channel knows about one declared OAuth scope.
 *
 * `namedBy` is empty for all four, which is the finding: an authorisation server advertising four scopes
 * against a published description that spends none of them.
 * @internal
 */
export const jamScopeCompiledDetailSchema = z
  .object({
    /** Which published operations name this scope, sorted. Empty for every scope Jam declares. */
    namedBy: z.array(z.string().min(1)),
    /** Which protected-resource documents claim this scope, sorted. Empty when none does. */
    claimedByResources: z.array(z.string().min(1)),
    /** The scope string itself. */
    scope: z.string().min(1),
  })
  .strict();

/** What the compiled channel knows about one declared scope. @internal */
export type JamScopeCompiledDetail = z.infer<typeof jamScopeCompiledDetailSchema>;

/**
 * What the compiled channel knows about one integration Jam publishes a page for.
 *
 * The published integration list is the marketing site's own sitemap, which is a claim the vendor makes to
 * every reader — so it is compiled rather than browsed, and the browser channel's own view of the same kind
 * is what makes the two comparable.
 * @internal
 */
export const jamIntegrationCompiledDetailSchema = z
  .object({
    /** Jam's own slug for the integration, from its published page address. */
    slug: z.string().min(1),
    /** The published page, which is the reproduction handle and the proof screenshot's URL. */
    pageUrl: z.url(),
  })
  .strict();

/** What the compiled channel knows about one published integration. @internal */
export type JamIntegrationCompiledDetail = z.infer<typeof jamIntegrationCompiledDetailSchema>;

/**
 * What the browser saw one declared PAGE be. Kit-owned, plus which section of the app it sits in.
 *
 * The screenshot is not here — it is a {@link JamSource} artifact, addressed by digest, because the ruling is
 * that the atlas HOLDS the picture rather than a link to one.
 * @internal
 */
export const jamPageDetailSchema = atlasPageDetailSchema
  .extend({
    /**
     * Why this page has no proof screenshot, or `null` when it has one.
     *
     * Six declared pages canonicalise onto two here, so `kit/pageWalk.ts`'s duplicate-picture check
     * withdrawing a shot is the ordinary case rather than a fault — and a reader who could not tell that
     * from a page the walk failed to photograph would chase the wrong thing.
     */
    screenshotMissingBecause: z.string().min(1).nullable(),
    /** The section of the application this route sits in, as the walk's own registry names it. */
    section: z.string().min(1),
  })
  .strict();

/** What the browser saw one declared page be. @internal */
export type JamPageDetail = z.infer<typeof jamPageDetailSchema>;

/** One channel's independent view of one entity. A successful look replaces only this channel's own detail. */
const jamChannelEntitySchema = generationSchemas.channelEntityFor({
  channels: JAM_ATLAS_CHANNELS,
  source: jamSourceSchema,
});

/** One channel's independent view of one entity. */
export type JamChannelEntity = z.infer<typeof jamChannelEntitySchema>;

/** One tracked entity: a stable identity, plus whatever each channel independently knows about it. *
 * @internal
 */
export const jamAtlasEntitySchema = z
  .object({
    channels: z
      .object({
        api: jamChannelEntitySchema.nullable(),
        browser: jamChannelEntitySchema.nullable(),
        compiled: jamChannelEntitySchema.nullable(),
      })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(JAM_ATLAS_KINDS),
    /**
     * The provider's own key: `<METHOD> <path>` for an operation, `<METHOD> <host><path>` for a route, the
     * scope string for a scope, the slug for an integration, the route for a page. This is what the channels
     * are matched on, byte-exactly.
     */
    providerId: z.string().min(1),
  })
  .strict();

/** One tracked entity. */
export type JamAtlasEntity = z.infer<typeof jamAtlasEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel. `lastSuccessAt` and
 * `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one timestamp cannot answer
 * "is this still current" after a run that failed following one that succeeded.
 *
 * @internal
 */
export const jamCoverageCellSchema = generationSchemas.coverageCellFor({ surfaces: JAM_SURFACES }).extend({
  /** Which channel produced this look. The one field the kit's cell does not carry — see this file above. */
  channel: z.enum(JAM_ATLAS_CHANNELS),
  visibilityScope: z.enum(JAM_VISIBILITY_SCOPES),
});

/** One coverage cell. */
export type JamCoverageCell = z.infer<typeof jamCoverageCellSchema>;

/**
 * A gap, as stored. This atlas's own condition vocabulary plus kind — see `kit/gaps.ts`.
 *
 * `fields` and `surfaces` carry the CONTENT of a disagreement: which names one surface has and the other
 * does not, and which two surfaces those were. A disagreement gap without them says only that a disagreement
 * happened, which is a notification rather than a finding.
 *
 * @internal
 */
export const jamAtlasGapSchema = generationSchemas.gapFor({
  conditions: JAM_GAP_CONDITIONS,
  kinds: JAM_ATLAS_KINDS,
  surfaces: JAM_ATLAS_CHANNELS,
});

/** A gap, as stored. */
export type JamAtlasGap = z.infer<typeof jamAtlasGapSchema>;

/** One kind's file on disk. */
export const jamAtlasKindFileSchema = generationSchemas.kindFileFor({
  cell: jamCoverageCellSchema,
  entity: jamAtlasEntitySchema,
  gap: jamAtlasGapSchema,
  kinds: JAM_ATLAS_KINDS,
  platform: JAM_ATLAS_PLATFORM,
  schemaVersion: JAM_ATLAS_SCHEMA_VERSION,
});

/** One kind's file on disk. */
export type JamAtlasKindFile = z.infer<typeof jamAtlasKindFileSchema>;

/** What is known about one kind's synchronisation history. @internal */
const jamAtlasKindStatusSchema = generationSchemas.kindStatus;

/** What is known about one kind's synchronisation history. @internal */
type JamAtlasKindStatus = z.infer<typeof jamAtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const jamAtlasManifestSchema = generationSchemas
  .manifestFor({ kinds: JAM_ATLAS_KINDS, schemaVersion: JAM_ATLAS_SCHEMA_VERSION })
  .extend({ platform: z.literal(JAM_ATLAS_PLATFORM) });

/** The manifest. */
export type JamAtlasManifest = z.infer<typeof jamAtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialJamManifest({ updatedAt }: { updatedAt: string }): JamAtlasManifest {
  const empty: JamAtlasKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  return {
    kinds: { integration: empty, operation: empty, page: empty, route: empty, scope: empty },
    platform: JAM_ATLAS_PLATFORM,
    schemaVersion: JAM_ATLAS_SCHEMA_VERSION,
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
export function emptyJamKindFile({ kind, updatedAt }: { kind: JamAtlasKind; updatedAt: string }): JamAtlasKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: JAM_ATLAS_PLATFORM,
    schemaVersion: JAM_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}

/**
 * An empty file for every kind, so a freshly installed generation is complete rather than partial.
 *
 * Spelled out rather than mapped over the kind list, so adding a kind fails to compile here.
 *
 * @param at the ISO timestamp to stamp
 * @returns one empty file per kind
 */
export function emptyJamKindFiles({ at }: { at: string }): Readonly<Record<JamAtlasKind, JamAtlasKindFile>> {
  return {
    integration: emptyJamKindFile({ kind: "integration", updatedAt: at }),
    operation: emptyJamKindFile({ kind: "operation", updatedAt: at }),
    page: emptyJamKindFile({ kind: "page", updatedAt: at }),
    route: emptyJamKindFile({ kind: "route", updatedAt: at }),
    scope: emptyJamKindFile({ kind: "scope", updatedAt: at }),
  };
}
/**
 * Every channel slot empty, so a builder fills only the one it observed.
 *
 * @returns all three channels, null
 * @internal
 */
export function emptyJamChannels(): JamAtlasEntity["channels"] {
  return { api: null, browser: null, compiled: null };
}
