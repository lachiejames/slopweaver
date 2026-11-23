/**
 * The posting rule that refuses a step whose card the Queue would withhold for a raw machine id — the card gate's
 * own criterion, asked while the session still holds the words.
 *
 * A decision note once went up with a `--witness` naming a call by its machine id, and the Queue's card gate
 * (`site/lib/machineIdForm.ts`) held the card off the owner's Queue — it is done when no session, call, talk, turn
 * or run is named by its machine id — hiding the asks it absorbed with it. The note was on the owner's screen; the
 * card it points at was not. So `hand post` refuses at posting exactly what that gate refuses at drawing.
 *
 * Which fields the card draws, and the criterion over them, are `./cardDrawnProse.ts` — a leaf the site lane's
 * parity test (`site/__tests__/unit/handPostMachineIdParity.test.ts`) puts through the card gate itself, so a field one
 * refuses and the other draws fails it. This module only turns its answer into the refusal.
 *
 * An ask a step OPENS (`--open ask:<slug>`) brings its own recorded summary, problem, options, lean and stakes to the
 * card. This pure rule cannot read it, so `hand post` reads it beside this rule
 * (`../cli/commands/hand/openedAskMachineId.ts`); a writer that is not the verb is not checked for it.
 */
import { machineIdInCardProse } from "./cardDrawnProse.js";
import { type HandStepError, HandStepErrors } from "./errors.js";
import type { HandStep } from "./step.js";

/**
 * The refusal for a step whose card would name a session, call, talk, turn or run by its machine id — a POSTING rule.
 *
 * @param step the step a writer is about to record
 * @returns the refusal naming the first such field and its id, or `undefined` when the card would be drawn or the
 * step is a notice, which has no card
 */
export function machineIdInProse({ step }: { step: HandStep }): HandStepError | undefined {
  const found = machineIdInCardProse({ step });
  if (found === undefined) {
    return undefined;
  }
  return HandStepErrors.invalidField({
    field: found.field,
    why:
      `names "${found.id}" by its machine id, and the Queue withholds a card that draws one — the note would go up ` +
      'while its card stayed off the owner\'s Queue. Name it by what it was doing ("the owner\'s call this morning", "the recut ' +
      'they asked for") and drop the id, or put the address in --url',
  });
}
