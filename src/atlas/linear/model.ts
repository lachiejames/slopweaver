/**
 * The Linear atlas's on-disk vocabulary — the generation that holds BOTH surfaces, and the schemas that
 * refuse to trust it.
 *
 * ## Why this atlas is a SURFACE MAP and not an entity store
 *
 * Owner's rule: for a platform whose entities the corpus already holds, the atlas maps the
 * SURFACE — every place information can be asked for — and leaves the issues, projects, comments and
 * documents to `refresh`. Linear is such a platform. So the four kinds below are a catalogue of what can be
 * ASKED and where it can be SEEN, never a copy of what the workspace contains. `descriptor.ts`'s `excludes`
 * is the enforceable half of that sentence.
 *
 * ## Four kinds, and the question each one alone can answer
 *
 * - `operation` — one GraphQL ROOT field. "What calls exist, what may I send them, what do they hand back."
 * - `type` — one named schema type. "Is there any call in this API that can hand me this field at all."
 *   Folding this into `operation` would answer the first question and lose the second, because a field two
 *   hops down a return type appears in no root field's own path list.
 * - `page` — one reachable settings or admin page. "What is the exact URL to open for a proof screenshot",
 *   which `docs/atlas-intent/05-browser-proof.md` makes a first-class requirement rather than a convenience.
 * - `setting` — one piece of workspace or team CONFIGURATION. "What is this workspace actually configured
 *   to do", which is the half of the owner's ask — workspace and team settings, workflow states,
 *   integrations — that neither a schema catalogue nor a screenshot can answer on its own.
 *
 * ## Two channels, matched on the provider's own key, byte-exact
 *
 * An entity's id derives from its provider key and nothing else, and that exactness IS the disagreement
 * detector: a normalising match would fold a root field the first-party client calls into a similarly named
 * one the schema declares and manufacture an agreement nobody observed — hiding exactly the undocumented
 * surface both-surfaces exists to find. A key seen on one channel and not the other is a RECORD:
 *
 *  - both channels filled — comparable: the argument and response-path diffs are real findings;
 *  - `api` only — the schema declares an operation this member's web client never sent;
 *  - `browser` only — an UNDOCUMENTED operation, which is the finding the ruling is about.
 *
 * ## Nothing here holds a workspace's content
 *
 * Every field an `operation` or `type` entity carries is a NAME. A `setting` carries configuration VALUES,
 * which is the point of the kind — a workflow state's name and position, a team's estimation scheme — and
 * never an issue, a comment or a document body. `graphqlObservations.ts` is the reduction that keeps the
 * browser channel to names, and it is committed and tested precisely so it can be reviewed rather than
 * trusted.
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
 * The on-disk schema version. Bump only with a real layout change; the store refuses to read a generation
 * declaring a different version and names `atlas linear reset` as the remedy.
 */
export const LINEAR_ATLAS_SCHEMA_VERSION = 1;

/**
 * The platform discriminator. ONE per SaaS app — the GraphQL API and the web client are two SURFACES of
 * this one atlas, never two atlases.
 */
export const LINEAR_ATLAS_PLATFORM = "linear";

/** The entity kinds this atlas holds. Iterated by the reader, never derived from the directory listing. */
export const LINEAR_ATLAS_KINDS = ["operation", "page", "setting", "type"] as const;

export type LinearAtlasKind = (typeof LINEAR_ATLAS_KINDS)[number];

/**
 * How a fact was reached. Each channel owns independent presence and detail — one surface succeeding must
 * never erase what the other already knew.
 */
export const LINEAR_ATLAS_CHANNELS = ["api", "browser"] as const;

/** @internal */
export type LinearAtlasChannel = (typeof LINEAR_ATLAS_CHANNELS)[number];

/**
 * What a channel's evidence is worth. Kit-owned — see `kit/contract.ts`.
 * @internal
 */
export type LinearEvidenceRole = AtlasEvidenceRole;

/**
 * How far this atlas has got with one surface. Kit-owned and closed.
 * @internal
 */
export type LinearCoverageState = AtlasCoverageState;

/**
 * The permanent claim boundary every coverage cell carries.
 *
 * Both surfaces are bounded by ONE member's entitlements: the API half sees what this API key's actor may
 * ask for, and the browser half sees what this signed-in member's web client renders. Where
 * `viewer.admin` is `false` on the account an install holds, a workspace-administration page is outside
 * reach and always will be under that credential. That is permanent for such an install rather than a
 * placeholder, and `coverage.ts` records the refusals it produces as gaps rather than as silence.
 */
