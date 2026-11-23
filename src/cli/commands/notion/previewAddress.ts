/**
 * How a `notion` dry run names a page address: a leaf with no imports, so the page, move and attach previews
 * and the archive preview in `pageRun.ts` all print one wording without importing each other.
 */

/**
 * The address a dry run names: the id the address resolved to, else the address exactly as the operator
 * typed it, else `(unresolved)`. A dry run never needs the address to resolve — it previews, and the
 * unresolved word is how it says the live run would refuse.
 *
 * @param resolved the page id the address resolved to, or `undefined` when it did not resolve
 * @param typed the `--page`/`--to` value as given, or `undefined` when the preview has none to show
 * @returns the address words to print after the line's label
 */
export function previewAddress({
  resolved,
  typed,
}: {
  resolved: string | undefined;
  typed: string | undefined;
}): string {
  if (resolved !== undefined) {
    return resolved;
  }
  if (typed !== undefined) {
    return typed;
  }
  return "(unresolved)";
}
