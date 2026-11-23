/**
 * This atlas's per-kind merge, and the proof that has to exist before anything may be staled.
 *
 * The lifecycle is the kit's `mergeKind`. What is genuinely CrowdStrike's own is the guard around it.
 *
 * ## Staling takes a proof, not a boolean
 *
 * "This entity was not returned, so it is gone" is only true when the read that did not return it actually
 * FINISHED. A paged read that stopped early, a 429 halfway through a fan-out and an empty result look the
 * same to a merge that takes `complete: boolean` — and a wrong `true` marks real machines stale, which is
 * the one error in this atlas that a reader cannot spot, because a stale host looks exactly like a
 * decommissioned one.
 *
 * So {@link mergeCrowdstrikeKind} does not take a boolean. It takes a {@link CompleteFamilyRead}, which only
 * `kit/completeness.ts` can construct and which refuses unless the pages ran out and the count the provider
 * itself reported was reached. That file carries the reasoning and is where the check now lives — a
 * second atlas had arrived at the same forty lines independently, which is the regeneration
 * `error-handling.md` describes. An incomplete read still merges what it saw and stales nothing.
 *
 * The proof is re-exported from here so a caller reads one module per atlas rather than two.
 */
import type { Result } from "../../lib/result.js";
import { type CompleteFamilyRead, provenCompleteRead } from "../kit/completeness.js";
import { mergeObservedKind } from "../kit/merge.js";

import type { CrowdstrikeEntity } from "./entities.js";

export { type CompleteFamilyRead, provenCompleteRead };

/**
 * Merge this run's freshly projected entities for one kind into what the store already holds.
 *
 * @param stored every entity this kind's file already holds
 * @param observed this run's freshly projected entities
 * @param complete the proof that the read finished, or `null` when it did not — a `null` merges what was
 *   seen and leaves every unobserved entity exactly as it was
 * @param at this run's ISO timestamp
 * @returns the merged entity list, sorted by id, or the reason this run cannot be merged
 */
export function mergeCrowdstrikeKind<TEntity extends CrowdstrikeEntity>({
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
  return mergeObservedKind({ at, complete, observed, stored });
}
