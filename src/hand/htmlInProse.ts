/**
 * The posting rule for an HTML document named in a step's prose by its file name — a POSTING rule, the hand register's
 * half of `../handover/cardHtml.ts`, beside `./imageInProse.ts`. Posting only: rows already in the register predate
 * the rule, exactly as `./posting.ts` says of every rule there.
 *
 * Pure: no I/O.
 */
import { bareHtmlWhy } from "../handover/cardHtml.js";

import { type HandStepError, HandStepErrors } from "./errors.js";
import { posterProse } from "./proseFields.js";
import type { HandStep } from "./step.js";

/**
 * The refusal for the first prose field of a step naming an HTML file, or `undefined` when none does.
 *
 * @param step the step a caller is about to record
 * @returns the refusal, or `undefined`
 */
export function htmlInProse({ step }: { step: HandStep }): HandStepError | undefined {
  for (const { field, text } of posterProse({ step })) {
    const why = bareHtmlWhy({ cite: "pass that address as --url", text });
    if (why !== undefined) {
      return HandStepErrors.invalidField({ field, why });
    }
  }
  return undefined;
}
