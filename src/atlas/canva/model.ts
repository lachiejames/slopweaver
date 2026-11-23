/**
 * The Canva atlas's on-disk vocabulary, and the schemas that refuse to trust it.
 *
 * ## This atlas holds the SURFACE MAP, and the reason is what is reachable rather than who else holds it
 *
 * `docs/atlas-intent/06-holdings.md` makes what an atlas holds a per-platform test: does something better suited
 * already hold this platform's entities? Nothing here does — no design, folder, asset, brand template or
 * comment exists anywhere else in this installation — so the test's own answer is "everything reachable,
 * entities included", and that is the shape this atlas is built to grow into.
 *
 * What is reachable TODAY is the published surface and nothing else, and stating that precisely is the
 * whole honesty of the file. MEASURED: no `canva-*` entry exists under `$SLOPWEAVER_HOME/secrets`,
 * and 53 of the 59 published operations require an OAuth authorisation-code grant that only a registered
 * integration can obtain — of the other six, three are the OAuth token endpoints themselves and three are
 * public JWKS key sets that hold nothing about anybody's account. So the compiled channel is filled, the two
 * channels that would carry entities are declared and unfilled with their own remedies, and no entity kind
 * is minted for records nothing can fetch. A kind declared and permanently empty would read as "Canva holds
 * none of these", which is the one thing this atlas must never say by accident.
 *
 * ## Three channels, because this platform genuinely has three surfaces
 *
 * `published-api` is compiled from the vendor's own OpenAPI description and needs no credential at all — it
 * is filled on every install. `connect-api` is the same API actually CALLED, which needs an integration and
 * a user grant this installation does not have. `web-app` is the walk of `canva.com` in the owner's own
 * Chrome. The three are kept apart rather than folded, because what one can reach and another cannot is the
 * finding, and one surface succeeding must never erase what another already knew.
 *
 * ## Nothing here holds a design, a comment or a credential
 *
 * An `operation` entity carries NAMES — a method, a path template, parameter and response field names — and
 * a `scope` entity carries the vendor's own scope string and the operations that name it. Neither is a
 * record: no instant, no person, no design content, nothing that grows with the clock.
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
export const CANVA_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — the published description, the live Connect API and the
 * web app are three SURFACES of this one atlas, which is `kit/contract.ts`'s whole header.
 */
export const CANVA_ATLAS_PLATFORM = "canva";

/**
 * The one kind that is not a vendor tag: where the browser surface lands.
 *
 * Empty on purpose today, and it carries the web-app channel's own gaps meanwhile, so the browser surface
 * has a file that SAYS it is unfilled rather than no file at all. Nightfall's `page` kind is the sibling and
 * the reasoning is identical.
 */
export const CANVA_PAGE_KIND = "page";

/**
 * Every kind this atlas publishes a file for: the vendor's own 16 tags, plus `page`.
 *
 * The 16 are the vendor's own `tags`, kebab-cased — never derived from path segments, because this vendor
 * publishes a taxonomy and a second one would compete with it. `src/__tests__/unit/atlas/canva/model.test.ts`
 * asserts EXACT equality with the registry's kinds, so a description that grew a product area cannot leave
 * a kind undeclared.
 *
 * A kind here is a DECLARATION, never a claim that anything has been read: each kind's own coverage cell
 * says what actually happened to it.
 */
export const CANVA_ATLAS_KINDS = [
  "analytics",
  "app",
  "asset",
  "autofill",
  "brand-template",
  "comment",
  "connect",
  "design",
  "design-import",
  "export",
  "folder",
  "merge",
  "oauth",
  "oidc",
  "page",
  "resize",
  "user",
] as const;

/** One kind this atlas publishes. */
export type CanvaAtlasKind = (typeof CANVA_ATLAS_KINDS)[number];

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what another already knew.
 */
export const CANVA_ATLAS_CHANNELS = ["published-api", "connect-api", "web-app"] as const;

