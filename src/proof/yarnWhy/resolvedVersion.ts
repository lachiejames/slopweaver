/**
 * Parsing the plain-text `yarn why <dependency>` output down to the version(s) that matter: every
 * distinct `<name>@npm:<version>` the dependency tree actually settled on, or the literal absence of one.
 *
 * Every distinct version, not just the first: a widely-depended-on package in a real monorepo resolves to
 * SEVERAL coexisting versions at once (measured live against `@clerk/shared` — 1.4.2, 3.22.0 and 4.15.0 all
 * present simultaneously). Taking only the first match picked an unrelated, unchanged version and reported
 * "unchanged" on a pair whose screenshot plainly showed the vulnerable range fixed — the caption must reflect
 * the same full picture the tree does, or it can contradict the very screenshot it capions.
 *
 * Kept separate from the terminal-capture flow: the screenshot is the human-facing proof, but the pair's
 * "resolved:" caption and the changed/unchanged verdict need a real string to compare, not a screen scrape.
 */

/** The caption shown when a dependency does not appear in the tree at all. */
export const NOT_PRESENT = "not present";

/**
 * Extract every distinct resolved `<dependency>@npm:<version>` fragment from `yarn why`'s plain-text tree
 * output, sorted for a stable, comparable caption.
 *
 * @param output the raw stdout of `yarn why <dependency>` (berry's tree format)
 * @param dependency the dependency name the tree was queried for
 * @returns the distinct fragments joined by `, `, or {@link NOT_PRESENT} when the tree is empty
 */
export function extractResolvedVersion({ output, dependency }: { output: string; dependency: string }): string {
  const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}@npm:[^\\s]+`, "g");
  const matches = new Set(Array.from(output.matchAll(pattern), (match) => match[0]));
  return matches.size === 0 ? NOT_PRESENT : [...matches].toSorted().join(", ");
}
