/**
 * The Xero atlas's on-disk vocabulary — the generation that holds BOTH surfaces, and the schemas that
 * refuse to trust it.
 *
 * ## This atlas holds EVERYTHING REACHABLE, because nothing else holds Xero at all
 *
 * Owner's ruling (`docs/atlas-intent/06-holdings.md`): what an atlas HOLDS is decided per platform, by
 * asking whether something better suited already holds that platform's entities. For Slack the answer is
 * yes — the corpus has its channels, people and messages — so the Slack atlas maps the interface alone. For
 * Xero the answer is NO. No corpus source ingests it, no other atlas touches it, and "what did we spend with
 * this vendor" is answerable from nothing this installation has. So this atlas takes the other branch, and
 * the entity half is `family` below.
 *
 * ## Three kinds, and `family` is the one the other atlases do not have
 *
 * `method` and `page` are the surface map, exactly as the Slack and Notion atlases hold them. `family` is
 * this atlas's answer to the ruling's one bound — a highly voluminous surface is **enumerated and declared
 * rather than stored whole**. A family row names a business-object family Xero exposes, says which
 * operations reach it and which pages show it, and carries its {@link XeroFamilyDisposition}: whether its
 * records are configuration somebody authored, or time-series observations that grow with the clock. The
 * distinction is applied per family rather than per product area, because the criterion cuts THROUGH a
 * family rather than along it — `GET /Accounts` returns a chart of accounts a person built, and
 * `GET /Journals` returns every posting the ledger has ever made.
 *
 * ## Nothing here holds a financial value, and that is a property of the SHAPES rather than a promise
 *
 * Every field a `method` entity carries is a NAME: an HTTP verb, a path shape with its parameters as
 * placeholders, a query or header parameter name, a response field name. A `page` entity holds a title, a
 * URL and a screenshot. A `family` entity holds counts and dispositions. There is no schema here with a
 * slot an amount, a contact name or an account number could be written into — see `descriptor.ts` on why
 * the ingest that WOULD hold them is a declared, unfilled surface rather than something this build does
 * quietly.
 *
 * ## Two channels, and for Xero they are expected to be largely DISJOINT
 *
 * `api` is the public REST surface the installed `xero-node` declares, under `api.xero.com/<product>.xro`.
 * `browser` is what the first-party web client at `go.xero.com` actually calls, which is a different,
 * undocumented surface. An entity's `providerId` is `<METHOD> <path shape>`, matched byte-exactly, so the
 * two channels never fold together and the disjointness is a RECORD rather than an assertion.
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
 * The on-disk schema version for the Xero atlas. Bump only with a real layout change; `store.ts` refuses to
 * read a generation declaring a different version, naming the reset remedy.
 */
export const XERO_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — the REST API and the web client are two SURFACES of this
 * one atlas, which is the whole point of the kit contract's header.
 */
export const XERO_ATLAS_PLATFORM = "xero";

/** The entity kinds this atlas holds. Iterated by the reader, never derived from the directory listing. */
export const XERO_ATLAS_KINDS = ["family", "method", "page"] as const;

export type XeroAtlasKind = (typeof XERO_ATLAS_KINDS)[number];

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what the other already knew.
 */
export const XERO_ATLAS_CHANNELS = ["api", "browser"] as const;

