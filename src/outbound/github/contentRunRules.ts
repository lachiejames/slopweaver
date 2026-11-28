/**
 * The one rule a cell's run LIST is held to on a write: no two text runs side by side.
 *
 * Both renderers write a text run as its bare characters, so `[text "a", text "b"]` and `[text "ab"]` produce the
 * same bytes, and both readers (`./authoringInline.ts`, `./parseContent.ts`) read one uninterrupted stretch of plain
 * text back as ONE run. A form carrying the first spelling therefore came back as the second, from the authoring file
 * and the HTML body alike. Refusing it on the write leaves each cell exactly one spelling, so every read-back is the
 * form that was written, run for run.
 *
 * It is a refusal and not a merge: merging on the write would hand the author back a form they did not write. The
 * read schemas stay tolerant, so a form already stored with two adjacent runs still reads; its next write is refused
 * until that cell is merged.
 *
 * Any other run between two text runs, an image included, is a real boundary: the readers flush the text at it.
 */

/** A form path, as a schema issue spells it. */
type RunPath = readonly (string | number)[];

/** One pair of adjacent text runs: where the second run sits, and what to do about it. */
export interface AdjacentTextRunIssue {
  readonly path: RunPath;
  readonly message: string;
}

/**
 * Every pair of adjacent text runs in one cell, each addressed at the pair's second run.
 *
 * @param content the cell's runs; only each run's kind is read
 * @param path the cell's own form path, which each issue extends with the second run's index
 * @returns one issue per adjacent pair, none when the cell has a single spelling
 */
export function adjacentTextRunIssues({
  content,
  path,
}: {
  content: readonly { readonly kind: string }[];
  path: RunPath;
}): readonly AdjacentTextRunIssue[] {
  return content.flatMap((run, index): AdjacentTextRunIssue[] => {
    if (index === 0 || run.kind !== "text" || content[index - 1]!.kind !== "text") {
      return [];
    }
    return [
      {
        message:
          `text runs at indices ${String(index - 1)} and ${String(index)} are adjacent and render as one run. ` +
          "Merge them into one text run",
        path: [...path, index],
      },
    ];
  });
}
