/**
 * The Nightfall atlas's on-disk vocabulary, and the schemas that refuse to trust it.
 *
 * ## This atlas holds EVERYTHING REACHABLE, entities included
 *
 * `docs/atlas-intent/06-holdings.md` makes what an atlas holds a per-platform test: does something better suited
 * already hold this platform's entities? Here nothing does. Nightfall is the organisation's data-loss
 * boundary — its endpoint agents, its browser extension, its AI-governance inventory of which MCP servers
 * and agent plugins are running on the fleet — and none of that exists in any other store on this machine.
 * The corpus holds what people SAID about DLP; nothing holds what Nightfall SEES. So the entity kinds are
 * the deliverable, and the surface map sits beside them.
 *
 * It is the complement of the CrowdStrike atlas by design: endpoint on one side, data egress on the other.
 *
 * ## The detections are shape-indexed, and that is the ruling rather than a shortcut
 *
 * Six of these kinds hold time-series observations — violations, findings, exfiltration and posture events
 * and their activity feeds — so they take the highly-voluminous disposition. `dispositions.ts` carries the
 * rule and the second reason it is unavoidable here: the vendor's own `Finding` component declares
 * `redactedSensitiveText`, `redactedContext` and `redactedLocation`, so the detection feed is a description
 * of the sensitive data the product exists to protect. Reproduce that with
 * `grep -o '"schemaName":"Finding"[^}]*' src/atlas/nightfall/generated/surfaces.ts`.
 *
 * ## Three channels, because this platform genuinely has three surfaces
 *
 * `published-api` is compiled from the six OpenAPI documents the vendor's own reference pages load, and it
 * needs no credential at all — it is filled on every install. `workflow-api` is the same API actually
 * CALLED, which needs a bearer token this installation does not hold. `console` is the walk of
 * `app.nightfall.ai` in the owner's own Chrome. The three are kept apart rather than folded, because what
 * one can reach and another cannot is the finding, and one surface succeeding must never erase what
 * another already knew.
 *
 * ## Nothing here holds a credential, or a detection
 *
 * An `operation` entity carries names — a method, a path template, parameter and response field NAMES, and
 * the vendor's own component field names. A record SHAPE is not a record: no instant, no person, no
 * detected content, nothing that grows with the clock.
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
import { NIGHTFALL_APIS, NIGHTFALL_PAGINGS, NIGHTFALL_SPEC_DOCUMENTS } from "./surfaceNaming.js";

/**
 * The on-disk schema version. Bump only with a real layout change; `store.ts` refuses to read a generation
 * declaring a different version, naming the reset remedy.
 */
export const NIGHTFALL_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — the published documents, the live workflow API and the
 * console are three SURFACES of this one atlas, which is `kit/contract.ts`'s whole header.
 */
export const NIGHTFALL_ATLAS_PLATFORM = "nightfall";

/**
 * Every kind this atlas publishes a file for.
 *
 * Eighteen of them are the vendor's own resource nouns, singularised, taken from the operation registry
 * rather than invented — `src/__tests__/unit/atlas/nightfall/model.test.ts` asserts EXACT equality with the
 * registry's kinds, so a document the vendor grows cannot leave a kind undeclared.
 *
 * There is deliberately NO `operation` kind. The surface map is filed under the resource kinds it maps, so
 * `slopweaver atlas nightfall read --kind violation` returns the six operations that reach a violation AND
 * the vendor's declaration of what one is, together. A separate surface-map kind was written first and
 * published zero entities, because every operation already belonged somewhere better — and it would have
 * split the two halves of the answer to one question across two files.
 *
 * `page` is the nineteenth, and it is empty on purpose: it is where a console walk lands the day it runs,
 * and it carries the console's own gaps meanwhile, so the browser surface has a file that SAYS it is
 * unfilled rather than no file at all.
 *
 * A kind here is a DECLARATION, never a claim that anything has been read: each kind's own coverage cell
 * says what actually happened to it.
 */
export const NIGHTFALL_ATLAS_KINDS = [
  "ai-device",
  "annotation",
  "endpoint-collection",
  "endpoint-device",
  "endpoint-mcp-collection",
  "exfiltration-activity",
  "exfiltration-event",
  "finding",
  "github-repository",
  "hook",
  "ide-extension",
  "mcp-server",
  "page",
  "plugin",
  "posture-activity",
  "posture-event",
  "scan",
  "upload",
  "violation",
] as const;