export const LINEAR_ATLAS_VISIBILITY_SCOPE = "one-member-session";

const isoSchema = z.iso.datetime();

/**
 * One artifact backing a fact — a proof screenshot, an extracted page. Kit-owned.
 * @internal
 */
export const linearArtifactRefSchema = atlasArtifactRefSchema;

/** @internal */
export type LinearArtifactRef = z.infer<typeof linearArtifactRefSchema>;

/**
 * Where a record came from, and the link that proves it to a human.
 *
 * Derived from the kit's {@link atlasSourceSchema} so the deep-link contract — a nullable link whose STATUS
 * is never nullable — is the one every atlas carries. The one substitution is this atlas's: it names its
 * acquisition path `channel`, matching the entity shape a reader greps beside it.
 * @internal
 */
export const linearSourceSchema = atlasSourceSchema
  .omit({ surface: true })
  .extend({ channel: z.enum(LINEAR_ATLAS_CHANNELS) })
  .strict();

/**
 * Where a record came from, through one channel.
 * @internal
 */
export type LinearSource = z.infer<typeof linearSourceSchema>;

/** Which root type a GraphQL operation hangs off. Linear declares all three. */
const LINEAR_ROOT_KINDS = ["query", "mutation", "subscription"] as const;

export type LinearRootKind = (typeof LINEAR_ROOT_KINDS)[number];

/**
 * What the API surface knows about one root field: the argument names it accepts and the response field
 * paths it can hand back.
 *
 * Deliberately not the schema's own types verbatim. The comparison this atlas exists to make is
 * name-against-name, so the stored shape is the two name sets plus the schema's own description — which is
 * what makes a diff against the browser channel a set operation rather than a parse. `responsePaths` is
 * resolved one level into the return type, matching the Slack atlas, because a deeper walk of a schema with
 * 5,146 object fields would store the whole type graph under every one of 545 root fields; the graph itself
 * is the `type` kind's job.
 */
const linearOperationApiDetailSchema = z
  .object({
    /** The schema's own description, or `""` when it declares none. */
    description: z.string(),
    /** Why the schema says not to use this, when it is deprecated. */
    deprecationReason: z.string().nullable(),
    isDeprecated: z.boolean(),
    /** Every argument name the schema declares for this field, sorted. */
    paramNames: z.array(z.string().min(1)),
    /** Every response field path the schema declares, top level and one level down, sorted. */
    responsePaths: z.array(z.string().min(1)),
    /** The unwrapped name of the type this field returns. */
    returnType: z.string().min(1),
    rootKind: z.enum(LINEAR_ROOT_KINDS),
  })
  .strict();

export type LinearOperationApiDetail = z.infer<typeof linearOperationApiDetailSchema>;

/**
 * What the browser surface saw one root field do: how often the first-party client selected it, and the
 * response field paths it actually got back.
 *
 * There is no `paramNames` here and its absence is a measured fact rather than an omission. The page
 * transport captures a response's URL, method, status and BODY; it captures no request body, and Linear's
 * web client sends its variables in the POST body. So the browser channel can establish that an operation
 * was selected and what came back, and is silent on what was sent — which is why `disagreement.ts` reports
 * response-path differences and never claims an undeclared argument.
 */
const linearOperationBrowserDetailSchema = z
  .object({
    /** How many captured responses carried this root field. A frequency, never a payload. */
    callCount: z.number().int().positive(),
    /** Every response field path observed, value-shaped segments redacted, sorted. */
    responsePaths: z.array(z.string().min(1)),
    /** How many distinct paths were seen before the per-operation cap truncated the list. */
    responsePathsTotal: z.number().int().nonnegative(),
  })
  .strict();

export type LinearOperationBrowserDetail = z.infer<typeof linearOperationBrowserDetailSchema>;

/**
 * What the API surface knows about one named schema type: its kind, and the NAMES it carries.
 *
 * This is what makes "is there any call that hands me this field" answerable with no network, which is the
 * question `atlas slack-api --field` answers for Slack and which a root-field catalogue alone cannot.
 */
