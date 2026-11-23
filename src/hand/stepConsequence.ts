/**
 * The step's do-nothing line — what happens if the owner leaves the card alone, and what they might not like about it.
 *
 * What a card must answer is not only what it unblocks but what happens if the owner does nothing. An incident
 * read stalling is a card the owner signs in on now; routine freshness is one they can leave. `unblocks`
 * names WHAT waits; this names the COST of the wait, which is how the owner ranks the card. Its own module because
 * `./step.ts` is near its size ratchet, and the line is checked on its own terms.
 */
import { err, ok, type Result } from "../lib/result.js";

import { type HandStepError, HandStepErrors } from "./errors.js";
import type { HandStep } from "./step.js";
import { requiredText } from "./stepText.js";

/** How long the do-nothing line may be — the same surface as `unblocks`, so the same cap. */
export const IF_IGNORED_CAP = 200;

/**
 * The do-nothing line, checked as a capped sentence — or as honestly absent — and returned as a piece to spread, the
 * way `./stepAttachments.ts` returns each of its own, so a step drops the key rather than writing `undefined`.
 *
 * A present empty string is refused rather than folded into absence, and a present non-string is a corrupt register
 * line named as one, for `./stepAddress.ts`'s unaddressed check's reason: `--if-ignored ""` meant to say something.
 *
 * @param value whatever the caller or the register line carried
 * @returns the trimmed line as `{ ifIgnored }`, `{}` when the field was absent, or the refusal
 */
export function checkedIfIgnored({ value }: { value: unknown }): Result<Pick<HandStep, "ifIgnored">, HandStepError> {
  if (value === undefined) {
    return ok({});
  }
  if (typeof value !== "string") {
    return err(
      HandStepErrors.invalidField({
        field: "ifIgnored",
        why: "is a sentence saying what happens if the owner does nothing, or absent — `hand post --if-ignored` is the only thing that writes it",
      }),
    );
  }
  return requiredText({ cap: IF_IGNORED_CAP, field: "ifIgnored", value }).map((ifIgnored) => ({ ifIgnored }));
}