/** One kind this atlas publishes. */
export type NightfallAtlasKind = (typeof NIGHTFALL_ATLAS_KINDS)[number];

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what another already knew.
 */
export const NIGHTFALL_ATLAS_CHANNELS = ["published-api", "workflow-api", "console"] as const;

/** One channel of this atlas. */
export type NightfallAtlasChannel = (typeof NIGHTFALL_ATLAS_CHANNELS)[number];

/**
 * What a channel's evidence is worth for one surface. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type NightfallEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface, through one channel. Kit-owned and closed.
 * @internal
 */
export type NightfallCoverageState = AtlasCoverageState;

/**
 * The claim boundary a coverage cell carries — one per channel, because the three ceilings are unrelated.
 *
 * The published documents' ceiling is what the vendor chose to publish, and no credential widens it. The
 * workflow API's is what one bearer token's own scopes open. The console's is what the signed-in session's
 * own role can render, and a member reached by an SSO assignment to an OIDC application, rather than by an
 * admin grant, renders only what that assignment opens.
 * @internal
 */
export const NIGHTFALL_VISIBILITY_SCOPES = [
  "published-documents",
  "bearer-token-scopes",
  "console-signed-in-roles",
] as const;

/**
 * The claim boundary one channel reads under.
 * @internal
 */
export type NightfallVisibilityScope = (typeof NIGHTFALL_VISIBILITY_SCOPES)[number];

/**
 * The visibility ceiling one channel reads under.
 *
 * @param channel the channel that produced the cell
 * @returns that channel's own ceiling
 */
export function nightfallVisibilityScopeFor({ channel }: { channel: NightfallAtlasChannel }): NightfallVisibilityScope {
  if (channel === "published-api") {
    return "published-documents";
  }
  if (channel === "console") {
    return "console-signed-in-roles";
  }
  return "bearer-token-scopes";
}

const isoSchema = z.iso.datetime();

/**
 * One artifact backing a fact — a proof screenshot. Kit-owned.
 * @internal
 */
export const nightfallArtifactRefSchema = atlasArtifactRefSchema;

/**
 * One artifact backing a fact.
 * @internal
 */
export type NightfallArtifactRef = z.infer<typeof nightfallArtifactRefSchema>;

/**
 * Where a record came from, and the link that proves it to a human.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const nightfallSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(NIGHTFALL_ATLAS_CHANNELS) })
  .strict();

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type NightfallSource = z.infer<typeof nightfallSourceSchema>;

/**
 * What one published operation declares — the compiled surface map, one entity per operation.
 *
 * Every field is a NAME the vendor published. There is no value here and there cannot be: nothing in this
 * detail was fetched from the organisation's tenant, so the whole `operation` kind is publishable on an
 * install that holds no Nightfall credential whatsoever.
 * @internal
 */
export const nightfallOperationDetailSchema = z
  .object({
    api: z.enum(NIGHTFALL_APIS),
    bodyParams: z.array(z.string().min(1)),
    deprecated: z.boolean(),
    /** One of the four dispositions — `dispositions.ts` carries the rule that decides it. */
    disposition: z.enum(["entity", "shape-index", "probe-only", "excluded"]),
    /** Why this is not a plain entity. `null` only when it is one. */
    dispositionBecause: z.string().min(1).nullable(),
    /** Which refusal applied. `null` unless the disposition is `excluded`. */
    exclusionReason: z.enum(["mutating", "side-effecting", "egressing"]).nullable(),
    headerParams: z.array(z.string().min(1)),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    /** The vendor's own `operationId`, or `null` where the document declares none. */
    operationId: z.string().min(1).nullable(),
    paging: z.enum(NIGHTFALL_PAGINGS),
    path: z.string().min(1),
    pathParams: z.array(z.string().min(1)),
    queryParams: z.array(z.string().min(1)),
    responseFields: z.array(z.string().min(1)),
    security: z.array(z.string().min(1)),
    /** The document's own server URL. Part of the identity — `surfaceRow.ts` carries the measurement. */
    server: z.string().min(1),
    specDocument: z.enum(NIGHTFALL_SPEC_DOCUMENTS),
    summary: z.string().min(1).nullable(),
  })
  .strict();

/**
 * What one published operation declares.
 * @internal
 */
export type NightfallOperationDetail = z.infer<typeof nightfallOperationDetailSchema>;

