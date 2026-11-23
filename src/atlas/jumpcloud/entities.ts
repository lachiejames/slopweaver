/**
 * The strict on-disk shape of every JumpCloud entity, and the manifest that grades a generation.
 *
 * ## `detail` is the provider's own document, and that is the ruling rather than a shortcut
 *
 * The sibling CrowdStrike atlas declares a field-by-field schema per kind. This one deliberately does not:
 * the owner ruled every family in full — _"basically every API response in every attribute"_ — over 74
 * kinds and 488 admitted operations, so a hand-written field list would be a second, smaller definition of
 * what the atlas holds, and the first thing to go stale. What keeps a field out is `projection.ts`'s named
 * denial and `sensitivity.ts`'s refusal, both of which act on the bytes rather than on a type. So `detail`
 * is the projected provider document, and the boundary that protects it is the one that ran over it.
 *
 * ## Two channels, independent, never merged into one detail
 *
 * `directory-api` and `admin-console` are the descriptor's own two surfaces. Each holds its own view, so a
 * successful API read never erases what a browser walk knew and the reverse. A channel that has never
 * looked is `null`, which is a different fact from a channel that looked and saw nothing — `kit/read.ts`
 * turns the first into no observation at all, which is the whole two-surface design.
 *
 * ## A kind file carries its own READ EPOCH
 *
 * A long sync has no single point in time: a full walk makes one request per fan-out call over every parent
 * id, so a parent list read as the walk began and a fan-out finished as it ended describe a state that never
 * existed at any one instant. Publishing both under one `updatedAt` makes ordinary change during acquisition look like
 * cross-surface disagreement, which poisons the corroboration report this atlas exists to produce. So each
 * kind records the interval its own read occupied, and a comparison whose two operands straddle one is
 * reported as temporally incomparable rather than as a disagreement.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import { ATLAS_COVERAGE_STATES, ATLAS_EVIDENCE_ROLES, atlasArtifactRefSchema } from "../kit/contract.js";

import { atlasPermissionBlockSchema } from "../kit/permissionBlock.js";
import { atlasProductAbsenceSchema } from "../kit/productAbsence.js";
import { JumpcloudAtlasErrors, jumpcloudAtlasErrorLines } from "./atlasErrors.js";
import {
  JUMPCLOUD_ATLAS_PLATFORM,
  JUMPCLOUD_GAP_CONDITIONS,
  JUMPCLOUD_KINDS,
  JUMPCLOUD_SCHEMA_VERSION,
  JUMPCLOUD_SURFACE_NAMES,
  type JumpcloudKind,
} from "./model.js";

const isoSchema = z.iso.datetime();

/**
 * Where one observation came from.
 *
 * The kit's `atlasSourceSchema` narrowed to this platform's surface names, so a record cannot claim a
 * surface the descriptor does not declare.
 * @internal
 */
export const jumpcloudSourceSchema = z
  .object({
    artifacts: z.array(atlasArtifactRefSchema),
    deepLink: z.url().nullable(),
    deepLinkStatus: z.enum(["provider-provided", "browser-discovered", "unverified", "unavailable"]),
    /** The bound path this came from — the reproduction handle, and never a constructed console URL. */
    endpoint: z.string().min(1),
    observedAt: isoSchema,
    surface: z.enum(JUMPCLOUD_SURFACE_NAMES),
  })
  .strict();

/** @internal */
export type JumpcloudSource = z.infer<typeof jumpcloudSourceSchema>;

/** One channel's independent view of one entity. */
const jumpcloudChannelEntitySchema = z
  .object({
    /** The projected provider document — every attribute except the ones the boundary denied. */
    detail: z.unknown().nullable(),
    firstSeenAt: isoSchema,
    lastSeenAt: isoSchema,
    source: jumpcloudSourceSchema.nullable(),
    state: z.enum(["observed", "stale"]),
  })
  .strict();

export type JumpcloudChannelEntity = z.infer<typeof jumpcloudChannelEntitySchema>;

/** One tracked entity: a stable identity, plus whatever each surface independently knows about it. */
const jumpcloudEntitySchema = z
  .object({
    channels: z
      .object({
        "admin-console": jumpcloudChannelEntitySchema.nullable(),
        "directory-api": jumpcloudChannelEntitySchema.nullable(),
      })
      .strict(),
    id: z.string().min(1),
    kind: z.enum(JUMPCLOUD_KINDS),
    providerId: z.string().min(1),
  })
  .strict();

export type JumpcloudEntity = z.infer<typeof jumpcloudEntitySchema>;

/** One coverage cell, as this atlas stores it — the kit's shape, narrowed to this platform's surfaces. */
const jumpcloudCoverageCellSchema = z
  .object({
    artifacts: z.array(atlasArtifactRefSchema),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.string().min(1),
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.string().min(1),
  })
  .strict();

export type JumpcloudCoverageCell = z.infer<typeof jumpcloudCoverageCellSchema>;

