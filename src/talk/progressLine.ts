/**
 * A HISTORICAL recognizer: the words of the progress line the console once spoke while a delegated turn ran, as a
 * voice transcript renders them, and finding them inside an answer, whoever said them (a transcript does not record
 * that) — the matcher half of `./scriptedCutIns.ts`, which reads older calls. The console stopped speaking the line
 * on the owner's word, and plays a sound instead (`site/lib/orbCue.ts`), so nothing
 * here describes the console now; {@link PROGRESS_SPEECH_RETIRED_ISO} bounds what can still be attributed to it. Kept
 * free of imports so `site/__tests__/unit/scriptedSpeechMirror.test.ts` can bind it to the console without the site
 * lane resolving this tree's dependencies.
 */

/**
 * The openers the console's progress line rotated through until {@link PROGRESS_SPEECH_RETIRED_ISO}, kept verbatim so
 * older calls still read; `site/__tests__/unit/scriptedSpeechMirror.test.ts` holds the console to never scripting one
 * again.
 */
export const PROGRESS_OPENERS_MIRROR: readonly string[] = [
  "This is taking longer than I expected.",
  "Still with you.",
  "Still going on this one.",
  "This one's slow.",
];

/** The clauses that followed an opener, one per kind of step the running turn last showed, kept for the same reason. */
export const PROGRESS_CLAUSES_MIRROR: readonly string[] = [
  "I'm still working on it.",
  "I'm still thinking it through.",
  "I'm writing some of it up.",
  "I'm still looking into it.",
];

/**
 * `site/lib/planCallContract.ts`'s `PLAN_CALL_LIMITS.progressFirstMs`, bound by the same test: the earliest a progress
 * line was said after a delegated turn started — and the earliest its sound plays now, on the same cadence.
 */
export const PROGRESS_FIRST_MS_MIRROR = 15_000;

/**
 * When the spoken progress line stopped: a stretch of running turns starting at or after this is never read as having
 * had the console speak one, so the voice saying those words itself later is never counted as the console's. A
 * judgement: the day after the change was written, so that day's calls on the older code still count,
 * and a call on a console not yet updated after it goes uncounted — the count leans low rather than guessing.
 */
export const PROGRESS_SPEECH_RETIRED_ISO = "2026-10-15T00:00:00Z";

/**
 * The earliest a progress line was said before {@link PROGRESS_FIRST_FROM_ISO}: the whole cadence, 30s. A stretch of
 * running turns is judged by when it started, so the history drawn before then stays as it was counted.
 */
export const PROGRESS_FIRST_BEFORE_MS = 30_000;

/**
 * When the first progress line moved to {@link PROGRESS_FIRST_MS_MIRROR}, on the owner's steer. A
 * call on the console's older code after it may count a line 15–30s in that the console could not have said; only
 * words it scripts match, so that residue is the voice saying them itself.
 */
export const PROGRESS_FIRST_FROM_ISO = "2026-10-10T00:00:00Z";

/**
 * `site/lib/planCallContract.ts`'s `PLAN_CALL_LIMITS.lifetimeMs`, bound by the same test: no call outlives it, so no
 * turn in one could have had the console speak past it either, recorded end or not.
 */
export const CALL_LIFETIME_MS_MIRROR = 90 * 60_000;

/** Straight apostrophes, single spaces: the voice's transcript writes both kinds. */
function normalised({ text }: { text: string }): string {
  return text.replaceAll(/[‘’]/gu, "'").replaceAll(/\s+/gu, " ").trim();
}

/** A literal as a regular-expression source. */
function escaped({ text }: { text: string }): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** A line without its closing punctuation, so "Still with you," matches "Still with you.". */
function stem({ line }: { line: string }): string {
  return line.replace(/[.!?]+$/u, "");
}

/**
 * A progress line anywhere — the reported words landed mid-sentence, "Next card is Sorry, this one's slow." — with the
 * retired "Sorry, " in front or not (its comma, or the space after that comma, may be dropped, so a "Sorry" just before the opener is read as the
 * line's own, never the voice's), the opener's punctuation a full stop, a comma, any dash (Unicode dash punctuation) or none, as the transcript
 * of speech may drop it: the opener and clause together are the evidence. Both are whole words: never
 * after a letter or digit ("NotStill", "2This"), and never run into each other ("youI'm"). The clause may end on a
 * comma rather than its full stop, since the voice has run straight on into its answer after "I'm writing some of that
 * up ,". These are the renderings read, and the only ones: a transcript rendering the line
 * any other way goes uncounted, so the count leans low rather than guessing.
 */
const PROGRESS_LINE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:sorry(?:, ?| ))?(?:${PROGRESS_OPENERS_MIRROR.map((line) => escaped({ text: stem({ line }) })).join("|")})(?:[.,] ?| ?\\p{Pd} ?| )(?:${PROGRESS_CLAUSES_MIRROR.map((line) => escaped({ text: stem({ line }) }).replace(/\bit\b/u, "(?:it|that|this)")).join("|")})(?=\\s*(?:[.!?,]|$))[.!?]?`,
  "giu",
);

/**
 * The first progress line a voice segment holds after words of its own, if any. Every line is tried, not only the
 * first: a segment can open on one said in a silence and carry a real cut-in later, and a progress line
 * earlier in the segment is not the voice's own words. A word is any letter or digit, since a transcript renders a
 * spoken number as numerals ("42."); punctuation alone is not one.
 *
 * @param text the segment's whole text
 * @returns the line and the words before it, or `undefined` when the segment holds none after words of its own
 */
export function cutInOf({ text }: { text: string }): { readonly line: string; readonly before: string } | undefined {
  const flat = normalised({ text });
  // The lines are found once over the whole segment, never re-matched inside a cut-off prefix, where words that are
  // not a line in the segment could end the prefix and read as one.
  let afterLast = 0;
  for (const found of flat.matchAll(PROGRESS_LINE)) {
    if (/[\p{L}\p{N}]/u.test(flat.slice(afterLast, found.index))) {
      return { before: flat.slice(0, found.index).trim(), line: found[0].trim() };
    }
    afterLast = found.index + found[0].length;
  }
  return undefined;
}
