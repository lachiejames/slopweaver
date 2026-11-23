/**
 * The two escapes every gated page is built out of — element bodies, and double-quoted attributes.
 *
 * Its own module rather than the top of `./render.ts`, because five other modules already import these two
 * (`../../briefing/cardSubject.ts`, `./sectionQuality.ts`, `./corrections.ts` and their tests) and the
 * renderer had grown past the length at which a reader holds a file in their head — the `file-size-ratchet`
 * gate's own reasoning. This is a real seam and not an arbitrary cut: escaping depends on NOTHING, so the
 * module sits at the bottom of the import graph and can never take part in a cycle.
 *
 * `./render.ts` re-exports both, so every existing caller keeps importing them from where it always did.
 *
 * Pure: one string in, one string out.
 */

/**
 * Escape text destined for an HTML element body.
 *
 * `&` first, or the ampersands the later replacements introduce get double-escaped.
 *
 * @param text the raw caller text
 * @returns the text safe to place inside an element
 */
export function escapeText({ text }: { text: string }): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * Escape text destined for a double-quoted HTML attribute.
 *
 * @param text the raw caller text
 * @returns the text safe to place inside `attr="…"`
 */
export function escapeAttribute({ text }: { text: string }): string {
  return escapeText({ text }).replaceAll('"', "&quot;");
}
