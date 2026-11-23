/**
 * What a hand step ATTACHES beside its sentence — the `checklist` the owner ticks through, the evidence it `cites`, the
 * `details` it folds under the sentence, the `quotes` it draws above that fold, and the `shot` of the provider page
 * with a red box on each thing to grab — each checked as a stated value or as honestly absent.
 *
 * Its own module because `./step.ts` is the record and every rule about its sentence, and these five are what
 * a card draws beside it rather than what it says. Each one's rule lives in its own module (`./checklist.ts`,
 * `./cites.ts`, `./details.ts`, `./quotes.ts`, `./shot.ts`); this is where a step collects them, as pieces to
 * spread so the register keeps its key order without a branch per field.
 */
import { err, ok, type Result } from "../lib/result.js";

import { checkedChecklist } from "./checklist.js";
import { checkedCites } from "./cites.js";
import { checkedDetails } from "./details.js";
import type { HandStepError } from "./errors.js";
import { checkedQuotes } from "./quotes.js";
import { checkedShot } from "./shot.js";
import type { HandStep, HandStepDraft } from "./step.js";

/**
 * A step's five attachments checked, each as a piece to spread — empty when absent.
 *
 * @param draft every field as the caller has it
 * @returns the five pieces, or the first refusal
 */
export function checkedAttachments({ draft }: { draft: HandStepDraft }): Result<
  {
    readonly checklist: Pick<HandStep, "checklist">;
    readonly cites: Pick<HandStep, "cites">;
    readonly details: Pick<HandStep, "details">;
    readonly quotes: Pick<HandStep, "quotes">;
    readonly shot: Pick<HandStep, "shot">;
  },
  HandStepError
> {
  const checklist = checkedChecklist({ value: draft.checklist });
  if (checklist.isErr()) {
    return err(checklist.error);
  }
  const cites = checkedCites({ value: draft.cites });
  if (cites.isErr()) {
    return err(cites.error);
  }
  const details = checkedDetails({ value: draft.details });
  if (details.isErr()) {
    return err(details.error);
  }
  const shot = checkedShot({ unboxed: "admitted", value: draft.shot });
  if (shot.isErr()) {
    return err(shot.error);
  }
  const quotes = checkedQuotes({ value: draft.quotes });
  if (quotes.isErr()) {
    return err(quotes.error);
  }
  return ok({
    checklist: checklist.value === undefined ? {} : { checklist: checklist.value },
    cites: cites.value === undefined ? {} : { cites: cites.value },
    details: details.value === undefined ? {} : { details: details.value },
    quotes: quotes.value === undefined ? {} : { quotes: quotes.value },
    shot: shot.value === undefined ? {} : { shot: shot.value },
  });
}
