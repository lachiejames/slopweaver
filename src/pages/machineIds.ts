/**
 * A RAW MACHINE ID in text the owner reads — a session, call, talk, turn or run id — which no page or card may show.
 *
 * Ids are machine friendly, not human friendly, so the owner does not read them. So a page or card names a session by what it was doing, with the
 * id behind a link or a hover (`title=`) at most. This module is the one criterion; `./identifiers.ts` applies it to
 * a published page, and `site/lib/machineIds.ts` restates it for the console's card form, pinned equal by
 * `site/__tests__/unit/machineIdsMirror.test.ts`.
 *
 * ## What counts, and what deliberately does not
 *
 * Three shapes, each narrow enough that ordinary prose never matches:
 *
 * - a UUID — every Claude session id, and the halves of a `transcript:` anchor;
 * - a provider's prefixed opaque id — `turn_<opaque>`, `call_…`, `resp_…` — whose tail carries a
 *   capital or a digit, so a snake_case word such as `turn_detection` or `run_migrations` is prose;
 * - a short hex id NAMED as one — `call <8-hex>`, `talk:<8-hex>`, `run <8-hex>` — where the word before it
 *   says what it is and the token carries both a digit and a hex letter, or is exactly eight digits (the one in
 *   forty short session ids that has no letter), so "the session facade" is prose and so is
 *   a call followed by a phone number or a run followed by a CI run number, which a reader looks up by it.
 *
 * A commit SHA alone is NOT one of these: it is an anchor a reader of a pull request card is expected to check,
 * and nothing in the owner's ruling names it. A future ruling that does widens this list, here and in the restated copy.
 */

/** Every raw machine id shape, in the order a reader would name them. */
export const MACHINE_ID_PATTERNS: readonly RegExp[] = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /\b(?:turn|call|item|resp|msg|sess|run)_(?=[A-Za-z0-9]*[A-Z0-9])[A-Za-z0-9]{8,}\b/g,
  /\b(?:session|call|talk|turn|run)(?:\s+id)?(?:\s+|\s*[:#]\s*)(?:(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{6,12}|\d{8})\b/gi,
];

/**
 * Every raw machine id in a run of text, each reported once, in the order first seen. Where two shapes match the
 * same characters — `Session <8-hex>-…` holds a named hex id inside a UUID — the shape listed first in
 * {@link MACHINE_ID_PATTERNS} is the one reported, so the whole UUID is named rather than its first eight digits.
 *
 * @param text the text a reader sees
 * @returns the ids as written, the naming word included for a short hex id
 */
export function machineIdsIn({ text }: { text: string }): readonly string[] {
  const kept: { readonly start: number; readonly end: number; readonly raw: string }[] = [];
  for (const pattern of MACHINE_ID_PATTERNS) {
    // A fresh copy, as the console's does: `matchAll` starts from the shared pattern's `lastIndex`.
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      const start = match.index;
      const end = start + match[0].length;
      if (kept.every((other) => end <= other.start || start >= other.end)) {
        kept.push({ end, raw: match[0], start });
      }
    }
  }
  return [...new Set(kept.toSorted((left, right) => left.start - right.start).map(({ raw }) => raw))];
}

/** A URL in prose — a card draws one as a link, so an id inside it is behind that link. */
const URL_IN_PROSE = /https?:\/\/\S+/g;

/**
 * Whether a Queue card's prose carries a raw machine id outside a URL — the console card gate's own test
 * (`site/lib/machineIds.ts` `carriesMachineId`), for a reader in `src/` deciding whether that card was ever drawn.
 *
 * @param text the prose a card draws
 * @returns true when any id sits outside a URL
 */
export function carriesMachineId({ text }: { text: string }): boolean {
  return machineIdsIn({ text: text.replace(URL_IN_PROSE, " ") }).length > 0;
}
