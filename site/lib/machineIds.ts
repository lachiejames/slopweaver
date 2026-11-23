/**
 * The console's copy of the raw machine id criterion — a session, call, talk, turn or run id no card may draw.
 *
 * The owner does not read IDs: they are machine-friendly, not human-friendly. What counts and why is
 * `src/pages/machineIds.ts`'s header. RESTATED because `src/` and `site/` may not import each other;
 * `site/__tests__/unit/machineIdsMirror.test.ts` asserts the two pattern lists are equal, so they cannot drift.
 *
 * Pure: strings in, strings out.
 */

/** Every raw machine id shape, in the order a reader would name them. */
export const MACHINE_ID_PATTERNS: readonly RegExp[] = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /\b(?:turn|call|item|resp|msg|sess|run)_(?=[A-Za-z0-9]*[A-Z0-9])[A-Za-z0-9]{8,}\b/g,
  /\b(?:session|call|talk|turn|run)(?:\s+id)?(?:\s+|\s*[:#]\s*)(?:(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{6,12}|\d{8})\b/gi,
];

/** A URL in prose: the panels draw one as a link, so an id inside it is behind that link. */
const URL_IN_PROSE = /https?:\/\/\S+/g;

/** What a hidden id reads as. */
export const HIDDEN_ID = "[id hidden]";

/**
 * Whether a run of text carries any raw machine id outside a URL.
 *
 * @param text the text a card draws
 * @returns true when any shape matches
 */
export function carriesMachineId({ text }: { text: string }): boolean {
  const prose = text.replace(URL_IN_PROSE, " ");
  return MACHINE_ID_PATTERNS.some((pattern) => new RegExp(pattern.source, pattern.flags).test(prose));
}

/**
 * The text with every raw machine id outside a URL replaced by {@link HIDDEN_ID} — what a REFUSED card still draws
 * in the few places a refusal cannot fold away (its title in the list, its head, its source block), so the refusal
 * that names the id never shows it beside itself.
 *
 * @param text the text a card draws
 * @returns the text, each id hidden and every URL left whole
 */
export function withoutMachineIds({ text }: { text: string }): string {
  let out = "";
  let cursor = 0;
  const hide = (prose: string): string =>
    MACHINE_ID_PATTERNS.reduce(
      (hidden, pattern) => hidden.replace(new RegExp(pattern.source, pattern.flags), HIDDEN_ID),
      prose,
    );
  for (const match of text.matchAll(URL_IN_PROSE)) {
    out += hide(text.slice(cursor, match.index)) + match[0];
    cursor = match.index + match[0].length;
  }
  return out + hide(text.slice(cursor));
}