/** One gap, as this atlas stores it. */
export const jumpcloudGapSchema = z
  .object({
    condition: z.enum(JUMPCLOUD_GAP_CONDITIONS),
    fields: z.array(z.string()),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(JUMPCLOUD_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    surfaces: z.array(z.string().min(1)),
  })
  .strict();

export type JumpcloudGap = z.infer<typeof jumpcloudGapSchema>;

/**
 * The interval one kind's read actually occupied.
 *
 * Two instants rather than one, because "when was this read" has no single answer for a family whose
 * fan-out spans a stretch of the walk rather than a moment. See this file's header on what a single timestamp costs.
 * @internal
 */
export const jumpcloudReadEpochSchema = z.object({ endedAt: isoSchema, startedAt: isoSchema }).strict();

/** @internal */
export type JumpcloudReadEpoch = z.infer<typeof jumpcloudReadEpochSchema>;

/** One kind's file on disk. */
export const jumpcloudKindFileSchema = z
  .object({
    coverage: z.array(jumpcloudCoverageCellSchema),
    entities: z.array(jumpcloudEntitySchema),
    gaps: z.array(jumpcloudGapSchema),
    kind: z.enum(JUMPCLOUD_KINDS),
    platform: z.literal(JUMPCLOUD_ATLAS_PLATFORM),
    /** The interval this kind's own read occupied, or `null` when it has never been read. */
    readEpoch: jumpcloudReadEpochSchema.nullable(),
    schemaVersion: z.literal(JUMPCLOUD_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type JumpcloudKindFile = z.infer<typeof jumpcloudKindFileSchema>;

/** What is known about one kind's synchronisation history. */
const jumpcloudKindStatusSchema = z
  .object({
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
    // Absent on older manifests — see `kit/productAbsence.ts`.
    productAbsent: atlasProductAbsenceSchema.nullish(),
  })
  .strict();

export type JumpcloudKindStatus = z.infer<typeof jumpcloudKindStatusSchema>;

/** The manifest, written last, that grades every kind file beside it. */
export const jumpcloudManifestSchema = z
  .object({
    kinds: z.record(z.enum(JUMPCLOUD_KINDS), jumpcloudKindStatusSchema),
    platform: z.literal(JUMPCLOUD_ATLAS_PLATFORM),
    schemaVersion: z.literal(JUMPCLOUD_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type JumpcloudManifest = z.infer<typeof jumpcloudManifestSchema>;

/**
 * An empty file for one kind — the shape a reset installs and a first sync folds onto.
 *
 * @param kind the kind to build an empty file for
 * @param updatedAt this run's ISO timestamp
 * @returns the empty file, valid against {@link jumpcloudKindFileSchema}
 */
export function emptyJumpcloudKindFile({
  kind,
  updatedAt,
}: {
  kind: JumpcloudKind;
  updatedAt: string;
}): JumpcloudKindFile {
  return {
    coverage: [],
    entities: [],
    gaps: [],
    kind,
    platform: JUMPCLOUD_ATLAS_PLATFORM,
    readEpoch: null,
    schemaVersion: JUMPCLOUD_SCHEMA_VERSION,
    updatedAt,
  };
}

/**
 * Assemble one kind's file from its parts, refusing a document the store could not hold.
 *
 * The parse is the point rather than a formality: an entity whose `kind` does not match the file it is
 * being written into fails HERE, rather than being written and read back forever as the wrong kind.
 *
 * @param kind the kind this file is for
 * @param entities the merged entity list
 * @param coverage the kind's coverage cells after this run
 * @param gaps the kind's gaps after this run
 * @param readEpoch the interval this kind's read occupied, or `null` when it was not read this run
 * @param at this run's ISO timestamp
 * @returns the file, or why the assembled document is not storable
 */
export function assembleJumpcloudKindFile({
  kind,
  entities,
  coverage,
  gaps,
  readEpoch,
  at,
}: {
  kind: JumpcloudKind;
  entities: readonly JumpcloudEntity[];
  coverage: readonly JumpcloudCoverageCell[];
  gaps: readonly JumpcloudGap[];
  readEpoch: JumpcloudReadEpoch | null;
  at: string;
}): Result<JumpcloudKindFile> {
  const misfiled = entities.filter((entity) => entity.kind !== kind).map((entity) => entity.id);
  if (misfiled.length > 0) {
    return err(jumpcloudAtlasErrorLines({ error: JumpcloudAtlasErrors.kindMisfiled({ kind, misfiled }) }));
  }
  const parsed = jumpcloudKindFileSchema.safeParse({
    coverage,
    entities,
    gaps,
    kind,
    platform: JUMPCLOUD_ATLAS_PLATFORM,
    readEpoch,
    schemaVersion: JUMPCLOUD_SCHEMA_VERSION,
    updatedAt: at,
  });
  if (parsed.success) {
    return ok(parsed.data);
  }
  return err(
    parsed.error.issues
      .slice(0, 6)
      .map(
        (issue) =>
          `the ${kind} file this run assembled is not storable — ${issue.path.map(String).join(".")}: ${issue.message}`,
      ),
  );
}

/**
 * A manifest grading every kind as never attempted.
 *
 * @param updatedAt this run's ISO timestamp
 * @returns the initial manifest
 */
export function initialJumpcloudManifest({ updatedAt }: { updatedAt: string }): JumpcloudManifest {
  const empty: JumpcloudKindStatus = { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null };
  const entries = JUMPCLOUD_KINDS.map((kind) => [kind, empty] as const);
  // `as`: built from the platform's own exhaustive kind list, which `Object.fromEntries` widens to string.
  // oxlint-disable-next-line no-unsafe-type-assertion
  const kinds = Object.fromEntries(entries) as JumpcloudManifest["kinds"];
  return { kinds, platform: JUMPCLOUD_ATLAS_PLATFORM, schemaVersion: JUMPCLOUD_SCHEMA_VERSION, updatedAt };
}
