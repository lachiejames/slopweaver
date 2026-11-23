/**
 * CARD ORDER, RECURRENCE AND THE FOLD — the pure half of the hygiene pass's presentation.
 *
 * The checks in `./indexBudget.ts`, `./duplicates.ts`, `./referents.ts` and `./enforcement.ts` say WHAT was
 * found. This module says what the owner sees first, and how much of it. No filesystem, no clock, no model.
 *
 * ## Severity is the check registry's own order, so there is no score to argue with
 *
 * `../types.ts`'s `HYGIENE_CHECK_IDS` is declared in severity order, and ranking reads that array's index.
 * `reflect/rank.ts` scores `(impact * safety) / cost` because its findings arrive from seven unrelated
 * substrates with no shared unit; these six arrive from six checks whose relative importance is a standing
 * fact about the corpus rather than a per-run measurement. A weight per check would be a dial nothing
 * measures, and the owner has already refused that class of thing elsewhere: a threshold a caller can retune
 * is a threshold nobody ever measures again.
 *
 * The one thing that IS per-run is recurrence, and it breaks ties rather than crossing check boundaries. A
 * duplicate pair the owner has ignored for a week outranks one found this morning; it never outranks a truncating
 * index, because the truncating index is silently unloading memories right now.
 *
 * ## The fold cap is five, and the sixth is REFUSED rather than trimmed
 *
 * Five is `reflect/rank.ts`'s `SURFACE_CAP`, and the scar is the same: an unbounded pass once emitted 3,355
 * candidates in one run, which is not a work list but a denial-of-service on the owner's attention. Rule 7 says the
 * SCHEMA enforces the shape, so {@link rankProposals} returns the split and `./compose.ts` refuses a sixth above
 * the fold instead of silently dropping one.
 *
 * **What is past the cap is carried, never discarded.** It goes below the fold and it stays in the ledger, so
 * a proposal that waited three runs to be shown reads as chronic through the same one counter as everything
 * else. Discarding it would make the pass quietly forget what it found.
 *
 * ## No per-check share of the cap, and that is a deliberate difference from reflect
 *
 * `reflect/rank.ts` caps any one source at two of its five, because one noisy substrate produced all 3,355.
 * Here the noisy check is bounded by the corpus instead: the duplicate scan over twenty memories can find at
 * most a few pairs past 0.42, and the manual measurement found exactly four. A per-check share would push a
 * truncating index off a card to leave room for a fifth duplicate pair, which is the wrong trade in the only
 * direction that matters.
 */
import type { HygieneState } from "./ledger.js";
import { HYGIENE_CHECK_IDS, type MemoryHygieneProposal } from "./types.js";

/**
 * The most proposals one card puts above the fold.
 *
 * Five, matching `reflect/rank.ts`'s `SURFACE_CAP` — see this module's header for the scar behind it.
 *
 * @internal
 */
export const ABOVE_FOLD_CAP = 5;

/** A ranked run: what the owner meets first, and what is carried behind it. */
export interface RankedProposals {
  /** At most {@link ABOVE_FOLD_CAP}, in card order. */
  readonly aboveFold: readonly MemoryHygieneProposal[];
  /** Everything else, in the same order. Carried below the fold, never dropped. */
  readonly belowFold: readonly MemoryHygieneProposal[];
}

/** Where a check sits in the registry's severity order. */
function severityOf({ proposal }: { proposal: MemoryHygieneProposal }): number {
  return HYGIENE_CHECK_IDS.indexOf(proposal.check);
}

/**
 * Attach ledger recurrence to this run's proposals, dropping every terminally-refused one.
 *
 * `daysSeen` counts today, so a first sighting is 1 rather than 0 — "seen on one day" is a truer sentence
 * than "seen on no days" about something being looked at right now. That is `reflect/rank.ts`'s own choice,
 * kept so two recurrence counters in one system cannot mean two different things.
 *
 * A refused proposal is removed HERE, before ranking, rather than filtered at render time. A dead proposal
 * sitting in a ranked list is a proposal that gets argued about again, and it would also consume a slot the
 * cap needs for something live.
 *
 * @param proposals everything this run's checks found, with `daysSeen` not yet meaningful
 * @param states the folded ledger, keyed by proposal id
 * @returns one proposal per survivor, recurrence filled in, unsorted
 */
export function withRecurrence({
  proposals,
  states,
}: {
  proposals: readonly MemoryHygieneProposal[];
  states: ReadonlyMap<string, HygieneState>;
}): readonly MemoryHygieneProposal[] {
  return proposals.flatMap((proposal) => {
    const state = states.get(proposal.id);
    if (state?.refused === true) {
      return [];
    }
    const priorDays = state === undefined ? 0 : state.daysSeen;
    return [{ ...proposal, daysSeen: priorDays + 1 }];
  });
}

/**
 * Put proposals in card order and split them at the fold.
 *
 * The comparator is total and reads no clock, so an unchanged corpus ranks byte-identically on every run —
 * which is what makes the report a thing a reader can diff rather than re-read.
 *
 * @param proposals this run's survivors, recurrence already attached
 * @param cap how many may sit above the fold, defaulting to {@link ABOVE_FOLD_CAP}
 * @returns the split, both halves in card order
 */
export function rankProposals({
  proposals,
  cap = ABOVE_FOLD_CAP,
}: {
  proposals: readonly MemoryHygieneProposal[];
  cap?: number;
}): RankedProposals {
  const ordered = [...proposals].toSorted((left, right) => {
    const bySeverity = severityOf({ proposal: left }) - severityOf({ proposal: right });
    if (bySeverity !== 0) {
      return bySeverity;
    }
    const byRecurrence = right.daysSeen - left.daysSeen;
    if (byRecurrence !== 0) {
      return byRecurrence;
    }
    return left.subject.localeCompare(right.subject);
  });
  return { aboveFold: ordered.slice(0, cap), belowFold: ordered.slice(cap) };
}
