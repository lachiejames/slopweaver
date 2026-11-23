/**
 * Quotation blanking for the checks over what the voice said (`./talkSpokenClaims.ts`, `./talkFleetPromises.ts`,
 * `./talkRepeatedAsk.ts`): a line the voice quotes ("the bug is that it said 'draft sent'") names a claim rather than
 * making one, so every check reads the text with its quotations blanked. Its own module so the fleet-promise check can
 * read it without an import cycle through the spoken-claims fold that calls that check.
 */

/**
 * Whether the character at an index is a letter or digit; `false` past either end.
 *
 * @returns true for a letter or digit at that index
 */
function letterAt({ chars, at }: { chars: readonly string[]; at: number }): boolean {
  const char = at >= 0 && at < chars.length ? chars[at] : undefined;
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

/**
 * The text with every quoted span blanked to spaces, offsets kept. Double quotes pair straight, curly or as guillemets; a single quote
 * opens only at a word's start and closes only at its end, so an apostrophe inside "that's" is neither. A quote with
 * no close blanks to the end: the recognizer splits `The false "draft sent` and `" line is the bug.` into two segments.
 *
 * @returns the text, quotations blanked
 */
export function maskQuotes({ text }: { text: string }): string {
  // UTF-16 units, not code points: a blank replaces one unit, so every offset still indexes the original text.
  const out = text.split("");
  let open: { at: number; double: boolean } | undefined;
  for (let at = 0; at < out.length; at += 1) {
    const char = out[at];
    const letterBefore = letterAt({ at: at - 1, chars: out });
    const letterAfter = letterAt({ at: at + 1, chars: out });
    if (open === undefined) {
      const opensDouble = char === '"' || char === "“" || char === "«";
      const opensSingle = (char === "'" || char === "‘") && !letterBefore && letterAfter;
      if (opensDouble || opensSingle) {
        open = { at, double: opensDouble };
      }
    } else {
      const closesDouble = open.double && (char === '"' || char === "”" || char === "»");
      const closesSingle = !open.double && (char === "'" || char === "’") && letterBefore && !letterAfter;
      if (closesDouble || closesSingle) {
        out.fill(" ", open.at, at + 1);
        open = undefined;
      }
    }
  }
  if (open !== undefined) {
    out.fill(" ", open.at);
  }
  return out.join("");
}
