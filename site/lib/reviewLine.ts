/**
 * The one line a queue card shows of a message that goes out on the owner's word: what would be sent, cut short.
 *
 * The archive's queue puts "Review before sending:" in front of every draft. Here only two registers carry a
 * message that leaves under the owner's hand — a held reply and a post composed as the owner — and each already stores the
 * text redacted, so this function only flattens and shortens it — and draws each standard Slack shortcode in it as
 * its emoji first (`./slackEmoji.ts`), so the line reads `👍` where Slack would, and is measured as it is drawn. Its one
 * import is that pure module, so the unit lane still reaches it with nothing installed.
 */

import { emojiText } from "./slackEmoji";

/** How many characters of the message the card shows before it cuts at a word. */
export const REVIEW_LINE_CHARS = 140;

/**
 * Flatten a message onto one line and cut it at a word boundary.
 *
 * @param text the register's own text for the message
 * @returns the line, ending in an ellipsis when cut, or `undefined` when the message has no words
 */
export function reviewLineOf({ text }: { text: string }): string | undefined {
  const flat = emojiText({ text }).replace(/\s+/g, " ").trim();
  if (flat === "") {
    return undefined;
  }
  if (flat.length <= REVIEW_LINE_CHARS) {
    return flat;
  }
  const cut = flat.slice(0, REVIEW_LINE_CHARS);
  const space = cut.lastIndexOf(" ");
  let kept = cut;
  if (space > 0) {
    kept = cut.slice(0, space);
  }
  return `${kept}…`;
}
