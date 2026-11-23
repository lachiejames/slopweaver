/**
 * The one definition of "the digest of this answer" — a leaf, so the delivery ladder can stamp a posted first
 * answer's digest (`./turnDelivery.ts`) without importing `./posterAnswer.ts`, which imports `./run.ts` and
 * would close a cycle back up the ladder `../../__tests__/unit/live/turn/turnLayers.test.ts` guards.
 * `./posterAnswer.ts` re-exports it for every existing import site.
 */
import { sha256Text } from "../../lib/hash.js";
import type { AnswerFormAnswer } from "../../outbound/assistant/answerForm.js";

/**
 * The digest a verdict must be bound to: the exact bytes of the answer being sent.
 *
 * Hashed from the composed ANSWER rather than the packaging around it. Chrome, mentions and upload counts
 * are presentation — changing them does not invalidate a review of the words, and making it do so would
 * train people to re-review noise until they stopped reading the result.
 *
 * Exported because the LOOP needs it: to brief a reviewer it must tell it which digest to bind its verdict
 * to, and a second implementation of "the digest of this answer" would drift from this one and refuse every
 * verdict it produced.
 *
 * @param answer the composed answer about to be sent
 * @returns the `sha256:<hex>` digest a `ReviewVerdict` must carry to be about this answer
 */
export function answerDigestOf({ answer }: { answer: AnswerFormAnswer }): string {
  return sha256Text({ text: JSON.stringify(answer) });
}
