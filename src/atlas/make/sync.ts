/**
 * Publishing what one fill read — the generation, built pure from the observation and what the store held.
 *
 * A fill reaches here only when every read answered (`fill/run.ts`), so every kind is graded the same way:
 * `lastSuccessAt` is this run and its entities are what was read. An entity keeps the first time any run saw
 * it. The strict-boundary gap rides the `organization` file, the one kind every fill reads first.
 */
import { err, ok, type Result } from "#lib/result.js";
import { stableEntityId } from "../kit/identity.js";
import { kindCells } from "./cells.js";
import { MAKE_STORED_DETAIL } from "./details.js";
import type { MakeProjectedItem } from "./fill/project.js";
import type { MakeFillObservation } from "./fill/run.js";
import { MAKE_STRICT_BOUNDARY_GAP, strictBoundaryGap } from "./gaps.js";
import {
  emptyMakeKindFiles,
  initialMakeManifest,
  MAKE_ATLAS_KINDS,
  MAKE_ATLAS_PLATFORM,
  type MakeAtlasKind,
  type MakeAtlasKindFile,
  type MakeAtlasManifest,
} from "./model.js";
import { makeAtlasPaths, publishMakeAtlas, readMakeAtlas } from "./store.js";

type Entity = MakeAtlasKindFile["entities"][number];
type Gap = MakeAtlasKindFile["gaps"][number];

/** What the store held before this run, as much of it as building a generation needs. */
export interface MakePriorGeneration {
  readonly files: Readonly<Record<MakeAtlasKind, MakeAtlasKindFile | null>>;
  readonly manifest: MakeAtlasManifest | null;
}

/** What one publish produced. */
export interface MakeSyncReport {
  readonly entitiesByKind: readonly { readonly kind: MakeAtlasKind; readonly entities: number }[];
  readonly written: readonly string[];
}

/**
 * One kept item as a stored entity.
 *
 * @param kind the kind it belongs to
 * @param item the kept item
 * @param earlier the same entity as the store held it, if it did
 * @param at this run's ISO timestamp
 * @returns the entity, its `browser` slot empty
 */
function entityOf({
  kind,
  item,
  earlier,
  at,
}: {
  kind: MakeAtlasKind;
  item: MakeProjectedItem;
  earlier: Entity | undefined;
  at: string;
}): Entity {
  const before = earlier?.channels.api;
  return {
    channels: {
      api: {
        channel: "api",
        detail: item.detail,
        firstSeenAt: before == null ? at : before.firstSeenAt,
        lastSeenAt: at,
        source: {
          artifacts: [],
          channel: "api",
          deepLink: null,
          deepLinkStatus: "unavailable",
          endpoint: `make-api-v2 ${kind}`,
          observedAt: at,
        },
        state: "observed",
      },
      browser: null,
    },
    id: stableEntityId({ components: { providerId: item.providerId }, namespace: `${MAKE_ATLAS_PLATFORM}:${kind}` }),
    kind,
    providerId: item.providerId,
  };
}

/**
 * One kind's entities this run, each detail cut to the kind's schema and keeping its first sighting.
 *
 * @param priorFile the kind's file as the store held it, `null` when it held none
 * @param at this run's ISO timestamp
 * @returns the entities, or the first detail that failed the kind's schema
 */
function kindEntities({
  kind,
  fill,
  priorFile,
  at,
}: {
  kind: MakeAtlasKind;
  fill: MakeFillObservation;
  priorFile: MakeAtlasKindFile | null;
  at: string;
}): Result<Entity[]> {
  const earlier = new Map((priorFile === null ? [] : priorFile.entities).map((entity) => [entity.providerId, entity]));
  const entities: Entity[] = [];
  for (const item of fill.items[kind]) {
    const cut = MAKE_STORED_DETAIL[kind].safeParse(item.detail);
    if (!cut.success) {
      const why = cut.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ");
      return err([
        `make ${kind} ${item.providerId}: its detail fails the ${kind} allowlist, nothing published — ${why}`,
      ]);
    }
    entities.push(entityOf({ at, earlier: earlier.get(item.providerId), item: { ...item, detail: cut.data }, kind }));
  }
  return ok(entities);
}

/** The strict-boundary gap as the prior file held it, `null` when it held none. */
function priorStrictGap({ priorFile }: { priorFile: MakeAtlasKindFile | null }): Gap | null {
  const found = (priorFile === null ? [] : priorFile.gaps).find((gap) => gap.condition === MAKE_STRICT_BOUNDARY_GAP);
  if (found === undefined) {
    return null;
  }
  return found;
}

/**
 * Build the whole generation in memory — pure, so every rule is testable without a filesystem.
 *
 * Every detail is cut to its kind's schema (`MAKE_STORED_DETAIL`) here as well as at the fill, so what is
 * written is bounded by the allowlist whatever handed this function its items; one that fails refuses the
 * whole generation rather than publishing it without the row.
 *
 * @param fill what the run brought back
 * @param prior what the store held before it
 * @returns every kind file and the manifest, or the first detail that failed its kind's schema
 */
export function buildMakeGeneration({
  fill,
  prior,
}: {
  fill: MakeFillObservation;
  prior: MakePriorGeneration;
}): Result<{
  readonly files: Record<MakeAtlasKind, MakeAtlasKindFile>;
  readonly manifest: MakeAtlasManifest;
}> {
  const at = fill.filledAtIso;
  const files: Record<MakeAtlasKind, MakeAtlasKindFile> = { ...emptyMakeKindFiles({ at }) };
  const manifest = initialMakeManifest({ updatedAt: at });
  const kinds = { ...manifest.kinds };
  for (const kind of MAKE_ATLAS_KINDS) {
    const priorFile = prior.files[kind];
    const built = kindEntities({ at, fill, kind, priorFile });
    if (built.isErr()) {
      return err(built.error);
    }
    const entities = built.value;
    const gaps = kind === "organization" ? [strictBoundaryGap({ at, earlier: priorStrictGap({ priorFile }) })] : [];
    files[kind] = { ...files[kind], coverage: kindCells({ fill, kind }), entities, gaps };
    kinds[kind] = {
      digest: null,
      entityCount: entities.length,
      lastAttempt: { at, outcome: "ok", reasons: [] },
      lastSuccessAt: at,
    };
  }
  return ok({ files, manifest: { ...manifest, kinds } });
}

/**
 * Build and publish the generation one fill read.
 *
 * @param home the resolved `$SLOPWEAVER_HOME`
 * @param fill what the run brought back
 * @returns what was written, or why the store could not be read or the publish was refused
 */
export function syncMakeAtlas({ home, fill }: { home: string; fill: MakeFillObservation }): Result<MakeSyncReport> {
  const paths = makeAtlasPaths({ home });
  // The read establishes what this generation replaces: the compare-and-swap refuses a publish asserting
  // `null` over a store that holds something.
  const snapshot = readMakeAtlas({ paths });
  if (snapshot.isErr()) {
    return err(snapshot.error);
  }
  const prior = { files: snapshot.value.files, manifest: snapshot.value.manifest };
  const generation = buildMakeGeneration({ fill, prior });
  if (generation.isErr()) {
    return err(generation.error);
  }
  const { files, manifest } = generation.value;
  const written = publishMakeAtlas({ derivedFrom: prior.manifest, files, manifest, paths });
  if (written.isErr()) {
    return err(written.error);
  }
  return ok({
    entitiesByKind: MAKE_ATLAS_KINDS.map((kind) => ({ entities: files[kind].entities.length, kind })),
    written: written.value,
  });
}
