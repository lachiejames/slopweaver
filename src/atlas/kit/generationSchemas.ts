/**
 * The schema pieces every atlas's generation carries, built once and narrowed per platform.
 *
 * ## What is genuinely shared, and what is not
 *
 * A coverage cell, a gap, a kind's manifest status and the manifest envelope are the KIT's shape — they are
 * what `kit/store.ts`, `kit/coverage.ts` and `kit/gaps.ts` already operate on, and an atlas that spelled
 * them differently would not be readable through the generic verbs at all. What differs between platforms
 * is only which strings are admissible in three fields: the surface names, the gap conditions and the kind
 * names. So those are the parameters, and everything around them is built here.
 *
 * The DETAIL schemas are deliberately not here. What one channel knows about one entity is the platform's
 * own subject matter, and a factory that tried to generalise it would be generalising the thing each atlas
 * exists to say. The ENVELOPE around a detail is a different matter and IS here: a channelled atlas's
 * entity carries an opaque `detail` per channel by construction, so the wrapper generalises exactly because
 * it never looks inside.
 *
 * ## Why a factory rather than one shared schema object
 *
 * Zod enums are values, so a shared `coverageCellSchema` would have to widen `surface` to `z.string()` —
 * which would let a Slack surface name into a GitHub generation and be caught by nothing. Taking the enum
 * as an argument keeps each atlas's stored documents as strict as if it had written them out.
 */
import { z } from "zod";

import {
  ATLAS_COVERAGE_STATES,
  ATLAS_ENTITY_STATES,
  ATLAS_EVIDENCE_ROLES,
  type AtlasEntityState,
  atlasArtifactRefSchema,
} from "./contract.js";
import { atlasKindStatusSchema } from "./kindStatus.js";

const isoSchema = z.iso.datetime();

/** A closed enum schema over one platform's own literal strings. */
type LiteralEnum<TValue extends string> = z.ZodEnum<Record<TValue, TValue>>;

/**
 * The coverage-cell schema one platform gets back.
 *
 * Spelled out rather than inferred because every exported function here needs an explicit return type, and
 * an inferred Zod object type is not something a signature can carry. The shape is exactly the object
 * literal below it — if the two drift, the compiler says so at the `return`.
 */
type CoverageCellSchema<TSurface extends string> = z.ZodObject<{
  artifacts: z.ZodArray<typeof atlasArtifactRefSchema>;
  lastSuccessAt: z.ZodNullable<z.ZodISODateTime>;
  latestAttemptFailed: z.ZodBoolean;
  reason: z.ZodString;
  role: LiteralEnum<(typeof ATLAS_EVIDENCE_ROLES)[number]>;
  scope: z.ZodString;
  state: LiteralEnum<(typeof ATLAS_COVERAGE_STATES)[number]>;
  surface: LiteralEnum<TSurface>;
  unblockedBy: z.ZodNullable<z.ZodString>;
  visibilityScope: z.ZodString;
}>;

/** The gap schema one platform gets back. See {@link CoverageCellSchema} on why it is written out. */
type GapSchema<TCondition extends string, TKind extends string, TSurface extends string> = z.ZodObject<{
  condition: LiteralEnum<TCondition>;
  fields: z.ZodArray<z.ZodString>;
  firstDetectedAt: z.ZodISODateTime;
  id: z.ZodString;
  kind: z.ZodNullable<LiteralEnum<TKind>>;
  lastCheckedAt: z.ZodNullable<z.ZodISODateTime>;
  lastDetectedAt: z.ZodISODateTime;
  reason: z.ZodString;
  scope: z.ZodString;
  status: LiteralEnum<"open" | "closed">;
  surfaces: z.ZodArray<LiteralEnum<TSurface>>;
}>;

/** The manifest schema one platform gets back. See {@link CoverageCellSchema} on why it is written out. */
type ManifestSchema<TKind extends string, TVersion extends number> = z.ZodObject<{
  kinds: z.ZodRecord<LiteralEnum<TKind>, typeof kindStatusSchema>;
  schemaVersion: z.ZodLiteral<TVersion>;
  updatedAt: z.ZodISODateTime;
}>;

