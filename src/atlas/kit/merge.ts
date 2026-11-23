/**
 * Pure per-kind merge of a fresh projection against the existing store generation.
 *
 * ## `foldEntity` is the one seam, and it is the whole reason this generalises
 *
 * The two pre-kit atlases differed in exactly one respect and were otherwise the same forty lines: one
 * folded a fresh observation onto a per-surface slot, leaving the other surface's history untouched, and
 * the other — having declared a single surface — replaced the entity outright. Everything around that
 * decision was identical: the duplicate-id refusal, the stale-the-absent pass, the sort, the `Result`.
 *
 * Making the difference a callback rather than a shared entity schema is deliberate. A shared schema would
 * force the single-surface atlas to grow a surface map it does not use, which is an on-disk layout change,
 * which is a schema-version bump, which is a forced `reset` on every install that already has data. A seam
 * costs one function.
 *
 * ## Only ever called on a COMPLETE read
 *
 * A caller invokes this only when every required surface for the kind succeeded this run, so "a
 * previously-observed entity now absent means stale" is safe to apply unconditionally. An incomplete read
 * leaves the stored entities exactly as the previous generation had them instead — because an entity
 * missing from a half-finished read has not disappeared, it has not been looked for.
 */
import { err, ok, type Result } from "../../lib/result.js";

import type { CompleteFamilyRead } from "./completeness.js";
import type { AtlasEntityState } from "./contract.js";
import { AtlasPublishErrors, atlasPublishErrorLines } from "./publishErrors.js";

/** What a caller must be able to tell the kit about its own entities. */
interface MergeableEntity {
  readonly id: string;
}

/**
 * The entity shape a single-surface atlas stores: an id, when it was first seen, and whether this run's
 * complete read still returned it.
 *
 * Named here because two atlases had written the same twenty-line fold over it — see
 * {@link mergeObservedKind}.
 *
 * @internal
 */
export interface ObservedEntity extends MergeableEntity {
  readonly firstSeenAt: string;
  readonly state: AtlasEntityState;
}

/**
 * Merge this run's fresh projections for one kind into what the store already holds.
 *
 * @param stored every entity this kind's file already holds
 * @param observed this run's freshly projected entities
 * @param at this run's ISO timestamp
 * @param foldEntity how to combine one fresh observation with its stored predecessor, if any — the
 *   platform's own decision about surfaces, called once per observed entity
 * @param staleEntity how to mark one stored entity stale; return `null` to leave it exactly as it is,
 *   which is what an already-stale entity should do
 * @returns the merged entity list, sorted by id, or the reason this run cannot be merged
 */
export function mergeKind<TEntity extends MergeableEntity>({
  stored,
  observed,
  at,
  foldEntity,
  staleEntity,
}: {
  stored: readonly TEntity[];
  observed: readonly TEntity[];
  at: string;
  foldEntity: (input: { stored: TEntity | undefined; observed: TEntity; at: string }) => Result<TEntity>;
  staleEntity: (input: { stored: TEntity }) => TEntity | null;
}): Result<readonly TEntity[]> {
  const duplicates = observed.map((entity) => entity.id).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicates.length > 0) {
    return err(atlasPublishErrorLines({ error: AtlasPublishErrors.entityIdsDuplicated({ ids: duplicates }) }));
  }

  const byId = new Map(stored.map((entity) => [entity.id, entity]));
  for (const entity of observed) {
    const folded = foldEntity({ at, observed: entity, stored: byId.get(entity.id) });
    if (folded.isErr()) {
      return err(folded.error);
    }
    byId.set(entity.id, folded.value);
  }

  const observedIds = new Set(observed.map((entity) => entity.id));
  for (const [id, entity] of byId) {
    if (observedIds.has(id)) {
      continue;
    }
    const staled = staleEntity({ stored: entity });
    if (staled !== null) {
      byId.set(id, staled);
    }
  }

  return ok([...byId.values()].toSorted((left, right) => left.id.localeCompare(right.id)));
}

/**
 * The whole merge for a single-surface atlas, with the staling decision taken from a completeness proof.
 *
 * Two rules, and they are the ones every such atlas needs identically. `firstSeenAt` survives a re-sync, so
 * an entity's AGE is a property of the entity rather than of the last run that saw it. And an entity a
 * COMPLETE read no longer returned becomes `stale` rather than being deleted — while an incomplete read
 * (`complete: null`) leaves every unobserved entity exactly as it was, because a record missing from a
 * half-finished read has not disappeared, it has not been looked for.
 *
 * Two atlases arrived at this independently and byte-identically. A multi-surface
 * atlas that folds observations per surface still calls {@link mergeKind} directly with its own
 * `foldEntity`; this is the common case, not a replacement for the seam.
 *
 * @param stored every entity this kind's file already holds
 * @param observed this run's freshly projected entities
 * @param complete the proof that the read finished, or `null` when it did not
 * @param at this run's ISO timestamp
 * @returns the merged entity list, sorted by id, or the reason this run cannot be merged
 */
export function mergeObservedKind<TEntity extends ObservedEntity>({
  stored,
  observed,
  complete,
  at,
}: {
  stored: readonly TEntity[];
  observed: readonly TEntity[];
  complete: CompleteFamilyRead | null;
  at: string;
}): Result<readonly TEntity[]> {
  return mergeKind({
    at,
    foldEntity: ({ stored: prior, observed: fresh, at: when }): Result<TEntity> => {
      // A first sighting is first seen now; a re-sighting keeps the age it already had.
      if (prior === undefined) {
        return ok({ ...fresh, firstSeenAt: when });
      }
      return ok({ ...fresh, firstSeenAt: prior.firstSeenAt });
    },
    observed,
    staleEntity: ({ stored: entity }): TEntity | null => {
      if (complete === null || entity.state === "stale") {
        return null;
      }
      return { ...entity, state: "stale" };
    },
    stored,
  });
}
