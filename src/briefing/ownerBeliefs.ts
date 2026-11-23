/**
 * Projecting the proposal queue onto the Fleet Briefing's correction block. Pure — queue rows in, one typed
 * section out, no filesystem and no clock.
 *
 * ## Why this is a projection and not a composed section
 *
 * The same call `./yourList.ts` and `./autonomy.ts` make, and here it is the whole point of the feature.
 * This block exists so what the owner believes has somewhere to be corrected and kept. A
 * supervisor free to retype a row could disagree with the claim the reviewing session actually proposed,
 * and what the owner would then be marking is the supervisor's account of a belief rather than the belief. So every
 * field comes from the queue one at a time and
 * `../cli/commands/briefing/renderCore.ts` refuses a form that writes the block itself.
 *
 * ## What it does NOT do
 *
 * It does not re-order, and it does not decide what is open. `../knowledge/voice/unit.ts`'s `openProposals`
 * is the single definition of "the owner has not answered this yet", and re-deriving it here would let the page
 * disagree with `slopweaver knowledge answer` about whether an id is answerable — the exact failure mode of
 * offering the owner a row whose answer is already recorded.
 *
 * It also never softens a `wrapped` unit into a plain one. A turn FILE is something a supervisor wrote
 * around the owner's words, so the quote is a span that occurs in the unit rather than a sentence the owner is
 * proven to have said, and the row carries that distinction to the page rather than dropping it here.
 */
import type { ProposedBelief, VoiceUnit } from "../knowledge/voice/types.js";
import type { BriefingOwnerBeliefs, BriefingOwnerBeliefsRow } from "../outbound/briefing/types.js";

import { OWNER_BELIEFS_MAX_ROWS } from "./caps.js";

/** The empty block: what a page renders when nothing is open, or no queue was read. */
export const NO_OWNER_BELIEFS: BriefingOwnerBeliefs = { notShown: 0, rows: [] };

/**
 * Project one open proposal into the row the page carries.
 *
 * `wrapped` is a property of the UNIT rather than of the proposal, so it is looked up rather than read off
 * the row. A unit the scan can no longer produce — its file archived away since the proposal was recorded —
 * is treated as wrapped, which is the conservative answer: it says the page cannot prove the owner said this
 * personally, which is true, rather than asserting that they did.
 *
 * @internal — one step of {@link projectOwnerBeliefs}; no caller outside this file names it.
 *
 * @param proposal one open proposal from the queue
 * @param units every unit the scan found, by id, so the row can carry its provenance
 * @returns the typed row
 */
export function projectOwnerBeliefRow({
  proposal,
  units,
}: {
  proposal: ProposedBelief;
  units: ReadonlyMap<string, VoiceUnit>;
}): BriefingOwnerBeliefsRow {
  const unit = units.get(proposal.unitId);
  // A proposal whose unit the scan can no longer see reads as WRAPPED, which is the conservative answer:
  // the page then SAYS a supervisor wrote around the owner's words rather than presenting the quote as theirs.
  const wrapped = unit === undefined ? true : unit.wrapped;
  return {
    claim: proposal.claim,
    domain: proposal.domain,
    held: proposal.held,
    proposalId: proposal.proposalId,
    quote: proposal.quote,
    reviewedAtIso: proposal.reviewedAtIso,
    unitId: proposal.unitId,
    wrapped,
  };
}

/**
 * Project the queue's open proposals into the page's block.
 *
 * `notShown` is what keeps this a view rather than a truncation, exactly as it is on the owner's own list: the queue
 * keeps every open proposal and the page shows `top` of them, so a page silent about the remainder would
 * read as "this is everything the fleet thinks you believe".
 *
 * The OLDEST open proposals are the ones shown, which is the order the queue already hands them over in. A
 * newest-first block would let a belief proposed once and never re-proposed sit below the fold forever,
 * while the whole point of the block is that the ledger stops being half-kept.
 *
 * @param open every open proposal, in the queue's own order
 * @param units every unit the scan found, by id
 * @param top how many to show; defaults to {@link OWNER_BELIEFS_MAX_ROWS}
 * @returns the typed block, empty when nothing is open
 */
export function projectOwnerBeliefs({
  open,
  units,
  top = OWNER_BELIEFS_MAX_ROWS,
}: {
  open: readonly ProposedBelief[];
  units: ReadonlyMap<string, VoiceUnit>;
  top?: number;
}): BriefingOwnerBeliefs {
  const shown = open.slice(0, top);
  return {
    notShown: open.length - shown.length,
    rows: shown.map((proposal) => projectOwnerBeliefRow({ proposal, units })),
  };
}