/**
 * What a record of one kind DECLARES, from the vendor's own component schema.
 *
 * The half of a shape index that needs no credential, and the reason eighteen kinds that hold no rows still
 * answer a question. It is deliberately not an entity of the kind it describes: a `violation` file carries
 * one of these and zero violations, which is the shape-index disposition made visible on disk rather than
 * asserted in prose.
 * @internal
 */
export const nightfallRecordShapeDetailSchema = z
  .object({
    /** Every field name the component declares, sorted. */
    fields: z.array(z.string().min(1)).min(1),
    /** The vendor's own component name, e.g. `Violation` — the handle back into the document. */
    schemaName: z.string().min(1),
    /** The operation whose declared response carried it, so the derivation is reproducible. */
    sourceOperation: z.string().min(1),
  })
  .strict();

/**
 * What a record of one kind declares.
 * @internal
 */
export type NightfallRecordShapeDetail = z.infer<typeof nightfallRecordShapeDetailSchema>;

/**
 * What one entity IS, across every detail shape this atlas can hold.
 *
 * A plain union rather than a discriminated one, because the two members share no field and Zod resolves
 * them unambiguously on their required keys. A third member joins it when the workflow-API channel lands
 * and starts carrying provider records; widening this union is that change, not a new schema beside it.
 * @internal
 */
export const nightfallEntityDetailSchema = z.union([nightfallOperationDetailSchema, nightfallRecordShapeDetailSchema]);

/**
 * What one entity is.
 * @internal
 */
export type NightfallEntityDetail = z.infer<typeof nightfallEntityDetailSchema>;

/**
 * What one channel knows about one entity. A channel that has never looked is `null`, never an empty record.
 * @internal
 */
export const nightfallChannelEntitySchema = z
  .object({
    detail: nightfallEntityDetailSchema,
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: nightfallSourceSchema,
    state: z.enum(["observed", "stale"]),
  })
  .strict();

/**
 * What one channel knows about one entity.
 * @internal
 */
export type NightfallChannelEntity = z.infer<typeof nightfallChannelEntitySchema>;

/**
 * What an entity IS, as a closed enum rather than a shape a reader has to infer.
 *
 * The publish gate in `store.ts` refuses a stored RECORD of a shape-indexed kind, so it has to be able to
 * tell one from an operation and from a declared record shape. A first draft did that by looking at the
 * `providerId` prefix, and it was wrong on its own first run: every operation entity begins `GET https://…`
 * and the gate read all 56 of them as detections, refusing the very generation it was written to protect.
 *
 * The lesson is the general one. A guard whose criterion is a string prefix is a guard that silently
 * changes meaning when a naming convention moves, and a naming convention is exactly the thing nobody
 * treats as load-bearing. So the family is DECLARED on the entity and validated by the schema, and the
 * failure mode of getting it wrong is a parse error rather than a wrong verdict.
 */
export const NIGHTFALL_ENTITY_FAMILIES = ["operation", "record-shape", "record"] as const;

/**
 * What one entity is.
 * @internal
 */
export type NightfallEntityFamily = (typeof NIGHTFALL_ENTITY_FAMILIES)[number];

/** One entity, with one slot per channel. */
export const nightfallAtlasEntitySchema = z
  .object({
    channels: z
      .object({
        console: nightfallChannelEntitySchema.nullable(),
        "published-api": nightfallChannelEntitySchema.nullable(),
        "workflow-api": nightfallChannelEntitySchema.nullable(),
      })
      .strict(),
    /**
     * What this entity is — the field the publish gate branches on. See {@link NIGHTFALL_ENTITY_FAMILIES}
     * for why this is declared rather than inferred from the provider key.
     */
    family: z.enum(NIGHTFALL_ENTITY_FAMILIES),
    id: z.string().min(1),
    kind: z.enum(NIGHTFALL_ATLAS_KINDS),
    /**
     * The provider's own key: `<METHOD> <server><path>` for an operation, `shape:<ComponentName>` for a
     * declared record shape, and the provider's own id once a live channel carries real records. This is
     * what the channels are matched on, byte-exactly.
     */
    providerId: z.string().min(1),
  })
  .strict();