/**
 * One coverage cell, narrowed to a platform's own surfaces.
 *
 * @param surfaces the platform's surface names
 * @returns the strict cell schema
 */
export function coverageCellSchemaFor<TSurface extends string>({
  surfaces,
}: {
  surfaces: readonly [TSurface, ...TSurface[]];
}): CoverageCellSchema<TSurface> {
  return z
    .object({
      artifacts: z.array(atlasArtifactRefSchema),
      lastSuccessAt: isoSchema.nullable(),
      latestAttemptFailed: z.boolean(),
      reason: z.string().min(1),
      role: z.enum(ATLAS_EVIDENCE_ROLES),
      scope: z.string().min(1),
      state: z.enum(ATLAS_COVERAGE_STATES),
      surface: z.enum(surfaces),
      unblockedBy: z.string().min(1).nullable(),
      visibilityScope: z.string().min(1),
    })
    .strict();
}

/**
 * One gap, narrowed to a platform's own conditions, kinds and surfaces.
 *
 * @param conditions the platform's gap-condition vocabulary
 * @param kinds the platform's kind names
 * @param surfaces the platform's surface names
 * @returns the strict gap schema
 */
export function gapSchemaFor<TCondition extends string, TKind extends string, TSurface extends string>({
  conditions,
  kinds,
  surfaces,
}: {
  conditions: readonly [TCondition, ...TCondition[]];
  kinds: readonly [TKind, ...TKind[]];
  surfaces: readonly [TSurface, ...TSurface[]];
}): GapSchema<TCondition, TKind, TSurface> {
  return z
    .object({
      condition: z.enum(conditions),
      fields: z.array(z.string()),
      firstDetectedAt: isoSchema,
      id: z.string().min(1),
      kind: z.enum(kinds).nullable(),
      lastCheckedAt: isoSchema.nullable(),
      lastDetectedAt: isoSchema,
      reason: z.string().min(1),
      scope: z.string().min(1),
      status: z.enum(["open", "closed"]),
      surfaces: z.array(z.enum(surfaces)),
    })
    .strict();
}

/**
 * One kind's status in a manifest. Platform-independent: the kit grades every atlas the same way.
 *
 * The kit's own `atlasKindStatusSchema` rather than a copy of it. A copy had stood here and drifted on the
 * one field that matters most: it accepted an EMPTY digest, which no publish writes and which reads to the
 * store's grading as a kind whose bytes something vouches for.
 *
 * @internal
 */
export const kindStatusSchema = atlasKindStatusSchema;

/**
 * The manifest, narrowed to a platform's own kinds and schema version.
 *
 * @param kinds the platform's kind names
 * @param schemaVersion the version this build writes
 * @returns the strict manifest schema
 */
export function manifestSchemaFor<TKind extends string, TVersion extends number>({
  kinds,
  schemaVersion,
}: {
  kinds: readonly [TKind, ...TKind[]];
  schemaVersion: TVersion;
}): ManifestSchema<TKind, TVersion> {
  return z
    .object({
      kinds: z.record(z.enum(kinds), kindStatusSchema),
      schemaVersion: z.literal(schemaVersion),
      updatedAt: isoSchema,
    })
    .strict();
}

/** One channel's stored view. See {@link CoverageCellSchema} on why the shape is written out. */
type ChannelEntitySchema<TChannel extends string, TSource extends z.ZodType> = z.ZodObject<{
  channel: LiteralEnum<TChannel>;
  detail: z.ZodNullable<z.ZodUnknown>;
  firstSeenAt: z.ZodISODateTime;
  lastSeenAt: z.ZodISODateTime;
  source: z.ZodNullable<TSource>;
  state: LiteralEnum<AtlasEntityState>;
}>;

/**
 * One channel's independent view of one entity, narrowed to a platform's own channels and source shape.
 *
 * `detail` stays `unknown`, which is what makes this generalisable at all: the envelope is the same for
 * every channelled atlas precisely because it never looks inside the thing that differs.
 *
 * @param channels the platform's channel names
 * @param source the platform's own provenance schema
 * @returns the strict channel-view schema
 *
 * @internal
 */
