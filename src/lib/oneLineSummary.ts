/**
 * Fitting a subject's free text onto the one summary line a verb's default read gives it. A verb the supervisor tick
 * reads answers with one decision-bearing line per subject and puts the rest behind `--full`; a board row's label is
 * its whole summary, measured at up to 1,637 characters on one `handover reconcile` line (repro:
 * `slopweaver handover reconcile --full`), so the default read cuts it here.
 *
 * Pure.
 */

/**
 * The text with every whitespace run — a line break or a tab included — collapsed to one space and the ends trimmed,
 * so one subject can never print as two lines.
 *
 * U+0085 NEXT LINE is named beside `\s` because JavaScript's `\s` omits it while Unicode counts it a line break
 * (a handover front matter containing one did not round-trip).
 *
 * @returns the normalised text
 */
export function collapseWhitespace({ text }: { text: string }): string {
  return text.replaceAll(/[\s\u0085]+/gu, " ").trim();
}

/**
 * Every character of Unicode general category Cc (controls), Cf (format, the bidi overrides among them), Zl (line
 * separator) or Zp (paragraph separator) — the closed set no printed line may carry raw, since each can break the line,
 * drive the terminal or reorder what a reader sees. A category, never a hand list, so the next such character is
 * already in it (C0, ESC, U+2028 and U+202E each turned up in turn).
 */
export const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/**
 * The text on one line with nothing {@link UNPRINTABLE} left raw: whitespace collapsed as `collapseWhitespace` does,
 * then every remaining such character dropped, so a stored value printed to a terminal can neither break the line,
 * drive the terminal (an ESC sequence clearing the screen, say) nor reorder it (a right-to-left override).
 *
 * @returns the printable text
 */
export function printableOneLine({ text }: { text: string }): string {
  return Array.from(collapseWhitespace({ text }))
    .filter((character) => !UNPRINTABLE.test(character))
    .join("");
}

/**
 * The text on one line, cut to `maxChars` code points with an ellipsis when it was cut — never mid-surrogate, so a cut
 * emoji never becomes a replacement character, and never an ellipsis on text that fit.
 *
 * @param maxChars the most code points the result may hold, the ellipsis included
 * @returns the fitted text
 */
export function fitOnOneLine({ text, maxChars }: { text: string; maxChars: number }): string {
  const points = Array.from(collapseWhitespace({ text }));
  if (points.length <= maxChars) {
    return points.join("");
  }
  return `${points
    .slice(0, maxChars - 1)
    .join("")
    .trimEnd()}…`;
}
