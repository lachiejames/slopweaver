/**
 * The stored vocabulary every two-channel atlas has: an entity with one slot per channel, a coverage cell,
 * a gap, a kind file and a manifest.
 *
 * ## Why a factory rather than a fixed set of schemas
 *
 * Each atlas's channel names, kind names, platform literal, schema version and visibility scopes are its
 * own, and a shared schema that erased them would let a Twilio generation validate as a Hex one — which
 * is exactly the confusion `kit/contract.ts` makes one PLATFORM per atlas a type to prevent. So this takes
 * those five as inputs and returns schemas specialised to them. What is shared is the SHAPE, which had been
 * written out twice in full and is where the drift between two atlases would otherwise start.
 *
 * ## The shape is load-bearing, not incidental
 *
 * Three of its decisions are the two-surface ruling written down, and a platform must not un-decide them by
 * hand-rolling its own copy:
 *
 * - **One slot per channel, each independently `null`.** A channel that has never looked contributes
 *   NOTHING rather than an observation claiming it looked and found nothing.
 * - **`deepLink` is nullable and `deepLinkStatus` is not.** An absent link has to say WHY, so "the provider
 *   offers none" is distinguishable from "nobody has looked".
 * - **A coverage cell carries `lastSuccessAt` AND `latestAttemptFailed`.** One timestamp cannot answer "is
 *   this still current" after a run that failed following one that succeeded.
 *
 * What each atlas still writes for itself is the DETAIL shapes — what it knows about an API, a method, a
 * page, a record — because those are the platform, and its own prose about why its channels mean what they
 * mean.
 */
import { z } from "zod";

import {
  ATLAS_COVERAGE_STATES,
  ATLAS_ENTITY_STATES,
  ATLAS_EVIDENCE_ROLES,
  atlasArtifactRefSchema,
  atlasSourceSchema,
} from "./contract.js";
import { atlasPermissionBlockSchema } from "./permissionBlock.js";
import { atlasProductAbsenceSchema } from "./productAbsence.js";

/**
 * What one atlas tells this factory about itself.
 * @internal
 */
export interface ChannelSchemaSpec<
  TChannel extends string,
  TKind extends string,
  TScope extends string,
  TPlatform extends string,
  TVersion extends number,
> {
  readonly channels: readonly [TChannel, TChannel, ...TChannel[]];
  /**
   * One slot per channel, spelled out by the atlas rather than assembled here.
   *
   * The atlas knows its channel names as literals and this factory only knows a tuple, so building the
   * shape here would need a type assertion to recover the exact keys — and the full lane's
   * `no-unsafe-type-assertion` is right to refuse one. Six words at the call site buys an exact,
   * assertion-free type, and the REQUIREDNESS is the point: a record would make every key optional, so an
   * entity that simply omitted a channel would validate and read back as one whose channel never looked.
   */
  readonly channelSlots: (input: {
    channelEntity: ReturnType<typeof buildChannelEntity<TChannel>>;
  }) => z.ZodObject<Record<TChannel, z.ZodNullable<ReturnType<typeof buildChannelEntity<TChannel>>>>>;
  readonly kinds: readonly [TKind, TKind, ...TKind[]];
  /** One status per kind, spelled out by the atlas for the same reason as {@link channelSlots}. */
  readonly manifestKinds: (input: {
    kindStatus: ReturnType<typeof buildKindStatus>;
  }) => z.ZodObject<Record<TKind, ReturnType<typeof buildKindStatus>>>;
  readonly platform: TPlatform;
  readonly schemaVersion: TVersion;
  readonly visibilityScopes: readonly [TScope, TScope, ...TScope[]];
}

/** Every ISO instant in a generation is validated the same way. */
const isoSchema = z.iso.datetime();

/**
 * Where a record came from, through one channel — the kit's own source with `surface` renamed to `channel`,
 * matching the entity shape a reader greps beside it.
 */
function buildSource<TChannel extends string>({ channels }: { channels: readonly [TChannel, ...TChannel[]] }) {
  return atlasSourceSchema
    .omit({ surface: true })
    .extend({ channel: z.enum(channels) })
    .strict();
}

/** One channel's independent view of one entity. */
function buildChannelEntity<TChannel extends string>({ channels }: { channels: readonly [TChannel, ...TChannel[]] }) {
  return z
    .object({
      channel: z.enum(channels),
      detail: z.unknown().nullable(),
      firstSeenAt: isoSchema,
      lastSeenAt: isoSchema,
      source: buildSource({ channels }).nullable(),
      state: z.enum(ATLAS_ENTITY_STATES),
    })
    .strict();
}

