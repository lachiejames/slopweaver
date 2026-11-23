/**
 * A hand step's headline says what a thing is before it names its code — a POSTING rule.
 *
 * A card focuses on meaning instead of stating facts: a stated fact leaves the owner to translate it into meaning.
 * `what` is the note's headline and the
 * queue card's, so it is the field this reads, through the one criterion every card door shares
 * (`../briefing/untranslatedCode.ts`). `Read the NET-93, TDA-41 and TDA-42 evidence drafts` is the shape refused;
 * `Read the network-separation and test-data evidence drafts (NET-93, TDA-41, TDA-42)` passes.
 *
 * A notice is read too — the incident page is one — so it is inside it, unlike `./headlinePurpose.ts`.
 *
 * A POSTING rule (`./posting.ts`), never a read one, for `./step.ts`'s `linkAsLiteral` reason: every row already
 * in the register must still read. Pure.
 */
import { untranslatedCodeReason, untranslatedCodes } from "../briefing/untranslatedCode.js";

import { type HandStepError, HandStepErrors } from "./errors.js";
import type { HandStep } from "./step.js";

/**
 * The refusal for a headline that names a code before saying what it is.
 *
 * @param step the step a caller is about to record
 * @returns the refusal, or `undefined` when every code in the headline follows its meaning
 */
export function headlineCode({ step }: { step: HandStep }): HandStepError | undefined {
  const codes = untranslatedCodes({ text: step.what });
  if (codes.length === 0) {
    return undefined;
  }
  return HandStepErrors.invalidField({ field: "what", why: untranslatedCodeReason({ codes }) });
}
