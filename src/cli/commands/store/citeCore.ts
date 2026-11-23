/**
 * The pure core `store cite` renders through — snippet normalisation, and the exact stdout lines.
 *
 * Nothing here touches the network, the model, the clock or the disk, so every line `store cite` prints is
 * testable as a value. The rendering is the whole of what this verb adds over `store query`: a selected
 * record carries the citation token an answer quotes it by, computed by the one
 * {@link ../../../retrieval/citeToken.citeToken} everything else in the tree uses. Two renderings of one
 * corpus is how a citation ends up pointing at the wrong message while looking well-formed.
 */
import { type SubsetManifest, subsetBanner } from "../../../corpus/subset.js";
import type { CorpusRecord } from "../../../corpus/types.js";
import { citeToken } from "../../../retrieval/citeToken.js";

/** The default snippet cap for `store cite` output (chars). */
export const CITE_SNIPPET_CHARS = 200;

/**
 * Normalise a cited snippet: collapse all whitespace runs to single spaces, then cap the length. Pure.
 *
 * @param text the record text
 * @param maxChars the length cap
 * @returns the normalised snippet
 */
export function normaliseCiteSnippet({ text, maxChars }: { text: string; maxChars: number }): string {
  return text.replace(/\s+/g, " ").slice(0, maxChars);
}

/**
 * The exact stdout lines `store cite` prints for a selected slice: `no matching records` when empty, else
 * one block per record (`[source] (token) url`, optional title, snippet, blank separator). The order is the
 * store's own, which is newest first — nothing here sorts and nothing ranks. Pure.
 *
 * @param slice the selected records, in the order the store returned them
 * @param subset the window this home covers, when it is a subset
 * @returns the stdout lines
 */
export function renderCiteLines({
  slice,
  subset,
}: {
  slice: readonly CorpusRecord[];
  subset?: SubsetManifest;
}): readonly string[] {
  const banner = subset === undefined ? [] : [subsetBanner({ manifest: subset }), ""];
  if (slice.length === 0) {
    // The banner matters MOST here. "no matching records" off a subset means "none in this window", and a
    // reader who takes it for "none anywhere" has been misled by an answer that was technically true.
    return [...banner, "no matching records"];
  }
  const lines: string[] = [...banner];
  for (const record of slice) {
    lines.push(`[${record.source}] (${citeToken({ record })}) ${record.url}`);
    if (record.title !== undefined && record.title.length > 0) {
      lines.push(`  ${record.title}`);
    }
    lines.push(`  ${normaliseCiteSnippet({ maxChars: CITE_SNIPPET_CHARS, text: record.text })}`, "");
  }
  return lines;
}