const linearTypeApiDetailSchema = z
  .object({
    description: z.string(),
    /** `OBJECT`, `INPUT_OBJECT`, `ENUM`, `INTERFACE`, `UNION`, `SCALAR` — the schema's own word. */
    typeKind: z.string().min(1),
    /** Field names on an object or interface, sorted. */
    fieldNames: z.array(z.string().min(1)),
    /** Input field names on an input object, sorted. */
    inputFieldNames: z.array(z.string().min(1)),
    /** Enum member names, sorted. */
    enumValues: z.array(z.string().min(1)),
    /** Field names the schema marks deprecated, sorted. A subset of `fieldNames`. */
    deprecatedFieldNames: z.array(z.string().min(1)),
  })
  .strict();

export type LinearTypeApiDetail = z.infer<typeof linearTypeApiDetailSchema>;

/**
 * What the browser surface saw one PAGE be: where it settled, what it was called, and how many GraphQL
 * calls it caused.
 *
 * The screenshot is not here — it is a {@link LinearSource} `artifacts` entry addressed by digest, because
 * the ruling is that the atlas HOLDS the picture rather than a link to one. `redirected` is the honest
 * denominator: a settings route this member may not open answers by moving the browser somewhere else, and
 * a walk that recorded the destination as a reached page would report coverage it never had.
 * @internal
 */