export function channelEntitySchemaFor<TChannel extends string, TSource extends z.ZodType>({
  channels,
  source,
}: {
  channels: readonly [TChannel, ...TChannel[]];
  source: TSource;
}): ChannelEntitySchema<TChannel, TSource> {
  return z
    .object({
      channel: z.enum(channels),
      detail: z.unknown().nullable(),
      firstSeenAt: isoSchema,
      lastSeenAt: isoSchema,
      source: source.nullable(),
      state: z.enum(ATLAS_ENTITY_STATES),
    })
    .strict();
}

/** One kind's file. See {@link CoverageCellSchema} on why the shape is written out. */
type KindFileSchema<
  TKind extends string,
  TPlatform extends string,
  TVersion extends number,
  TCell extends z.ZodType,
  TEntity extends z.ZodType,
  TGap extends z.ZodType,
> = z.ZodObject<{
  coverage: z.ZodArray<TCell>;
  entities: z.ZodArray<TEntity>;
  gaps: z.ZodArray<TGap>;
  kind: LiteralEnum<TKind>;
  platform: z.ZodLiteral<TPlatform>;
  schemaVersion: z.ZodLiteral<TVersion>;
  updatedAt: z.ZodISODateTime;
}>;

/**
 * One kind's file on disk, narrowed to a platform's own kinds, cell, entity and gap schemas.
 *
 * @param kinds the platform's kind names
 * @param platform the platform discriminator every document carries
 * @param schemaVersion the version this build writes
 * @param cell the platform's coverage-cell schema
 * @param entity the platform's entity schema
 * @param gap the platform's gap schema
 * @returns the strict kind-file schema
 *
 * @internal
 */
export function kindFileSchemaFor<
  TKind extends string,
  TPlatform extends string,
  TVersion extends number,
  TCell extends z.ZodType,
  TEntity extends z.ZodType,
  TGap extends z.ZodType,
>({
  kinds,
  platform,
  schemaVersion,
  cell,
  entity,
  gap,
}: {
  kinds: readonly [TKind, ...TKind[]];
  platform: TPlatform;
  schemaVersion: TVersion;
  cell: TCell;
  entity: TEntity;
  gap: TGap;
}): KindFileSchema<TKind, TPlatform, TVersion, TCell, TEntity, TGap> {
  return z
    .object({
      coverage: z.array(cell),
      entities: z.array(entity),
      gaps: z.array(gap),
      kind: z.enum(kinds),
      platform: z.literal(platform),
      schemaVersion: z.literal(schemaVersion),
      updatedAt: isoSchema,
    })
    .strict();
}

/**
 * What a browser walk saw against what it kept, as a walking atlas stores it.
 *
 * The runtime shape is `browser/pageTransport.ts`'s `ResponseAccounting` and this is its stored mirror, so
 * the two live apart on purpose — one is a transport contract and one is a document schema. What makes it
 * kit-level rather than each walking atlas's is that neither half has any platform in it: the counts mean
 * the same thing on every platform, which is the whole reason a reader can compare them across atlases.
 *
 * @internal
 */
export const responseAccountingSchema = z
  .object({
    bodyFailed: z.number().int().nonnegative(),
    bodySucceeded: z.number().int().nonnegative(),
    eligible: z.number().int().nonnegative(),
    seen: z.number().int().nonnegative(),
  })
  .strict();

/**
 * The whole family, grouped, so an atlas imports one name rather than seven.
 *
 * The same shape this repository already uses for its typed error factories (`GithubFetchErrors` and its
 * siblings): a family that is always reached together reads better as one object, and a call site says
 * which family a schema came from without a reader tracing the import. The individual exports stay for a
 * caller that genuinely needs one — `github/kindFiles.ts` is that caller.
 *
 * @internal
 */
export const generationSchemas = {
  channelEntityFor: channelEntitySchemaFor,
  coverageCellFor: coverageCellSchemaFor,
  gapFor: gapSchemaFor,
  kindFileFor: kindFileSchemaFor,
  kindStatus: kindStatusSchema,
  manifestFor: manifestSchemaFor,
  responseAccounting: responseAccountingSchema,
} as const;
