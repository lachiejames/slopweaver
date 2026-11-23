/**
 * An `aria-describedby` value is a space-separated list of ids, and more than one component can add to the same
 * control's list: a Queue row is one `<button>` that may hold several warning marks, each lending the row its own raw
 * message as a description (`../components/console/WarningMark.tsx`). So each mark adds and removes ITS id only, never
 * the whole attribute, and these two functions are that edit, kept pure so the site lane can test it without a DOM.
 */

/** The ids a describedby value lists, in order, with no empty token. */
function tokensOf({ value }: { value: string | null }): readonly string[] {
  if (value === null) {
    return [];
  }
  return value.split(/\s+/u).filter((token) => token.length > 0);
}

/**
 * A describedby value with one id added at its end, once: an id already listed is not listed twice.
 *
 * @param value the control's attribute as it stands, `null` when it has none
 * @param id the description element's id to add
 * @returns the attribute to set
 */
export function describedByWith({ value, id }: { value: string | null; id: string }): string {
  const tokens = tokensOf({ value });
  if (tokens.includes(id)) {
    return tokens.join(" ");
  }
  return [...tokens, id].join(" ");
}

/**
 * A describedby value with one id taken out, every other id kept in order; `null` when none is left, so the caller
 * removes the attribute rather than leaving an empty one.
 *
 * @param value the control's attribute as it stands, `null` when it has none
 * @param id the description element's id to remove
 * @returns the attribute to set, or `null` to remove it
 */
export function describedByWithout({ value, id }: { value: string | null; id: string }): string | null {
  const kept = tokensOf({ value }).filter((token) => token !== id);
  if (kept.length === 0) {
    return null;
  }
  return kept.join(" ");
}