/**
 * What is known about one surface through one channel.
 *
 * `lastSuccessAt` and `latestAttemptFailed` are both here because one timestamp cannot answer "is this
 * still current" after a run that failed following one that succeeded.
 */
function buildCoverageCell<TChannel extends string, TScope extends string>({
  channels,
  visibilityScopes,
}: {
  channels: readonly [TChannel, ...TChannel[]];
  visibilityScopes: readonly [TScope, ...TScope[]];
}) {
  return z
    .object({
      artifacts: z.array(atlasArtifactRefSchema),
      channel: z.enum(channels),
      lastSuccessAt: isoSchema.nullable(),
      latestAttemptFailed: z.boolean(),
      reason: z.string().min(1),
      role: z.enum(ATLAS_EVIDENCE_ROLES),
      scope: z.string().min(1),
      state: z.enum(ATLAS_COVERAGE_STATES),
      surface: z.string().min(1),
      unblockedBy: z.string().min(1).nullable(),
      visibilityScope: z.enum(visibilityScopes),
    })
    .strict();
}

/** A gap, as stored: this atlas's condition vocabulary plus its kind and channels. */
function buildGap<TChannel extends string, TKind extends string>({
  channels,
  kinds,
}: {
  channels: readonly [TChannel, ...TChannel[]];
  kinds: readonly [TKind, ...TKind[]];
}) {
  return z
    .object({
      condition: z.string().min(1),
      fields: z.array(z.string().min(1)),
      firstDetectedAt: isoSchema,
      id: z.string().min(1),
      kind: z.enum(kinds).nullable(),
      lastCheckedAt: isoSchema.nullable(),
      lastDetectedAt: isoSchema,
      reason: z.string().min(1),
      scope: z.string().min(1),
      status: z.enum(["open", "closed"]),
      surfaces: z.array(z.enum(channels)),
    })
    .strict();
}

/**
 * What a browser walk saw one declared PAGE be: whether it was reached, what it settled on, and how much of
 * its own traffic the walk actually accounted for.
 *
 * Shared because none of it is a platform's — it is what visiting a page yields — and because two fields are
 * the honesty of a walk rather than decoration. `responseAccounting` makes a lost response body a NUMBER
 * rather than a silence: a page still has its screenshot, status and title, so a walk that silently dropped
 * two of twelve captures looks identical to one that kept them all. And `unreachableBecause` is what makes a
 * declared page that redirected a recorded row rather than an absence.
 *
 * The screenshot is deliberately NOT here — it is a source ARTIFACT, addressed by digest, because the ruling
 * is that the atlas holds the picture rather than a link to one.
 */
function buildPageDetail() {
  return z
    .object({
      callCount: z.number().int().nonnegative(),
      captureComplete: z.boolean(),
      finalUrl: z.string().min(1),
      redirected: z.boolean(),
      responseAccounting: z
        .object({
          bodyFailed: z.number().int().nonnegative(),
          bodySucceeded: z.number().int().nonnegative(),
          eligible: z.number().int().nonnegative(),
          seen: z.number().int().nonnegative(),
        })
        .strict(),
      screenshotMissingBecause: z.string().min(1).nullable(),
      statusCode: z.number().int().nullable(),
      title: z.string().nullable(),
      unreachableBecause: z.string().min(1).nullable(),
    })
    .strict();
}

/** What is known about one kind's synchronisation history. */
function buildKindStatus() {
  return z
    .object({
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
      // Absent on every manifest written before the field existed — see `kit/productAbsence.ts`.
      productAbsent: atlasProductAbsenceSchema.nullish(),
    })
    .strict();
}

/** One tracked entity: a stable identity, plus whatever each channel independently knows about it. */
function buildEntity<TChannel extends string, TKind extends string>({
  channels,
  kinds,
  channelSlots,
}: {
  channels: readonly [TChannel, ...TChannel[]];
  kinds: readonly [TKind, ...TKind[]];
  channelSlots: (input: {
    channelEntity: ReturnType<typeof buildChannelEntity<TChannel>>;
  }) => z.ZodObject<Record<TChannel, z.ZodNullable<ReturnType<typeof buildChannelEntity<TChannel>>>>>;
}) {
  return z
    .object({
      channels: channelSlots({ channelEntity: buildChannelEntity({ channels }) }),
      id: z.string().min(1),
      kind: z.enum(kinds),
      providerId: z.string().min(1),
    })
    .strict();
}

/** One kind's file on disk. */
function buildKindFile<
  TChannel extends string,
  TKind extends string,
  TScope extends string,
  TPlatform extends string,
  TVersion extends number,
