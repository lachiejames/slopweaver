/**
 * The posting rule for a step that asks the owner to REACT to something the fleet put in front of them: its note must
 * open the queue item the owner reacts to.
 *
 * Its own module because it is one posting rule with its own two tells, judged on a built step after
 * `./step.ts` has accepted the record — the record's own rules stay there, and this one is read by
 * `./posting.ts` alongside the others. Pure.
 */
import { isSignIn } from "./decision.js";
import { type HandStepError, HandStepErrors } from "./errors.js";
import { isConsoleQueueLink, isConsoleQueuePage } from "./queueLink.js";
import type { HandStep } from "./step.js";

/**
 * A step asking the owner to react to something the fleet has put in front of them — the steps that belong on the queue.
 *
 * A tell, like `./step.ts`'s `FLEET_ACTOR`, and matched as a PHRASE rather than a bare word, because three Claude
 * review passes (r1-r3) each found ordinary sentences the bare words refused: a sign-in that picks an account,
 * "pick up your YubiKey", "say a quick steer", "the React error overlay". So: "react to", "decide", "pick" plus
 * a chooser's determiner, "steer" plus an object, and "give … a steer". A false pass here costs one step without
 * its link; a false refusal costs a session the ability to post a step the owner really has to take — so the phrases
 * stay narrow, and a sentence phrased around them is recorded. `choose`, `answer` and `approve` are left out:
 * a sign-in's account picker, Slack and a provider console each have their own address.
 *
 * MEASURED by replaying all 60 posted steps through `hand post`: none is refused by this rule — the
 * three steps that ever asked a queue reaction already opened their item. It holds the line rather
 * than cleaning up history. Reproduce by replaying
 * `grep '"kind":"posted"' "$SLOPWEAVER_HOME/hand-steps/steps.jsonl"` through `hand post --home "$(mktemp -d)"`.
 */
const REACTION =
  /(?<!\bnot\s)\breact\s+to\b|\bdecide\b|\bpick\s+(?:one|a|an|the|which|between|from)\b|\bsteer\s+(?:the|it|this|that|them|his|its)\b|\bgive\b[^.?!]*\ba\s+steer\b/i;

/**
 * The queue itself, named in a sentence — the one noun that is the product's own rather than ordinary English.
 *
 * Five review passes (r1-r5) measured why nothing wider holds: every noun a queue item is made of — an option,
 * a card, a question, a reviewer, a draft — is also what a phone approval, a macOS prompt or a payment sheet
 * asks the owner to pick ("pick the option to approve with a push", "pick the company card in the Apple Pay sheet").
 * So a link-less reaction is refused only when it says `queue`. The residue is a false PASS, stated: "pick one
 * of the three reviewers" with no `--url` posts, and the link the minting side puts on every note is what
 * carries it.
 */
const NAMES_THE_QUEUE = /\bqueue\b/i;

/**
 * The refusal for a note that should open a queue item and does not — a POSTING rule.
 *
 * A floating note must link the owner directly to the queue item to react to. The note's Open button is `url`, so a
 * step asking the owner to react is refused in two shapes:
 * linking to the queue page without opening an item (the owner lands on the list and hunts), and — when its sentence
 * names the queue ({@link NAMES_THE_QUEUE}) — linking nowhere at all. A step that is not a reaction may
 * link to the queue page itself — "hover a link on a queue card" acts on the list. Every hand step is itself a
 * queue item, so `hand:<id>` is always a key there is to link to; a better one is the ask or pull request the owner is
 * reacting to.
 *
 * The r4 and r5 reviews earned that narrowing: a phone or OS approval ("pick the number shown on the laptop",
 * "pick the option to approve with a push") is a reaction phrase with no page to link, and so is a voice test
 * checking the voice does "not react to" a cough.
 *
 * Outside `./step.ts`'s `buildHandStep` for `linkAsLiteral`'s reason: rows already in the register carry other urls.
 *
 * @param step the step a caller is about to record
 * @returns the refusal, or `undefined` when the step is no reaction, is a paste, opens its item, or links where the owner acts
 */
export function reactionWithoutQueueLink({ step }: { step: HandStep }): HandStepError | undefined {
  const pastes = step.literal !== undefined || step.checklist !== undefined;
  if (!REACTION.test(step.what) || isSignIn({ what: step.what }) || pastes) {
    return undefined;
  }
  if (step.url === undefined) {
    if (!NAMES_THE_QUEUE.test(step.what)) {
      return undefined;
    }
    return HandStepErrors.invalidField({
      field: "url",
      why: `is missing and the step asks the owner to react — pass --url http://localhost:3000/queue?open=<kind>%3A<id> (the ask or pull request the owner reacts to; this step itself, hand%3A${step.id}, only for a step the owner performs rather than decides), or the page the owner acts on, so the note's Open button takes the owner straight there`,
    });
  }
  if (isConsoleQueuePage({ url: step.url }) && !isConsoleQueueLink({ url: step.url })) {
    return HandStepErrors.invalidField({
      field: "url",
      why: `opens the queue but no item on it — add open=<kind>%3A<id> (the ask or pull request the owner reacts to; this step itself, hand%3A${step.id}, only for a step the owner performs rather than decides) so the owner lands on what they react to rather than hunting the list`,
    });
  }
  return undefined;
}
