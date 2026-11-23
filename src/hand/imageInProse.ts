/**
 * The posting rule for a picture file named in a step's prose — a POSTING rule, the hand register's half of
 * `../handover/cardImage.ts`.
 *
 * An image belongs on the queue card, never as a raw text path. A step already carries its picture as `--shot`
 * with a box on what to grab (`./shot.ts`); a `.png` path in its prose is that picture drawn as text the owner cannot see. Posting only: rows already
 * in the register predate the rule, exactly as `./posting.ts` says of every rule there.
 *
 * Pure: no I/O.
 */
import { namedImageFiles } from "../handover/cardImage.js";

import { type HandStepError, HandStepErrors } from "./errors.js";
import { posterProse } from "./proseFields.js";
import type { HandStep } from "./step.js";

/**
 * The refusal for the first prose field of a step naming a picture file, or `undefined` when none does.
 *
 * @param step the step a caller is about to record
 * @returns the refusal, or `undefined`
 */
export function imageInProse({ step }: { step: HandStep }): HandStepError | undefined {
  for (const { field, text } of posterProse({ step })) {
    const files = namedImageFiles({ text });
    if (files.length > 0) {
      const quoted = files.map((file) => `"${file}"`).join(", ");
      return HandStepErrors.invalidField({
        field,
        why:
          `names the picture ${quoted} as text, which the card draws as a path the owner cannot see — attach it with ` +
          "--shot <png> --box x,y,width,height=<label> so the card shows it with a box on what to grab, and say in " +
          "words what it shows",
      });
    }
  }
  return undefined;
}
