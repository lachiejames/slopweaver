/**
 * A hand step's headline says what is asked of the owner AND what it is about — never the act alone.
 *
 * A card reading "Approve the 13 Slopweaver hooks Codex now skips, six changed by recent landings and seven never
 * trusted" told the owner neither what was being asked of them nor what it was about. The sentence opened on a verb and
 * then spent its second half on a count, so nothing in it said what approving would get them or what it concerned.
 * `what` is the note's headline and the queue card's (`./step.ts`'s `WHAT_CAP`), so it is the field this reads.
 *
 * **The criterion is a purpose clause, by its joint.** After the act, the sentence carries what the step is FOR or
 * ABOUT, joined by one of a closed set: a colon, a spaced dash or a semicolon introducing it, or `so`, `because`,
 * `since`, `until`, `before`, `once`, `now that`, `which`, `whether`, `without it` — or it is a question, which carries its own
 * subject. `Approve users.profile:write on your Slack app and reinstall it, so your holiday status can be set` is
 * the shape; the hooks card has none of them.
 *
 * **A tell, not a fence, and deliberately over-broad** — the trade `../briefing/ownHandAction.ts` makes, for its
 * reason. A colon before a count passes (`Approve 13 hooks: six changed`), and nothing here can read whether the
 * clause after the joint is in the owner's words; `./step.ts`'s `fleetWordInWhat` is the half that reads the words. A
 * sentence that is about something without one of these joints is refused, and the rewrite costs the poster one
 * clause: a false refusal is a sentence made clearer, a false pass one card the owner asks about.
 *
 * A NOTICE is outside it: news with nothing waiting on the owner asks nothing, so there is no act to say the purpose of.
 *
 * MEASURED over the 214 distinct non-notice headlines among the 256 steps ever posted: 148 carry a joint
 * and 66 do not — the hooks card, and sign-ins naming no purpose ("Sign in to Google Cloud from a plain terminal of
 * yours", "Press Authorize on the plan-two Claude mint") among them. Reproduce by replaying `grep '"kind":"posted"' "$SLOPWEAVER_HOME/hand-steps/steps.jsonl"` through
 * `parseHandLine` then {@link headlineWithoutPurpose}.
 *
 * A POSTING rule (`./posting.ts`), never a read one, for `./step.ts`'s `linkAsLiteral` reason: every row already
 * in the register must still read. Pure.
 */
import { type HandStepError, HandStepErrors } from "./errors.js";
import type { HandStep } from "./step.js";

/** The joints that introduce what a step is for or about — see the module header for the closed set. */
const PURPOSE_JOINT =
  /:\s|\s[—–]\s|;\s|\b(?:so|because|since|until|before|once|now that|which|whether|without it)\b|\?\s*$/iu;

/**
 * The act half of a headline — everything before its purpose joint, or the whole sentence when it carries none.
 *
 * @param what the step's headline
 * @returns the text naming what the owner is asked to do
 */
export function headlineAct({ what }: { what: string }): string {
  const joint = PURPOSE_JOINT.exec(what);
  return joint === null ? what : what.slice(0, joint.index);
}

/**
 * The refusal for a headline that names an act and not what it is about — a POSTING rule.
 *
 * @param step the step a caller is about to record
 * @returns the refusal, or `undefined` when the headline carries its purpose or the step is a notice
 */
export function headlineWithoutPurpose({ step }: { step: HandStep }): HandStepError | undefined {
  if (step.notice === true || PURPOSE_JOINT.test(step.what)) {
    return undefined;
  }
  return HandStepErrors.invalidField({
    field: "what",
    why:
      "says what to do but not what it is about — the headline is all the owner reads first, so after the act say what it " +
      'is for or what it concerns in their words, joined by "so", "because", "until", ": " or " — " ' +
      '("Approve the 13 Slopweaver hooks Codex skips" told them nothing; "<act>, so <what it gets them>" does)',
  });
}
