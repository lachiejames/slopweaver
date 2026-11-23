/**
 * The strict on-disk shape of every Aether entity, and the manifest that grades a generation.
 *
 * ## Strict, so a portal field nobody reviewed cannot arrive by accident
 *
 * Every schema here is `.strict()`. A field the portal adds next month is not stored because a reduction
 * chose it, and it is not stored because nobody excluded it — it fails to parse, loudly, and somebody
 * decides. The reduction (`reduction.ts`) maps a captured response body onto exactly these fields; the
 * portal's own richer JSON is the reduction's input, never this atlas's store.
 *
 * ## What is deliberately absent from a finding's record
 *
 * A pentest finding's full write-up — its proof-of-concept steps, request/response transcripts and exploit
 * payloads — is the tester's authored evidence and can carry a live exploit for a staging system that is
 * still up. This atlas holds the finding's IDENTITY and TRIAGE fields — code, title, severity, state, its
 * project, when it was reported and last updated — which is what answers "what did the pentest find and what
 * is still open". The step-by-step reproduction is `descriptor.ts`'s `excludes` (`payload-not-map`), not a
 * field here.
 *
 * ## Every entity carries where it came from, and whether it was seen this run
 *
 * `source` is the kit's own `AtlasSource`, so each record says which surface produced it, at which page,
 * when, and what a human would open to see it. A record without provenance is not an atlas record. `state`
 * is `observed` here on every stored entity: a walk is a complete read that fully replaces the store
 * (`surface.ts`), so there is no partial read that could leave a `stale` record behind.
 */
import { z } from "zod";

import { err, ok, type Result } from "../../lib/result.js";
import {
  ATLAS_COVERAGE_STATES,
  ATLAS_EVIDENCE_ROLES,
  atlasArtifactRefSchema,
  atlasSourceSchema,
} from "../kit/contract.js";
import { atlasKindStatusSchema } from "../kit/kindStatus.js";

import {
  AETHER_FINDING_STATES,
  AETHER_GAP_CONDITIONS,
  AETHER_KINDS,
  AETHER_SCHEMA_VERSION,
  AETHER_SEVERITIES,
  AETHER_SURFACES,
} from "./model.js";

const isoSchema = z.iso.datetime();

/** Whether this run's complete read still returned the entity. See this file's header. */
const entityStateSchema = z.enum(["observed", "stale"]);

/** Fields every stored entity carries, whatever kind it is. */
const baseEntitySchema = z.object({
  /** When this entity was first observed by any walk, so age survives a re-walk. */
  firstSeenAt: isoSchema,
  /** The kit's stable, derived entity id — never the portal's own id. */
  id: z.string().min(1),
  /** Aether's own id, kept as a field so a human can paste it into the portal URL. */
  providerId: z.string().min(1),
  source: atlasSourceSchema,
  state: entityStateSchema,
});

/**
 * One engagement — a project the portal groups its findings under.
 *
 * Reduced from `/api/findings/stats`'s `sources` array, so `providerId` is the source uuid and `name` is the
 * project's own name (e.g. `Application Suite`). The severity and status tallies the same endpoint returns
 * are kept so a reader can tell a complete finding read (stored findings match the open tally) from a
 * partial one.
 */
const aetherProjectSchema = baseEntitySchema
  .extend({
    name: z.string().min(1),
    /** How many open findings the portal's own stats endpoint reported for this project, or `null`. */
    openFindingCount: z.number().int().nonnegative().nullable(),
  })
  .strict();

export type AetherProject = z.infer<typeof aetherProjectSchema>;

/**
 * One pentest finding — the entity this atlas exists to answer questions about.
 *
 * `code` is Aether's human-facing identifier (`AETHER-APP-127`) and is the handle a reader quotes; `providerId`
 * is the portal's own internal numeric id. `severity` and `findingState` are the portal's own closed
 * vocabularies (`model.ts`); `findingState` is taken from the `tab` the finding was read under, since the
 * `/api/findings` list is fetched one lifecycle tab at a time.
 */
const aetherFindingSchema = baseEntitySchema
  .extend({
    /** Aether's human-facing finding code, e.g. `AETHER-APP-127`. */
    code: z.string().min(1),
    findingState: z.enum(AETHER_FINDING_STATES),
    /** The project the portal attributes the finding to, e.g. `Application Suite`. */
    projectName: z.string().nullable(),
    reportedAt: isoSchema.nullable(),
    severity: z.enum(AETHER_SEVERITIES),
    /** How the finding was sourced, in the portal's own word, e.g. `report`. */
    sourceType: z.string().nullable(),
    title: z.string().min(1),
    updatedAt: isoSchema.nullable(),
  })
  .strict();

export type AetherFinding = z.infer<typeof aetherFindingSchema>;

/**
 * One route the browser walk rendered — the surface map, not a domain entity.
 *
 * Its `source.artifacts` carries the proof screenshot when one survived the unrendered-frame grade.
 * `responseCount` is how many first-party responses the page produced, so a reader can tell a page that
 * loaded its data (many responses) from one that rendered a shell and fetched nothing.
 */
const aetherPageSchema = baseEntitySchema
  .extend({
    finalUrl: z.string().min(1),
    rendered: z.boolean(),
    responseCount: z.number().int().nonnegative(),
    route: z.string().min(1),
    title: z.string(),
  })
  .strict();

export type AetherPage = z.infer<typeof aetherPageSchema>;

