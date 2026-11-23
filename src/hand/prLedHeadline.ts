/**
 * A hand step's headline leads with the discussion, never a pull request — a POSTING rule.
 *
 * A card asking the owner to approve a fix PR shows a PR before the conversation, and a PR never leads instead of
 * the discussion. `what` is the note's headline and the queue card's, so it is the field this reads, through the
 * criterion every first-read door shares (`../briefing/pullRequestLead.ts`). `Approve the fix PR for the gateway
 * outage, so events recover` is the shape refused; `Read what the gateway errors look like on the dashboard, so you
 * can decide whether to raise it with the team` passes.
 *
 * A notice is read too: news still leads with something.
 *
 * A POSTING rule (`./posting.ts`), never a read one, for `./step.ts`'s `linkAsLiteral` reason: every row already
 * in the register must still read. Pure.
 */
import { pullRequestLead, pullRequestLeadReason } from "../briefing/pullRequestLead.js";

import { type HandStepError, HandStepErrors } from "./errors.js";
import type { HandStep } from "./step.js";

/**
 * The refusal for a headline that leads with a pull request instead of the discussion.
 *
 * @param step the step a caller is about to record
 * @returns the refusal, or `undefined` when the headline leads with something else
 */
export function prLedHeadline({ step }: { step: HandStep }): HandStepError | undefined {
  const phrase = pullRequestLead({ text: step.what });
  if (phrase === undefined) {
    return undefined;
  }
  return HandStepErrors.invalidField({ field: "what", why: pullRequestLeadReason({ phrase }) });
}