>(spec: ChannelSchemaSpec<TChannel, TKind, TScope, TPlatform, TVersion>) {
  return z
    .object({
      coverage: z.array(buildCoverageCell(spec)),
      entities: z.array(buildEntity(spec)),
      gaps: z.array(buildGap(spec)),
      kind: z.enum(spec.kinds),
      platform: z.literal(spec.platform),
      schemaVersion: z.literal(spec.schemaVersion),
      updatedAt: isoSchema,
    })
    .strict();
}

/** The manifest: the authority on what has been published. Written last, because it names the others. */
function buildManifest<TKind extends string, TPlatform extends string, TVersion extends number>({
  manifestKinds,
  platform,
  schemaVersion,
}: {
  manifestKinds: (input: {
    kindStatus: ReturnType<typeof buildKindStatus>;
  }) => z.ZodObject<Record<TKind, ReturnType<typeof buildKindStatus>>>;
  platform: TPlatform;
  schemaVersion: TVersion;
}) {
  return z
    .object({
      kinds: manifestKinds({ kindStatus: buildKindStatus() }),
      platform: z.literal(platform),
      schemaVersion: z.literal(schemaVersion),
      updatedAt: isoSchema,
    })
    .strict();
}

/**
 * The stored schemas one two-channel atlas needs, specialised to its own vocabulary.
 * @internal
 */
export interface ChannelSchemas<
  TChannel extends string,
  TKind extends string,
  TScope extends string,
  TPlatform extends string,
  TVersion extends number,
> {
  readonly channelEntity: ReturnType<typeof buildChannelEntity<TChannel>>;
  readonly coverageCell: ReturnType<typeof buildCoverageCell<TChannel, TScope>>;
  readonly entity: ReturnType<typeof buildEntity<TChannel, TKind>>;
  readonly gap: ReturnType<typeof buildGap<TChannel, TKind>>;
  readonly kindFile: ReturnType<typeof buildKindFile<TChannel, TKind, TScope, TPlatform, TVersion>>;
  readonly kindStatus: ReturnType<typeof buildKindStatus>;
  readonly manifest: ReturnType<typeof buildManifest<TKind, TPlatform, TVersion>>;
  readonly pageDetail: ReturnType<typeof buildPageDetail>;
  readonly source: ReturnType<typeof buildSource<TChannel>>;
  /**
   * An empty file for one kind.
   *
   * @param kind the kind this file holds
   * @param updatedAt the ISO timestamp to stamp
   * @returns a valid, empty kind file
   */
  readonly emptyKindFile: (input: {
    kind: TKind;
    updatedAt: string;
  }) => z.infer<ReturnType<typeof buildKindFile<TChannel, TKind, TScope, TPlatform, TVersion>>>;
  /**
   * A manifest with every kind present and never synced.
   *
   * Here rather than in each atlas because "complete rather than partial" is the property, not the literal:
   * a manifest missing a kind reads to `store.ts`'s grading as a half-written generation, so the builder
   * enumerates the kind constant rather than a hand-written object somebody can fall behind.
   *
   * @param updatedAt the ISO timestamp to stamp
   * @returns a valid, empty manifest
   */
  readonly initialManifest: (input: {
    updatedAt: string;
  }) => z.infer<ReturnType<typeof buildManifest<TKind, TPlatform, TVersion>>>;
}

/**
 * Build the stored schemas one two-channel atlas needs.
 *
 * @param spec this atlas's own channels, kinds, platform literal, schema version and visibility scopes
 * @returns the schemas, specialised to it
 */
export function channelSchemas<
  TChannel extends string,
  TKind extends string,
  TScope extends string,
  TPlatform extends string,
  TVersion extends number,
>(
  spec: ChannelSchemaSpec<TChannel, TKind, TScope, TPlatform, TVersion>,
): ChannelSchemas<TChannel, TKind, TScope, TPlatform, TVersion> {
  const kindFile = buildKindFile(spec);
  const manifest = buildManifest(spec);
  return {
    channelEntity: buildChannelEntity(spec),
    coverageCell: buildCoverageCell(spec),
    emptyKindFile: ({ kind, updatedAt }) =>
      kindFile.parse({
        coverage: [],
        entities: [],
        gaps: [],
        kind,
        platform: spec.platform,
        schemaVersion: spec.schemaVersion,
        updatedAt,
      }),
    entity: buildEntity(spec),
    gap: buildGap(spec),
    initialManifest: ({ updatedAt }) =>
      manifest.parse({
        kinds: Object.fromEntries(
          spec.kinds.map((kind) => [kind, { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null }]),
        ),
        platform: spec.platform,
        schemaVersion: spec.schemaVersion,
        updatedAt,
      }),
    kindFile,
    kindStatus: buildKindStatus(),
    manifest,
    pageDetail: buildPageDetail(),
    source: buildSource(spec),
  };
}
