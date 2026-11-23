/**
 * The links `slack draft record` would derive as receipts off a drip `--form` a verb composes for it.
 *
 * A verb that records through that path and declares its own receipts (`github reviewer pick`'s ask,
 * `workstreams loop-in`) may declare nothing only when the recorder will find a link, or the recorder refuses what it
 * should park. Judging that by a prefix match on the address a verb meant to link was wrong three ways in one review:
 * the drip parse turns a bare address in the text into a link, `mailto:` becomes a link that is no receipt, and an
 * address with only a scheme fails the parse outright. So this asks the parse itself, then the recorder's own
 * `receiptLinks`, and a verb declares from the answer.
 *
 * **It is a lower bound, and that is the property a caller needs.** The record path goes on to link a bare reference
 * it can resolve (a Linear key, through the operator's own context) and never removes a link the parse made, so a link
 * found here is a link the recorder finds. A verb that finds none and declares `--tried` still parks if the recorder
 * then adds one: `receiptsOfRecording` keeps it as `attached` with what was tried beside it. The one refusal, a card
 * that declares nothing and carries nothing, is the one a caller here cannot reach.
 *
 * **It answers about receipts, never whether the draft fits.** The length caps are left out on purpose: an opener over
 * the operator's visible cap is refused for its length, as it was before receipts existed, and the outbound rule is
 * that a form refuses rather than truncates. So a form this parses can still be refused, but never for its receipts.
 *
 * Pure. No network, no clock, no filesystem.
 */
import { safeJsonParse } from "#lib/safeJson.js";

import { dripArtifactSchema } from "../artifact/asMeSchema.js";

import { receiptLinks } from "./draftReceipts.js";

/**
 * Length caps the operator's profile sets; they bound visible characters and message count, never which run is a
 * link, so a parse here judges links exactly as the recorder's does without reading the profile.
 */
const UNBOUNDED = Number.MAX_SAFE_INTEGER;

/**
 * The receipt links the recorder derives off this drip form at least, after the form's own parse.
 *
 * @param form the `--form` JSON a verb composed
 * @returns the derived links, every one of which the recorder also finds, or `undefined` when the form does not parse,
 *   where the recorder refuses it on the form
 */
export function formReceiptLinks({ form }: { form: string }): readonly string[] | undefined {
  const parsed = dripArtifactSchema({ maxMessages: UNBOUNDED, messageVisibleMax: UNBOUNDED }).safeParse(
    safeJsonParse({ label: "a composed draft form", text: form }),
  );
  if (!parsed.success) {
    return undefined;
  }
  return receiptLinks({ payload: parsed.data });
}