/** One coverage cell, as this atlas stores it. */
const aetherCoverageCellSchema = z
  .object({
    artifacts: z.array(atlasArtifactRefSchema),
    lastSuccessAt: isoSchema.nullable(),
    latestAttemptFailed: z.boolean(),
    reason: z.string().min(1),
    role: z.enum(ATLAS_EVIDENCE_ROLES),
    scope: z.string().min(1),
    state: z.enum(ATLAS_COVERAGE_STATES),
    surface: z.enum(AETHER_SURFACES),
    unblockedBy: z.string().min(1).nullable(),
    visibilityScope: z.string().min(1),
  })
  .strict();

export type AetherCoverageCell = z.infer<typeof aetherCoverageCellSchema>;

/** One gap, as this atlas stores it. */
const aetherGapSchema = z
  .object({
    condition: z.enum(AETHER_GAP_CONDITIONS),
    fields: z.array(z.string()),
    firstDetectedAt: isoSchema,
    id: z.string().min(1),
    kind: z.enum(AETHER_KINDS).nullable(),
    lastCheckedAt: isoSchema.nullable(),
    lastDetectedAt: isoSchema,
    reason: z.string().min(1),
    scope: z.string().min(1),
    status: z.enum(["open", "closed"]),
    surfaces: z.array(z.enum(AETHER_SURFACES)),
  })
  .strict();

export type AetherGap = z.infer<typeof aetherGapSchema>;

/** What every kind file carries besides its own entities. */
const kindFileEnvelope = {
  coverage: z.array(aetherCoverageCellSchema),
  gaps: z.array(aetherGapSchema),
  schemaVersion: z.literal(AETHER_SCHEMA_VERSION),
  updatedAt: isoSchema,
};

/**
 * One kind file on disk, discriminated by its own kind.
 *
 * A union rather than one loose shape, so a findings file cannot hold a target and a mis-routed reduction
 * fails to publish rather than writing a plausible-looking lie. The five arms are written out rather than
 * generated from a helper over `kindFileEnvelope`, because `kind: z.literal(someTypeParameter)` widens every
 * arm's discriminant to `kind: string` and costs the union its narrowing — the same reason the CrowdStrike
 * atlas writes its own out.
 */
export const aetherKindFileSchema = z.discriminatedUnion("kind", [
  z.object({ ...kindFileEnvelope, entities: z.array(aetherProjectSchema), kind: z.literal("project") }).strict(),
  z.object({ ...kindFileEnvelope, entities: z.array(aetherFindingSchema), kind: z.literal("finding") }).strict(),
  z.object({ ...kindFileEnvelope, entities: z.array(aetherPageSchema), kind: z.literal("page") }).strict(),
]);

export type AetherKindFile = z.infer<typeof aetherKindFileSchema>;

/** Every entity shape this atlas stores, as one union — what a reduction returns before it is filed. */
export type AetherEntity = AetherKindFile["entities"][number];

/** The manifest, written last, that grades every kind file beside it. */
export const aetherManifestSchema = z
  .object({
    kinds: z.record(z.enum(AETHER_KINDS), atlasKindStatusSchema),
    schemaVersion: z.literal(AETHER_SCHEMA_VERSION),
    updatedAt: isoSchema,
  })
  .strict();

export type AetherManifest = z.infer<typeof aetherManifestSchema>;

/**
 * An empty file for one kind — the shape a reset installs and a first walk folds onto.
 *
 * @param kind the kind to build an empty file for
 * @param updatedAt this run's ISO timestamp
 * @returns the empty file, valid against {@link aetherKindFileSchema}
 */
export function emptyAetherKindFile({
  kind,
  updatedAt,
}: {
  kind: AetherKindFile["kind"];
  updatedAt: string;
}): AetherKindFile {
  return { coverage: [], entities: [], gaps: [], kind, schemaVersion: AETHER_SCHEMA_VERSION, updatedAt };
}

/**
 * Assemble one kind's file from its parts, refusing a mis-routed entity.
 *
 * The parse is the point rather than a formality: {@link aetherKindFileSchema} is a discriminated union, so
 * a target that reached the finding fold fails HERE rather than being written into `findings.jsonl` and read
 * back forever as a finding.
 *
 * @param kind the kind this file is for
 * @param entities the merged entity list
 * @param coverage the kind's coverage cells after this run
 * @param gaps the kind's gaps after this run
 * @param at this run's ISO timestamp
 * @returns the file, or why the assembled document is not storable
 */
export function assembleAetherKindFile({
  kind,
  entities,
  coverage,
  gaps,
  at,
}: {
  kind: AetherKindFile["kind"];
  entities: readonly AetherEntity[];
  coverage: readonly AetherCoverageCell[];
  gaps: readonly AetherGap[];
  at: string;
}): Result<AetherKindFile> {
  const parsed = aetherKindFileSchema.safeParse({
    coverage,
    entities,
    gaps,
    kind,
    schemaVersion: AETHER_SCHEMA_VERSION,
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
export function initialAetherManifest({ updatedAt }: { updatedAt: string }): AetherManifest {
  const entries = AETHER_KINDS.map(
    (kind) => [kind, { digest: null, entityCount: 0, lastAttempt: null, lastSuccessAt: null }] as const,
  );
  // `as`: built from the platform's own exhaustive kind list, which Object.fromEntries widens to string.
  // oxlint-disable-next-line no-unsafe-type-assertion
  const kinds = Object.fromEntries(entries) as AetherManifest["kinds"];
  return { kinds, schemaVersion: AETHER_SCHEMA_VERSION, updatedAt };
}