export type XeroAtlasChannel = (typeof XERO_ATLAS_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type XeroEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type XeroCoverageState = AtlasCoverageState;

/**
 * The surfaces this atlas declares, closed so the visibility mapping below can be total.
 *
 * `live-api` is the one that has never been filled, and it is declared rather than omitted for the reason
 * `kit/contract.ts` gives: an unfilled surface is a STATE an atlas says about itself, and a surface nobody
 * declared is a silence a reader has to notice.
 */
const XERO_COVERAGE_SURFACES = ["sdk-declared", "browser-walk", "web-client", "live-api"] as const;

export type XeroCoverageSurface = (typeof XERO_COVERAGE_SURFACES)[number];

/**
 * The claim boundary a coverage cell carries.
 *
 * Three rather than one, because this atlas's three filled channels read under three unrelated ceilings and
 * a single `visibilityScope` would be false about two of them whichever value it took. The compiled channel
 * has no tenant at all — it reads a package — while the browser channel sees exactly one signed-in person's
 * Xero role in the organisations their login can switch to, and the unfilled live API would see whatever an
 * OAuth connection's scopes and tenant consent open.
 *
 * @internal
 */
export const XERO_VISIBILITY_SCOPES = [
  "sdk-declarations",
  "browser-signed-in-user",
  "oauth-connection-scopes",
] as const;

/**
 * The claim boundary one surface reads under.
 *
 * @internal
 */
export type XeroVisibilityScope = (typeof XERO_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one surface reads under.
 *
 * Keyed on the SURFACE rather than on the channel, unlike the Notion atlas's equivalent: two of this
 * atlas's surfaces share the `api` channel and read under completely different ceilings — one reads a
 * package on disk and one would read a tenant over OAuth — so a channel-keyed mapping would assert the
 * wrong boundary for whichever of the two it did not favour.
 *
 * @param surface the surface that produced the cell
 * @returns that surface's own ceiling
 */
export function xeroVisibilityScopeFor({ surface }: { surface: XeroCoverageSurface }): XeroVisibilityScope {
  if (surface === "sdk-declared") {
    return "sdk-declarations";
  }
  if (surface === "live-api") {
    return "oauth-connection-scopes";
  }
  return "browser-signed-in-user";
}

const isoSchema = z.iso.datetime();

/** One artifact backing a fact — a proof screenshot. Kit-owned. */
const xeroArtifactRefSchema = atlasArtifactRefSchema;

export type XeroArtifactRef = z.infer<typeof xeroArtifactRefSchema>;

/**
 * Where a record came from, and the link that proves it to a human.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const xeroSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(XERO_ATLAS_CHANNELS) })
  .strict();

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type XeroSource = z.infer<typeof xeroSourceSchema>;

/**
 * How a deep link was come by. Kit-owned, and read off the source schema rather than restated, so a
 * widening of the kit's own vocabulary cannot leave this atlas quietly declaring a narrower one.
 * @internal
 */
export type XeroDeepLinkStatus = XeroSource["deepLinkStatus"];

/**
 * What ONE generated client declares about one route.
 *
 * `responseFields` is the half no hand-written endpoint list could carry and the half the owner asked for by
 * name — *"every endpoint, every method, every parameter"*. It comes from the response model's own
 * `attributeTypeMap`, which is the wire spelling rather than the TypeScript property name, so a reader
 * asking "is there any call that hands me `AmountDue`" gets the answer the API would actually give.
 */
const xeroMethodDeclarationSchema = z
  .object({
    /** The generated API class this operation is declared in — `accountingApi`, `payrollNZApi`. */
    module: z.string().min(1),
    /** The SDK's own method name, e.g. `getInvoices`. */
    name: z.string().min(1),
    /** The one-line `@summary` the package ships above the declaration, or `null` when it carries none. */
    summary: z.string().min(1).nullable(),
    /** Header parameter names the operation sets, e.g. `xero-tenant-id`. */
    headerParams: z.array(z.string().min(1)),
    pathParams: z.array(z.string().min(1)),
    queryParams: z.array(z.string().min(1)),
    /** The model name the operation serialises into the request body, or `null` when it sends none. */
    requestModel: z.string().min(1).nullable(),
    /** The model name the operation deserialises the response into, or `null` when it declares none. */
    responseModel: z.string().min(1).nullable(),
    /** Every field name that model declares, in the API's own wire spelling, sorted. Names, never values. */
    responseFields: z.array(z.string().min(1)),
  })
  .strict();

export type XeroMethodDeclaration = z.infer<typeof xeroMethodDeclarationSchema>;

/**
 * What the API surface knows about one ROUTE: every generated client that declares it.
 *
 * ## Why this is a LIST rather than one declaration
 *
 * MEASURED against `xero-node` 19.1.0: 475 operations resolve to 413 distinct routes, because three payroll
 * clients — Australian v2, New Zealand and United Kingdom — hang different methods off one `payroll.xro/2.0`
 * root and 62 of those paths are shared. The route is the entity, because the route is what the browser
 * channel can also observe and therefore what corroboration is keyed on. But the DECLARATIONS genuinely
 * differ: two regions' clients accept different query parameters and return different models for the same
 * path, so keeping one and dropping the other loses a real fact, and unioning their parameters would ASSERT
 * a false one — that the UK client accepts a New Zealand parameter.
 *
 * So each declaration is kept whole, and only `responseFields` is widened across them, because that field
 * answers "is there any call that hands me this" and a union is the correct answer to that question.
 */
const xeroMethodApiDetailSchema = z
  .object({
    /** Every generated client that declares this route, sorted by module then method name. */
    declarations: z.array(xeroMethodDeclarationSchema).min(1),
    /** The union of every declaration's response fields, sorted — the "which call returns this" index. */
    responseFields: z.array(z.string().min(1)),
  })
  .strict();

export type XeroMethodApiDetail = z.infer<typeof xeroMethodApiDetailSchema>;

/**
 * What the browser surface saw one operation do: how often the first-party client called it, and the
 * response field NAMES it got back.
 *
 * `seenOnPages` is which declared pages caused the call, which is what turns a list of undocumented
 * operations into something a reader can act on — an operation is a lead, and the page it fires on is where
 * that lead can be reproduced.
 */
const xeroMethodBrowserDetailSchema = z
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

export type XeroMethodBrowserDetail = z.infer<typeof xeroMethodBrowserDetailSchema>;

/**
 * Whether a family's records are configuration somebody authored, or observations the platform emits.
 *
 * The criterion is the owner's, established by the Datadog atlas row and consolidated into
 * `docs/atlas-intent/06-holdings.md`: observations are emitted by the platform rather than created by a person,
 * unbounded, growing with the clock, and identified by an INSTANT rather than by a name somebody chose;
 * configuration is the complement, and can be listed exhaustively.
 *
 * `voluminous` is the DISPOSITION, not an exclusion. A family in that state is still reached, its shape is
 * still recorded, and its every row is simply never published — which is a different claim from "nobody
 * looked", and the atlas has to be able to say which.
 *
 * `mixed` exists because the criterion **cuts THROUGH a family rather than along it**, which
 * `docs/atlas-intent/06-holdings.md` states outright and then proves with two Datadog operations in one product
 * area landing on opposite sides. Xero's own case is the same shape: `GET /Invoices` returns documents a
 * person authored and `GET /Invoices/{InvoiceID}/History` returns the platform's own audit trail for one of
 * them. A family forced to one disposition would have to be wrong about one of its own operations, so a
 * mixed family names the observation-shaped subset in {@link XeroFamilyDetail.voluminousOperations}.
 *
 * `unjudged` is what a family gets when the declared table has no entry for it. It cannot occur on a build
 * whose table is complete — `families.test.ts` fails if the installed SDK declares a family the table does
 * not judge — and it exists so that an install whose SDK moved ahead of the table says so rather than
 * quietly claiming the safer half.
 */
export const XERO_FAMILY_DISPOSITIONS = ["configuration", "voluminous", "mixed", "unjudged"] as const;

export type XeroFamilyDisposition = (typeof XERO_FAMILY_DISPOSITIONS)[number];

/**
 * One business-object family Xero exposes: where it can be reached, what it is made of, and whether this
 * atlas may hold its rows.
 *
 * This is the kind that makes the atlas an answer to "what did we spend with this vendor" rather than a map
 * of where that answer would come from. Today every family's `ingest` is `not-ingested` and says what would
 * change that; the row exists so the question has a place to be answered from, and so the enumeration the
 * owner's one bound requires is a stored record rather than a paragraph in a document.
 */
export const xeroFamilyDetailSchema = z
  .object({
    /** The Xero product this family belongs to — `accounting`, `payroll-nz`, `projects`, `finance`. */
    product: z.string().min(1),
    disposition: z.enum(XERO_FAMILY_DISPOSITIONS),
    /** Why this family carries the disposition it does, in the criterion's own terms. */
    dispositionReason: z.string().min(1),
    /** Every SDK-declared operation that reaches this family, as `<METHOD> <path>`, sorted. */
    operations: z.array(z.string().min(1)),
    /**
     * The subset of {@link operations} whose records are observations rather than configuration, sorted.
     *
     * Empty for a pure `configuration` family, every operation for a pure `voluminous` one, and a proper
     * subset for a `mixed` one — which is the only place the cut-through is expressible at all.
     */
    voluminousOperations: z.array(z.string().min(1)),
    /** Every declared browser page that shows this family, by page surface name, sorted. */
    pages: z.array(z.string().min(1)),
    /** Whether this atlas holds the family's rows, and what would change that when it does not. */
    ingest: z.enum(["not-ingested", "enumerated-only", "held"]),
    ingestBlockedBy: z.string().min(1).nullable(),
  })
  .strict();

export type XeroFamilyDetail = z.infer<typeof xeroFamilyDetailSchema>;

/**
 * What the browser saw one declared PAGE be. Kit-owned ({@link atlasPageDetailSchema}), because it is the
 * on-disk mirror of the walk's own {@link ../kit/pageWalk.js#PageObservation} and the two are only useful
 * if they agree — `kit/pageObservation.ts` is the one declaration both sides read.
 *
 * @internal
 */
export const xeroPageDetailSchema = atlasPageDetailSchema;

/**
 * What the browser saw one declared page be. Kit-owned — see above.
 *
 * @internal
 */
export type XeroPageDetail = AtlasPageDetail;

/** One channel's independent view of one entity. A successful look replaces only this channel's own detail. */
const xeroChannelEntitySchema = z
  .object({
    channel: z.enum(XERO_ATLAS_CHANNELS),
    /** What this channel knows about this entity. Shape depends on the kind — see the four detail schemas. */
    detail: z.unknown().nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: xeroSourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

export type XeroChannelEntity = z.infer<typeof xeroChannelEntitySchema>;

/** One tracked entity: a stable identity, plus whatever each channel independently knows about it. */
const xeroAtlasEntitySchema = z
  .object({
    channels: z
      .object({ api: xeroChannelEntitySchema.nullable(), browser: xeroChannelEntitySchema.nullable() })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(XERO_ATLAS_KINDS),
    /**
     * The provider's own key: `<METHOD> <path shape>` for a method, the declared route for a page, the
     * family name for a family. This is what the two channels are matched on, byte-exactly.
     */
    providerId: z.string().min(1),
  })
  .strict();

export type XeroAtlasEntity = z.infer<typeof xeroAtlasEntitySchema>;

/**
 * One coverage cell: what is known about one surface at one scope. `lastSuccessAt` and
 * `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one timestamp cannot answer
 * "is this still current" after a run that failed following one that succeeded.
 */
const xeroCoverageCellSchema = z
  .object({
    artifacts: z.array(xeroArtifactRefSchema),
    channel: z.enum(XERO_ATLAS_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.enum(XERO_COVERAGE_SURFACES),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.enum(XERO_VISIBILITY_SCOPES),
  })
  .strict();

export type XeroCoverageCell = z.infer<typeof xeroCoverageCellSchema>;

/**
 * A gap, as stored. This atlas's own condition vocabulary plus kind — see `gaps.ts`.
 *
 * `fields` and `surfaces` carry the CONTENT of a disagreement: which names one surface has and the other
 * does not, and which two surfaces those were. A disagreement gap without them says only that a
 * disagreement happened, which is a notification rather than a finding.
 */
const xeroAtlasGapSchema = z
  .object({
    condition: z.string().min(1),
    /** Which names the two surfaces disagree about. Empty unless the condition is a disagreement. */
    fields: z.array(z.string().min(1)),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(XERO_ATLAS_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    /** Which channels this gap concerns. Two, for a disagreement; empty when channel-independent. */
    surfaces: z.array(z.enum(XERO_ATLAS_CHANNELS)),
  })
  .strict();

export type XeroAtlasGap = z.infer<typeof xeroAtlasGapSchema>;

/** One kind's file on disk. */
export const xeroAtlasKindFileSchema = z
  .object({
    coverage: z.array(xeroCoverageCellSchema),
    entities: z.array(xeroAtlasEntitySchema),
    gaps: z.array(xeroAtlasGapSchema),
    kind: z.enum(XERO_ATLAS_KINDS),
    platform: z.literal(XERO_ATLAS_PLATFORM),
    schemaVersion: z.literal(XERO_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type XeroAtlasKindFile = z.infer<typeof xeroAtlasKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const xeroAtlasKindStatusSchema = z
  .object({
    /** A digest of the bytes published, so a later half-write is detectable rather than silent. */
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

/** @internal */
export type XeroAtlasKindStatus = z.infer<typeof xeroAtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const xeroAtlasManifestSchema = z
  .object({
    kinds: z.record(z.enum(XERO_ATLAS_KINDS), xeroAtlasKindStatusSchema),
    platform: z.literal(XERO_ATLAS_PLATFORM),
    schemaVersion: z.literal(XERO_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type XeroAtlasManifest = z.infer<typeof xeroAtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialXeroManifest({ updatedAt }: { updatedAt: string }): XeroAtlasManifest {
  const empty: XeroAtlasKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  return {
    kinds: { family: empty, method: empty, page: empty },
    platform: XERO_ATLAS_PLATFORM,
    schemaVersion: XERO_ATLAS_SCHEMA_VERSION,
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
export function emptyXeroKindFile({ kind, updatedAt }: { kind: XeroAtlasKind; updatedAt: string }): XeroAtlasKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: XERO_ATLAS_PLATFORM,
    schemaVersion: XERO_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}
