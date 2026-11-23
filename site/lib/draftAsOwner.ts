/**
 * A hand step asking the owner to react to a message drafted as them, which carries no message the card can draw —
 * refused by the card's form, so a card like that says so instead of reading as a question with nothing to react to.
 *
 * A card that asks for a reaction to drafts must show the drafted replies. `hand post` refuses to record such a step
 * (`src/hand/draftAsOwner.ts`); this is the console half, for every step already in the register and one recorded past
 * the hatch. The criterion is restated from there, because the console cannot
 * import `src/`: the two patterns must stay byte-identical.
 *
 * Pure: a step, what it names and what its ask offers in, a form out.
 */

import type { BoardRowActionRead } from "../components/live/readAction";
import type { StepCardForm } from "./handCard";

/**
 * "drafted as you", "written as you", "worded as you", "composed as you". "as you" must end the
 * text or meet punctuation, a preposition, or an "and" naming the message's send state — "written as you speak" and
 * "written as you and Seth discussed" name no author, while "drafted as you and UNSENT" is an ask recorded
 * with no draft on its card. The state is a closed list: any other word after "and" may be a person,
 * and a comma opening a list of people ("as you, Seth, and I discussed") ends nothing either.
 */
const DRAFTED_AS_YOU =
  /\b(?:drafted|written|worded|composed)\s+(?:as\s+you(?=\s*$|\s*,(?!\s*[^\s,]+,?\s+and\s)|\s*[.;:!?)\u2013\u2014-]|\s+(?:on|in|to|for|at|about|from)\b|\s+and\s+(?:un(?:sent|posted)|not\s+(?:yet\s+)?(?:sent|posted)|waiting|ready|parked|held)\b))/iu;

/**
 * The first phrase in the texts that names a message drafted as the owner, or `undefined` when none does.
 *
 * @param texts the step's `what` and `where`; an absent one is skipped
 * @returns the phrase as the text spells it
 */
export function draftAsOwnerPhrase({ texts }: { texts: readonly (string | undefined)[] }): string | undefined {
  for (const text of texts) {
    if (text === undefined) {
      continue;
    }
    const found = DRAFTED_AS_YOU.exec(text);
    if (found !== null) {
      return found[0];
    }
  }
  return undefined;
}

/**
 * The hand card's form once the draft it talks about is accounted for: a form already refused stays refused; a step
 * naming a draft as the owner that names no parked draft and opens no ask offering a message is refused, quoting the
 * phrase; every other step keeps the form it had.
 *
 * A step whose ask the board has not read yet keeps its form too: what that ask offers is unknown, not absent, and
 * a refusal drawn over a board still loading would tell the owner the draft was missing for the seconds it takes to
 * arrive.
 *
 * @param form the form `handCard` gave the step
 * @param what the step's sentence
 * @param where the step's `where`, when it has one
 * @param draftIds every parked-draft id the step or its ask names (`./slackDraftIds.ts`), whatever each resolved to
 * @param offered what the ask the step opens offers, or `undefined` when it opens none
 * @param askUnread the step opens an ask and the board holding it has not been read — loading, or it did not read
 * @returns the form the panel draws by
 */
export function handDraftForm({
  form,
  what,
  where,
  draftIds,
  offered,
  askUnread,
}: {
  form: StepCardForm;
  what: string;
  where: string | undefined;
  draftIds: readonly string[];
  offered: BoardRowActionRead | undefined;
  askUnread: boolean;
}): StepCardForm {
  if (form.kind === "refused" || askUnread) {
    return form;
  }
  const phrase = draftAsOwnerPhrase({ texts: [what, where] });
  const carries = draftIds.length > 0 || offered?.kind === "action" || offered?.kind === "mail";
  if (phrase === undefined || carries) {
    return form;
  }
  return {
    kind: "refused",
    why:
      `This step asks you to react to a message "${phrase}", and carries no message to show you: it names no parked ` +
      "draft and opens no ask offering one. That is a defect in whatever posted it, not a card without a draft.",
  };
}