export const linearPageDetailSchema = z
  .object({
    /** How many `/graphql` responses this page caused while it was being driven. */
    graphqlCallCount: z.number().int().nonnegative(),
    /** Whether the browser settled somewhere other than the address asked for. */
    redirected: z.boolean(),
    /** The HTTP status the navigation reported, or `null` when the transport reported none. */
    statusCode: z.number().int().nullable(),
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
export type LinearPageDetail = z.infer<typeof linearPageDetailSchema>;

/**
 * What the API surface knows about one piece of configuration.
 *
 * `value` is the one place this atlas stores a provider VALUE rather than a name, and that is the kind's
 * whole purpose: "workspace and team settings, workflow states, integrations" is a question about values.
 * It is bounded by `settingSurfaces.ts`'s closed inventory, which names the root fields and the field paths a
 * configuration read may take — so a field Linear adds next month is dropped at the boundary rather than
 * stored because nobody thought to exclude it.
 */
const linearSettingApiDetailSchema = z
  .object({
    /** Which configuration group this belongs to — `organization`, `team`, `workflow-state`, and so on. */
    group: z.string().min(1),
    /** The human label this configuration carries in Linear's own words, or `""` when it has none. */
    label: z.string(),
    /** The scope this setting applies to: the workspace, or one team's key. */
    settingScope: z.string().min(1),
    /** The configuration itself, already reduced through the closed inventory's field allowlist. */
    value: z.unknown(),
  })
  .strict();

export type LinearSettingApiDetail = z.infer<typeof linearSettingApiDetailSchema>;

/** One channel's independent view of one entity. A successful look replaces only this channel's own detail. */
const linearChannelEntitySchema = z
  .object({
    channel: z.enum(LINEAR_ATLAS_CHANNELS),
    /** What this channel knows about this entity. Shape depends on the kind — see the detail schemas. */
    detail: z.unknown().nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: linearSourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

export type LinearChannelEntity = z.infer<typeof linearChannelEntitySchema>;

/** One tracked entity: a stable identity, plus whatever each channel independently knows about it. */
const linearAtlasEntitySchema = z
  .object({
    channels: z
      .object({ api: linearChannelEntitySchema.nullable(), browser: linearChannelEntitySchema.nullable() })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(LINEAR_ATLAS_KINDS),
    /** The provider's own key: a root field name, a type name, a route path, a configuration key. */
    providerId: z.string().min(1),
  })
  .strict();

export type LinearAtlasEntity = z.infer<typeof linearAtlasEntitySchema>;

/**
 * One coverage cell: what is known about one surface through one channel. `lastSuccessAt` and
 * `latestAttemptFailed` are the two freshness inputs `kit/freshness.ts` needs — one timestamp cannot answer
 * "is this still current" after a run that failed following one that succeeded.
 */
const linearCoverageCellSchema = z
  .object({
    artifacts: z.array(linearArtifactRefSchema),
    channel: z.enum(LINEAR_ATLAS_CHANNELS),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    /** What would unblock a `not-configured`/`unreadable` cell, when that is known. */
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.literal(LINEAR_ATLAS_VISIBILITY_SCOPE),
  })
  .strict();

export type LinearCoverageCell = z.infer<typeof linearCoverageCellSchema>;

/**
 * A gap, as stored. This atlas's own condition vocabulary plus kind — see `kit/gaps.ts`.
 *
 * `fields` and `surfaces` are stored rather than dropped: they are the entire content of an
 * `api-browser-disagreement`, which names WHICH keys one surface has and the other does not. A
 * disagreement gap without them says only that a disagreement happened, which is a notification rather
 * than a finding.
 */
const linearAtlasGapSchema = z
  .object({
    condition: z.string().min(1),
    /** Which names the two surfaces disagree about. Empty unless the condition is a disagreement. */
    fields: z.array(z.string().min(1)),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(LINEAR_ATLAS_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    /** Which surfaces this gap concerns. Two, for a disagreement; empty when surface-independent. */
    surfaces: z.array(z.enum(LINEAR_ATLAS_CHANNELS)),
  })
  .strict();

export type LinearAtlasGap = z.infer<typeof linearAtlasGapSchema>;

/** One kind's file on disk. */
export const linearAtlasKindFileSchema = z
  .object({
    coverage: z.array(linearCoverageCellSchema),
    entities: z.array(linearAtlasEntitySchema),
    gaps: z.array(linearAtlasGapSchema),
    kind: z.enum(LINEAR_ATLAS_KINDS),
    platform: z.literal(LINEAR_ATLAS_PLATFORM),
    schemaVersion: z.literal(LINEAR_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type LinearAtlasKindFile = z.infer<typeof linearAtlasKindFileSchema>;

/**
 * What is known about one kind's synchronisation history.
 * @internal
 */
export const linearAtlasKindStatusSchema = z
  .object({
    /**
     * A digest of the bytes published, so a later half-write is detectable rather than silent.
     * @internal
     */
    digest: z.string().min(1).nullable(),
    entityCount: z.number().int().nonnegative(),
    lastAttempt: z
      .object({ at: isoSchema, outcome: z.enum(["ok", "failed"]), reasons: z.array(z.string()) })
      .strict()
      .nullable(),
    lastSuccessAt: isoSchema.nullable(),
    // Absent on an older manifest, so nullish rather than required — see
    // `atlasPermissionBlockSchema` in the kit for why the field exists at all.
    permissionBlocked: atlasPermissionBlockSchema.nullish(),
  })
  .strict();

/** @internal */
export type LinearAtlasKindStatus = z.infer<typeof linearAtlasKindStatusSchema>;

/** The manifest: the authority on what has been published. Written last, because it names the others. */
export const linearAtlasManifestSchema = z
  .object({
    kinds: z.record(z.enum(LINEAR_ATLAS_KINDS), linearAtlasKindStatusSchema),
    platform: z.literal(LINEAR_ATLAS_PLATFORM),
    schemaVersion: z.literal(LINEAR_ATLAS_SCHEMA_VERSION),
    updatedAt: isoSchema,
    /**
     * The workspace this generation was read from, so a later sync against a different one is visible
     * rather than silently merged. It is an opaque provider id, never the workspace's own name.
     */
    workspaceId: z.string().min(1).nullable(),
  })
  .strict();

export type LinearAtlasManifest = z.infer<typeof linearAtlasManifestSchema>;

/**
 * A manifest with every kind present and never synced.
 *
 * @param updatedAt the ISO timestamp to stamp
 * @param workspaceId the workspace this generation belongs to, or `null` before one is known
 * @returns a valid, empty manifest
 */
export function initialLinearAtlasManifest({
  updatedAt,
  workspaceId = null,
}: {
  updatedAt: string;
  workspaceId?: string | null;
}): LinearAtlasManifest {
  const empty: LinearAtlasKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  return {
    kinds: { operation: empty, page: empty, setting: empty, type: empty },
    platform: LINEAR_ATLAS_PLATFORM,
    schemaVersion: LINEAR_ATLAS_SCHEMA_VERSION,
    updatedAt,
    workspaceId,
  };
}

/**
 * An empty kind file.
 *
 * @param kind the kind this file holds
 * @param updatedAt the ISO timestamp to stamp
 * @returns a valid, empty kind file
 */
export function emptyLinearAtlasKindFile({
  kind,
  updatedAt,
}: {
  kind: LinearAtlasKind;
  updatedAt: string;
}): LinearAtlasKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: LINEAR_ATLAS_PLATFORM,
    schemaVersion: LINEAR_ATLAS_SCHEMA_VERSION,
    updatedAt,
  };
}