/** One entity, with one slot per channel. */
export type NightfallAtlasEntity = z.infer<typeof nightfallAtlasEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel.
 *
 * `lastSuccessAt` and `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one
 * timestamp cannot answer "is this still current" after a run that failed following one that succeeded.
 */
const nightfallCoverageCellSchema = z
  .object({
    artifacts: z.array(nightfallArtifactRefSchema),
    channel: z.enum(NIGHTFALL_ATLAS_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.enum(NIGHTFALL_VISIBILITY_SCOPES),
  })
  .strict();

/** One coverage cell. */
export type NightfallCoverageCell = z.infer<typeof nightfallCoverageCellSchema>;

/** A gap, as stored. This atlas's own condition vocabulary plus kind — see `gaps.ts`. */
export const nightfallAtlasGapSchema = z
  .object({
    condition: z.string().min(1),
    /** The names a gap is ABOUT — an operation, a component, a page. Empty when the gap names none. */
    fields: z.array(z.string().min(1)),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(NIGHTFALL_ATLAS_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    surfaces: z.array(z.enum(NIGHTFALL_ATLAS_CHANNELS)),
  })
  .strict();

/** A gap, as stored. */
export type NightfallAtlasGap = z.infer<typeof nightfallAtlasGapSchema>;

/** One kind's file on disk. */
export const nightfallAtlasKindFileSchema = z
  .object({
    coverage: z.array(nightfallCoverageCellSchema),
    entities: z.array(nightfallAtlasEntitySchema),
    gaps: z.array(nightfallAtlasGapSchema),
    kind: z.enum(NIGHTFALL_ATLAS_KINDS),
    platform: z.literal(NIGHTFALL_ATLAS_PLATFORM),
    schemaVersion: z.literal(NIGHTFALL_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

/** One kind's file on disk. */
export type NightfallAtlasKindFile = z.infer<typeof nightfallAtlasKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const nightfallAtlasKindStatusSchema = z
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
export type NightfallAtlasKindStatus = z.infer<typeof nightfallAtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const nightfallAtlasManifestSchema = z
  .object({
    kinds: z.record(z.enum(NIGHTFALL_ATLAS_KINDS), nightfallAtlasKindStatusSchema),
    platform: z.literal(NIGHTFALL_ATLAS_PLATFORM),
    schemaVersion: z.literal(NIGHTFALL_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

/** The manifest. */
export type NightfallAtlasManifest = z.infer<typeof nightfallAtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * Built by iterating {@link NIGHTFALL_ATLAS_KINDS} rather than by writing twenty literal keys, because a
 * hand-written map whose only content is a repetition of the kind list is a map that silently drifts from
 * it — the reasoning `stateHome.ts` gives for computing the Datadog kind paths the same way.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty manifest
 */
export function initialNightfallManifest({ updatedAt }: { updatedAt: string }): NightfallAtlasManifest {
  const empty: NightfallAtlasKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  return {
    kinds: byNightfallKind({ build: () => empty }),
    platform: NIGHTFALL_ATLAS_PLATFORM,
    schemaVersion: NIGHTFALL_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}

/**
 * Build one value per declared kind, as a total record.
 *
 * The single place this atlas narrows a built-up object to `Record<NightfallAtlasKind, T>`. It is total by
 * construction — it maps the kind constant itself — but `Object.fromEntries` widens the key back to
 * `string`, which no expression can undo. Concentrating the assertion here rather than repeating it in the
 * manifest builder, the reset and the sync is the point: three assertions are three places to get a kind
 * list wrong, and one is a place to look.
 *
 * @param build called once per kind, with the kind it is building for
 * @returns a record with every declared kind present
 */
export function byNightfallKind<T>({
  build,
}: {
  build: (input: { kind: NightfallAtlasKind }) => T;
}): Record<NightfallAtlasKind, T> {
  const entries = NIGHTFALL_ATLAS_KINDS.map((kind) => [kind, build({ kind })] as const);
  // `as`: built from this atlas's own exhaustive kind list, which `Object.fromEntries` widens to string.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return Object.fromEntries(entries) as Record<NightfallAtlasKind, T>;
}

/**
 * An empty kind file.
 *
 * @param kind the kind this file holds
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty kind file
 */
export function emptyNightfallKindFile({
  kind,
  updatedAt,
}: {
  kind: NightfallAtlasKind;
  updatedAt: string;
}): NightfallAtlasKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: NIGHTFALL_ATLAS_PLATFORM,
    schemaVersion: NIGHTFALL_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}

/**
 * An entity whose channels are all empty, ready for one channel to be filled onto it.
 *
 * @returns the empty channel map
 */
export function emptyNightfallChannels(): NightfallAtlasEntity["channels"] {
  return { console: null, "published-api": null, "workflow-api": null };
}
