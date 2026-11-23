/**
 * The posting rule for a step that dictates words for the owner to type or say — a POSTING rule, beside
 * `./htmlInProse.ts`. Posting only: rows already in the register predate the rule, exactly as `./posting.ts` says of
 * every rule there.
 *
 * The owner speaks to the supervisor and answers on the Queue, where a steer spoken with a card open reaches the chair
 * naming that card. A card reading `Type "fix the usage reader for <plan>" to the supervisor` makes the owner carry
 * an instruction from one window to another, word for word, for a repair a card can ask for itself. So a step's `what`
 * or `where` telling the owner to type or say QUOTED words is refused; the card says what the owner wants done, and
 * the owner says it in their own words on the card.
 *
 * The criterion is `type` or `say` directly before a quoted phrase, in `what` or `where`. `Type the code mailed to the
 * plan's address into the prompt` names no quoted words and posts; `Click "Approve"` names a button, not words, and
 * posts. The residue, stated: words dictated with another verb (`Send "…" to the supervisor`), with no quotes
 * (`Say yes to the supervisor`), in backticks, or in another field post unread — a tell, not a fence.
 * MEASURED: 9 of the 144 steps in the register matched, every one a `claude-plan-unusable` card. Reproduce with
 * `grep -cE '"what":"(Type|Say|type|say) \\"' "$SLOPWEAVER_HOME/hand-steps/steps.jsonl"`.
 *
 * Pure: no I/O.
 */
import { type HandStepError, HandStepErrors } from "./errors.js";
import type { HandStep } from "./step.js";

/**
 * `type` or `say`, then directly a phrase in straight double, curly double or curly single quotes. Directly, so the
 * quoted words are the verb's own payload: `Say whether the dialog reads "Approved"` quotes a label, not words to say.
 * A straight single quote is left out, because it is also an apostrophe.
 */
const DICTATED_WORDS = /\b(?:type|say)\s+["“‘][^"”’]+["”’]/i;

/**
 * The refusal for a step whose `what` or `where` dictates quoted words for the owner to type or say, or `undefined`
 * when neither does.
 *
 * @param step the step a caller is about to record
 * @returns the refusal naming the field and the dictated phrase, or `undefined`
 */
export function typedInstruction({ step }: { step: HandStep }): HandStepError | undefined {
  const fields: readonly { readonly field: "what" | "where"; readonly text: string | undefined }[] = [
    { field: "what", text: step.what },
    { field: "where", text: step.where },
  ];
  for (const { field, text } of fields) {
    const dictated = text === undefined ? undefined : DICTATED_WORDS.exec(text)?.[0];
    if (dictated !== undefined) {
      return HandStepErrors.invalidField({
        field,
        why:
          `dictates words for the owner to type or say (${dictated}) — the owner speaks on the Queue, in their own ` +
          "words: say what they want done and where they ask for it, such as `Ask on this card for …`",
      });
    }
  }
  return undefined;
}
