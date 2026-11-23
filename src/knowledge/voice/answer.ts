/**
 * Building one validated {@link AnsweredProposal} — what THEY said about a claim the fleet proposed they hold.
 *
 * The briefing carries a correction block where each proposal takes right, wrong, or partly in a single
 * click. This is the other end of that click. The
 * page cannot call back, so the mark reaches the fleet the way every other answer of their does — they say it
 * to the pinned supervisor, and a visible session records it here.
 *
 * Pure: no filesystem, no clock, no network. The instant is passed in, exactly as `./propose.ts` takes one,
 * so every check below is testable without touching their real home.
 *
 * ## The one check that is NOT here
 *
 * Whether the mark is a fair reading of what they said. A session hears "yeah that's about right, but it's
 * the staging pool not prod" and has to decide that is `partly` with a correction. Rule 2 forbids a model
 * inside a verb, so nothing here will ever make that call — what this file guarantees is that the row cites
 * a proposal that is really OPEN, and that their words were recorded rather than a summary of them.
 */
import { err, ok, type Result } from "../../lib/result.js";

import { type BeliefError, BeliefErrors } from "./errors.js";
import { requireText } from "./propose.js";
import { type AnsweredProposal, type BeliefMark, type BeliefProposal, PROPOSAL_CLAIM_MAX } from "./types.js";
import { answerFor, openProposals } from "./unit.js";

/**
 * The longest their own words about one proposal may run.
 *
 * Deliberately larger than {@link PROPOSAL_CLAIM_MAX}: a claim is one sentence a session composed and a
 * reaction is whatever they actually said, which is routinely a paragraph explaining what the fleet got
 * wrong. The bound exists so a paste of a whole transcript is refused, not to shape their prose.
 */
export const ANSWER_WHY_MAX = 2000;

/**
 * Build the row recording their answer to one open proposal.
 *
 * ## Why the whole queue is a parameter
 *
 * Because the two things that make this row honest are both facts about the queue rather than about the
 * flags: the proposal has to EXIST, and it has to still be open. Passing the rows in keeps the check pure
 * and keeps the reader (`./unit.ts`'s {@link openProposals}) the single definition of what "open" means —
 * a second definition here would drift from the one the briefing block projects.
 *
 * @param proposals every row the queue holds
 * @param proposalId the proposal they answered
 * @param mark what they said: right, wrong, or partly
 * @param why their own words, as the supervisor relayed them
 * @param correction their wording for the claim, when they supplied one
 * @param run the board row the recording session is on
 * @param reviewedAtIso the instant to stamp; passed in so this stays pure
 * @returns the row, or the first check that failed
 */
export function buildAnswer({
  proposals,
  proposalId,
  mark,
  why,
  correction,
  run,
  reviewedAtIso,
}: {
  proposals: readonly BeliefProposal[];
  proposalId: string;
  mark: BeliefMark;
  why: string;
  correction?: string | undefined;
  run: string;
  reviewedAtIso: string;
}): Result<AnsweredProposal, BeliefError> {
  const open = openProposals({ proposals }).find((row) => row.proposalId === proposalId);
  if (open === undefined) {
    return err(
      BeliefErrors.proposalNotOpen({
        answered: answerFor({ proposalId, proposals }) !== undefined,
        proposalId,
      }),
    );
  }
  const whyText = requireText({ field: "why", max: ANSWER_WHY_MAX, value: why });
  if (whyText.isErr()) {
    return err(whyText.error);
  }
  const runText = requireText({ field: "run", max: 200, value: run });
  if (runText.isErr()) {
    return err(runText.error);
  }
  // An ABSENT correction is the ordinary case for every mark, including `wrong` — they may say a claim is
  // wrong without supplying the right one, and inventing the replacement is exactly what this whole queue
  // exists to stop. What is refused is a correction they did supply that does not fit a claim's own bound,
  // because the point of the field is that it can become the claim of a register row of their.
  const corrected: Result<string | undefined, BeliefError> =
    correction === undefined
      ? ok(undefined)
      : requireText({ field: "correction", max: PROPOSAL_CLAIM_MAX, value: correction });
  if (corrected.isErr()) {
    return err(corrected.error);
  }
  const supplied = corrected.value;
  return ok({
    kind: "answered",
    mark,
    proposalId: open.proposalId,
    reviewedAtIso,
    run: runText.value,
    unitId: open.unitId,
    why: whyText.value,
    ...(supplied === undefined ? {} : { correction: supplied }),
  });
}
