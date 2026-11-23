/**
 * Whether the owner's last words end on the code word "over": they are done, and the page asks the voice to take its
 * turn two seconds into the quiet rather than five (`resumeDueOf`, `./voiceActivity.ts`). Asking is not answering: a
 * session that accepts every resume while the voice answers none leaves the owner waiting (`RESUME_MS`). Pure, so the
 * judgement is a test over the owner's real words.
 *
 * Measured: the owner asked for a code word, and the voice answered "Let's use 'over' for when you've finished. I'll
 * recognise that". Nothing did: realtime v3 decides when the owner's turn ends, and `thread/realtime/start` has no
 * turn-detection setting, so the voice could not act on a word until the session had already closed the owner's turn.
 * Twelve minutes later the owner ended on "Over", waited, and broke back in because the voice would not answer the
 * code word. Repro:
 * `jq -r 'select(.kind=="segment" and .who!="voice") | .atIso[11:19] + " " + .text' $SLOPWEAVER_HOME/talk/calls/<call-id>-*.jsonl`.
 *
 * Only the LAST word counts, and a few phrases where "over" is ordinary speech are not the code word. A miss costs
 * little: the owner's words still get the ordinary five-second resume.
 */

/** Everything that may trail the code word: punctuation and whitespace, as the transcript writes them. */
const TRAILING = /[\p{P}\s]+$/u;

/** A last word "over" that is the ordinary phrase, not the hand-off. */
const ORDINARY_OVER = /(?:^|\s)(?:start|game|all|it's|it is|hand it)\s+over$/;

/**
 * Whether the owner's words, as heard so far, end on the code word "over".
 *
 * @param text the owner's words, newest last; only the end is read
 * @returns true when the last word is "over" and not one of the ordinary phrases ending on it
 */
export function endsOnOver({ text }: { readonly text: string }): boolean {
  const words = text.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").replace(TRAILING, "");
  if (!/(?:^|[\s\p{P}])over$/u.test(words)) {
    return false;
  }
  return !ORDINARY_OVER.test(words);
}