/** One channel of this atlas. */
export type CanvaAtlasChannel = (typeof CANVA_ATLAS_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type CanvaEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type CanvaCoverageState = AtlasCoverageState;

/**
 * The claim boundary a coverage cell carries — one per channel, because the three ceilings are unrelated.
 *
 * The published description's ceiling is what the vendor chose to publish, and no credential widens it. The
 * Connect API's is narrower than a scope list alone suggests: `eligibility.ts` measures nine operations that
 * additionally require the acting user to be on a particular plan or in a Canva Enterprise organisation. The
 * web app's is what the owner's own signed-in session renders, which is the owner's personal account rather than an
 * organisation-admin one.
 * @internal
 */
export const CANVA_VISIBILITY_SCOPES = [
  "published-description",
  "integration-scopes-and-entitlements",
  "web-app-signed-in-account",
] as const;

/**
 * The claim boundary one channel reads under.
 * @internal
 */
export type CanvaVisibilityScope = (typeof CANVA_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one channel reads under.
 *
 * @param channel the channel that produced the cell
 * @returns that channel's own ceiling
 */
export function canvaVisibilityScopeFor({ channel }: { channel: CanvaAtlasChannel }): CanvaVisibilityScope {
  if (channel === "published-api") {
    return "published-description";
  }
  if (channel === "web-app") {
    return "web-app-signed-in-account";
  }
  return "integration-scopes-and-entitlements";
}

const isoSchema = z.iso.datetime();

/**
 * One artifact backing a fact — a proof screenshot. Kit-owned.
 * @internal
 */
export const canvaArtifactRefSchema = atlasArtifactRefSchema;

/**
 * One artifact backing a fact.
 * @internal
 */
export type CanvaArtifactRef = z.infer<typeof canvaArtifactRefSchema>;

/**
 * Where a record came from, and the link that proves it to a human.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const canvaSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(CANVA_ATLAS_CHANNELS) })
  .strict();

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type CanvaSource = z.infer<typeof canvaSourceSchema>;

/**
 * What one published operation declares — the compiled surface map, one entity per operation.
 *
 * Every field is a NAME or a judgement over names. There is no value here and there cannot be: nothing in
 * this detail was fetched from anybody's Canva account, so the whole `operation` family is publishable on an
 * install that holds no Canva credential whatsoever.
 * @internal
 */
export const canvaOperationDetailSchema = z
  .object({
    bodyParams: z.array(z.string().min(1)),
    /** The vendor's own `x-required-capabilities`. See `eligibility.ts` for where it disagrees with prose. */
    capabilities: z.array(z.string().min(1)),
    deprecated: z.boolean(),
    effect: z.enum(["read", "mutating", "side-effecting"]),
    /** Why this is not a plain read. `null` only when it is one. */
    effectBecause: z.string().min(1).nullable(),
    entitlement: z.enum(["none", "enterprise-organization", "premium-plan"]),
    /** The vendor's own requirement sentence. `null` only when the entitlement is `none`. */
    entitlementBecause: z.string().min(1).nullable(),
    headerParams: z.array(z.string().min(1)),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    /** Whether the vendor's own description sends the reader to the browser — `docs/atlas-intent/02-both-surfaces.md`. */
    namesTheCanvaUi: z.boolean(),
    paging: z.enum(["continuation", "none"]),
    path: z.string().min(1),
    pathParams: z.array(z.string().min(1)),
    queryParams: z.array(z.string().min(1)),
    rateLimitPerUserPerMinute: z.number().int().positive().nullable(),
    responseFields: z.array(z.string().min(1)),
    scopes: z.array(z.string().min(1)),
    security: z.array(z.string().min(1)),
    /** The description's own single server URL. Provenance, not identity — `surfaceRow.ts` says why. */
    server: z.string().min(1),
    stability: z.enum(["stable", "preview", "deprecated"]),
    synopsis: z.string().min(1),
  })
  .strict();

/**
 * What one published operation declares.
 * @internal
 */
export type CanvaOperationDetail = z.infer<typeof canvaOperationDetailSchema>;

/**
 * What one declared OAuth scope grants, and which operations actually name it.
 *
 * An entity of its own rather than a field on an operation, because the GRANT surface is strictly wider than
 * the CALL surface: MEASURED, the description declares 18 scopes and its operations between them name 16.
 * `collaboration:event` and `folder:permission:write` can be granted to an integration and reach no
 * published operation at all, and a scope list flattened onto operations could not represent that at all.
 * @internal
 */
export const canvaScopeDetailSchema = z
  .object({
    /** Every operation that names it, sorted. Empty for a scope the published call surface never uses. */
    namedBy: z.array(z.string().min(1)),
    /** The vendor's own scope string, e.g. `folder:permission:write`. */
    scope: z.string().min(1),
  })
  .strict();

/**
 * What one declared OAuth scope grants.
 * @internal
 */
export type CanvaScopeDetail = z.infer<typeof canvaScopeDetailSchema>;

/**
 * What one entity IS, across every detail shape this atlas can hold.
 *
 * A plain union rather than a discriminated one, because the two members share no field and Zod resolves
 * them unambiguously on their required keys. A third member joins it when a live channel lands and starts
 * carrying provider records; widening this union is that change, not a new schema beside it.
 * @internal
 */
export const canvaEntityDetailSchema = z.union([canvaOperationDetailSchema, canvaScopeDetailSchema]);

/**
 * What one entity is.
 * @internal
 */
export type CanvaEntityDetail = z.infer<typeof canvaEntityDetailSchema>;

/**
 * What one channel knows about one entity. A channel that has never looked is `null`, never an empty record.
 * @internal
 */
export const canvaChannelEntitySchema = z
  .object({
    detail: canvaEntityDetailSchema,
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: canvaSourceSchema,
    state: z.enum(["observed", "stale"]),
  })
  .strict();

/**
 * What one channel knows about one entity.
 * @internal
 */
export type CanvaChannelEntity = z.infer<typeof canvaChannelEntitySchema>;

/**
 * What an entity IS, as a closed enum rather than a shape a reader has to infer.
 *
 * Declared on the entity rather than inferred from the `providerId` prefix, which is the correction
 * Nightfall's `model.ts` paid for: a guard whose criterion is a string prefix silently changes meaning when
 * a naming convention moves, and a naming convention is exactly the thing nobody treats as load-bearing.
 * With the family declared and schema-validated, getting it wrong is a parse error rather than a wrong
 * verdict.
 *
 * `record` is deliberately absent. This atlas stores no provider record and no channel that could produce
 * one is filled, so declaring the family now would be a promise in a type rather than a fact on disk — the
 * commit that fills a live channel is the commit that adds it.
 * @internal
 */
export const CANVA_ENTITY_FAMILIES = ["operation", "scope"] as const;

/**
 * What one entity is.
 * @internal
 */
export type CanvaEntityFamily = (typeof CANVA_ENTITY_FAMILIES)[number];

/** One entity, with one slot per channel. */
const canvaAtlasEntitySchema = z
  .object({
    channels: z
      .object({
        "connect-api": canvaChannelEntitySchema.nullable(),
        "published-api": canvaChannelEntitySchema.nullable(),
        "web-app": canvaChannelEntitySchema.nullable(),
      })
      .strict(),
    /** What this entity is — see {@link CANVA_ENTITY_FAMILIES} for why this is declared rather than inferred. */
    family: z.enum(CANVA_ENTITY_FAMILIES),
    id: z.string().min(1),
    kind: z.enum(CANVA_ATLAS_KINDS),
    /**
     * The provider's own key: `<METHOD> <path>` for an operation and `scope:<scope>` for a declared scope.
     * This is what the channels are matched on, byte-exactly.
     */
    providerId: z.string().min(1),
  })
  .strict();

/** One entity, with one slot per channel. */
export type CanvaAtlasEntity = z.infer<typeof canvaAtlasEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel.
 *
 * `lastSuccessAt` and `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one
 * timestamp cannot answer "is this still current" after a run that failed following one that succeeded.
 */
const canvaCoverageCellSchema = z
  .object({
    artifacts: z.array(canvaArtifactRefSchema),
    channel: z.enum(CANVA_ATLAS_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.enum(CANVA_VISIBILITY_SCOPES),
  })
  .strict();

/** One coverage cell. */
export type CanvaCoverageCell = z.infer<typeof canvaCoverageCellSchema>;

/** A gap, as stored. This atlas's own condition vocabulary plus kind — see `gaps.ts`. */
export const canvaAtlasGapSchema = z
  .object({
    condition: z.string().min(1),
    /** The names a gap is ABOUT — an operation, a scope, a tag. Empty when the gap names none. */
    fields: z.array(z.string().min(1)),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(CANVA_ATLAS_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    surfaces: z.array(z.enum(CANVA_ATLAS_CHANNELS)),
  })
  .strict();

/** A gap, as stored. */
export type CanvaAtlasGap = z.infer<typeof canvaAtlasGapSchema>;

/** One kind's file on disk. */
export const canvaAtlasKindFileSchema = z
  .object({
    coverage: z.array(canvaCoverageCellSchema),
    entities: z.array(canvaAtlasEntitySchema),
    gaps: z.array(canvaAtlasGapSchema),
    kind: z.enum(CANVA_ATLAS_KINDS),
    platform: z.literal(CANVA_ATLAS_PLATFORM),
    schemaVersion: z.literal(CANVA_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

/** One kind's file on disk. */
export type CanvaAtlasKindFile = z.infer<typeof canvaAtlasKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const canvaAtlasKindStatusSchema = z
  .object({
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

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export type CanvaAtlasKindStatus = z.infer<typeof canvaAtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const canvaAtlasManifestSchema = z
  .object({
    kinds: z.record(z.enum(CANVA_ATLAS_KINDS), canvaAtlasKindStatusSchema),
    platform: z.literal(CANVA_ATLAS_PLATFORM),
    schemaVersion: z.literal(CANVA_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

/** The manifest. */
export type CanvaAtlasManifest = z.infer<typeof canvaAtlasManifestSchema>;

/**
 * Build one value per declared kind, as a total record.
 *
 * The single place this atlas narrows a built-up object to `Record<CanvaAtlasKind, T>`. It is total by
 * construction — it maps the kind constant itself — but `Object.fromEntries` widens the key back to
 * `string`, which no expression can undo. Concentrating the assertion here rather than repeating it in the
 * manifest builder, the reset and the sync is the point: three assertions are three places to get a kind
 * list wrong, and one is a place to look.
 *
 * @param build called once per kind, with the kind it is building for
 * @returns a record with every declared kind present
 */
export function byCanvaKind<T>({
  build,
}: {
  build: (input: { kind: CanvaAtlasKind }) => T;
}): Record<CanvaAtlasKind, T> {
  const entries = CANVA_ATLAS_KINDS.map((kind) => [kind, build({ kind })] as const);
  // `as`: built from this atlas's own exhaustive kind list, which `Object.fromEntries` widens to string.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return Object.fromEntries(entries) as Record<CanvaAtlasKind, T>;
}

/**
 * A manifest with every kind present and never synced.
 *
 * Built by iterating {@link CANVA_ATLAS_KINDS} rather than by writing seventeen literal keys, because a
 * hand-written map whose only content is a repetition of the kind list is a map that silently drifts from
 * it — the reasoning `stateHome.ts` gives for computing the Datadog kind paths the same way.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialCanvaManifest({ updatedAt }: { updatedAt: string }): CanvaAtlasManifest {
  const empty: CanvaAtlasKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  return {
    kinds: byCanvaKind({ build: () => empty }),
    platform: CANVA_ATLAS_PLATFORM,
    schemaVersion: CANVA_ATLAS_SCHEMA_VERSION,
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
export function emptyCanvaKindFile({
  kind,
  updatedAt,
}: {
  kind: CanvaAtlasKind;
  updatedAt: string;
}): CanvaAtlasKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: CANVA_ATLAS_PLATFORM,
    schemaVersion: CANVA_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}

/**
 * An entity whose channels are all empty, ready for one channel to be filled onto it.
 *
 * @returns the empty channel map
 */
export function emptyCanvaChannels(): CanvaAtlasEntity["channels"] {
  return { "connect-api": null, "published-api": null, "web-app": null };
}
