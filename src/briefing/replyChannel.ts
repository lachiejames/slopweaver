/**
 * The one rule about WHERE a card asks the owner to answer: the supervisor chat, and nowhere else.
 *
 * A react-now card's `options` and `if silent` must not tell the owner to "reply on the DM card" or "reply
 * post", because the owner does not do that. The owner only speaks to the supervisor. Every ruling arrives as
 * a typed line in that one chat, never as a DM reply and never as a react. So an option naming any other
 * channel is not a wording preference; it is an instruction the owner will not follow, which makes the card
 * unanswerable while reading as complete.
 *
 * ## Deliberately over-broad, with the escape written into the shape
 *
 * The criterion is a tell WORD — `reply`, `react`, `DM card` — anywhere in the cell, refused unless that same
 * cell names the supervisor. That will refuse an option that only meant to describe the bot posting a reply
 * somewhere, and that is the trade taken on purpose: the option shape this rule pushes toward is "tell the
 * supervisor <word>", so a correctly-shaped option names the supervisor already and the gate never fires on
 * it. A narrower rule would have to guess whether a tell word addresses the owner or narrates the fleet, and a gate
 * that guesses is the kind prose already was.
 *
 * ## What this does NOT govern
 *
 * The bot's own one-word DM cards keep their DM reply path untouched, because the BOT reads those and acts on
 * the word — no supervisor is in that loop at all. This module is imported only by the briefing form
 * (`../outbound/briefing/schema.ts`, the writer) and the briefing gate (`./reactNowCard.ts`, the reader), the
 * two halves of the one surface the owner actually reads.
 */

/**
 * A channel the owner never answers on, named in a cell that is asking the owner to answer.
 *
 * `react` covers its own inflections but stops at a word boundary, so `reactivate` is not a tell. `DM card`
 * is spelled in full because a bare `DM` is ordinary background — the bot's own DM surface gets named in a
 * `what` all the time — while "on the DM card" is the instruction itself.
 */
const REPLY_CHANNEL_TELL = /\b(?:repl(?:y|ies|ied|ying)|react(?:s|ed|ing|ion|ions)?|DM card)\b/i;

/** The one channel the owner does use, and therefore the one word that makes a tell word legitimate. */
const SUPERVISOR = /\bsupervisor\b/i;

/**
 * The channel word a cell names instead of the supervisor chat, when it names one.
 *
 * @param text the cell's plain text, above the fold
 * @returns the offending word, or `undefined` when the cell routes the owner nowhere but the supervisor chat
 */
export function misroutedReplyChannel({ text }: { text: string }): string | undefined {
  if (SUPERVISOR.test(text)) {
    return undefined;
  }
  return REPLY_CHANNEL_TELL.exec(text)?.[0];
}

/**
 * The shape that replaces a misrouted cell, worded once so the form and the gate cannot drift apart on it.
 *
 * The form states it as a static schema message and the gate appends it to a refusal naming the offending
 * word; both end in the same sentence, which is the one a composer actually acts on.
 */
export const REPLY_CHANNEL_ADVICE = 'The owner only ever answers there, so word it "tell the supervisor <word>".';

/**
 * The gate's refusal for one misrouted cell.
 *
 * @param cell what the composer should go and fix — `option A`, `if silent`
 * @param phrase the offending word {@link misroutedReplyChannel} found
 * @returns one line naming the cell, the word and the shape that replaces it
 */
export function replyChannelRefusal({ cell, phrase }: { cell: string; phrase: string }): string {
  return `${cell} routes the owner to "${phrase}" rather than the supervisor chat. ${REPLY_CHANNEL_ADVICE}`;
}
