/**
 * What a rendered policy PDF's text looks like when `policy render` reads it back: positioned runs, grouped
 * into the lines the page laid out.
 *
 * ## Why this is a separate layer from `pdf/text.ts`
 *
 * That module answers "which policy mentions contractors" and joins `pdfjs` items on `hasEOL`, keeping only
 * the string. This one keeps each run's glyph height and left edge, so a zero-height positioning item never
 * opens or ends a line and a hanging indent's leftmost glyph is still the line's left edge. The read-back
 * check in `verify.ts` compares the characters of these lines with the markdown's.
 *
 * Everything here is pure, and that is the point: the effectful half is one `pdfjs` read in
 * `extract.ts`, and every judgement made about the result is settled by a unit test over plain data.
 */

/** One run of glyphs the page laid out, with the three facts its structure is recoverable from. */
export interface PolicyTextRun {
  readonly text: string;
  /** The `pdfjs` font handle — stable within one document, meaningless across two. */
  readonly fontName: string;
  /** The glyph height in PDF units. Zero for a positioning-only item, which carries no glyphs. */
  readonly height: number;
  /** The left edge of the run, in PDF units from the page's left. */
  readonly x: number;
  /** How wide the run is, in PDF units — with {@link x}, where the next run would have to start to touch it. */
  readonly width: number;
  /** The baseline, in PDF units from the page's BOTTOM — so a later line has a SMALLER y. */
  readonly y: number;
  /** Whether the page's own layout ended a line here. */
  readonly endsLine: boolean;
}

/** One laid-out line, and what the page's geometry says about it. */
export interface PolicyLine {
  /** The line's text, runs concatenated, exactly as the page laid it out. */
  readonly text: string;
  /** The tallest glyph height on the line — what separates a heading from a sentence. */
  readonly height: number;
  /** The line's left edge — what separates a list item from a paragraph. */
  readonly x: number;
  /** The line's baseline. */
  readonly y: number;
  /** Which page the line came from, one-based. */
  readonly page: number;
  /** The font of the line's first glyph-bearing run, so a bold lead-in is recognisable. */
  readonly fontName: string;
  /**
   * The left edge of every glyph-bearing run on the line, in reading order.
   *
   * The only thing that survives here from which a TABLE ROW is recognisable. A table row reaches this
   * layer as one line — its cells share a baseline, so the page's own layout ends the line once — and the
   * cells are then indistinguishable from words. The SPACE between them is not: a row's cells are separated
   * by whitespace a sentence never contains.
   *
   * Each entry is the distance from one run's right edge to the next run's left edge — never the distance
   * between their left edges, which is just how long the first run was. Measured on the AI acceptable use
   * policy, one ordinary sentence's two runs start 418 units apart while touching end to end.
   */
  readonly runGaps: readonly number[];
}

/** One page's runs, as `extract.ts` read them. */
export interface PolicyPageRuns {
  readonly page: number;
  readonly runs: readonly PolicyTextRun[];
}

/** The whitespace between each run and the one before it: `next.x - (previous.x + previous.width)`. */
function runGapsOf({ runs }: { runs: readonly PolicyTextRun[] }): readonly number[] {
  const gaps: number[] = [];
  for (let index = 1; index < runs.length; index += 1) {
    const previous = runs[index - 1]!;
    const current = runs[index]!;
    gaps.push(Math.round((current.x - (previous.x + previous.width)) * 10) / 10);
  }
  return gaps;
}

/** A run carries glyphs when it has a height; a zero-height item is `pdfjs` moving the cursor. */
function bearsGlyphs({ run }: { run: PolicyTextRun }): boolean {
  return run.height > 0;
}

/**
 * Fold one page's runs into the lines the page laid out.
 *
 * A line ends where the layout said it ends. Its height is the TALLEST glyph on it rather than the first,
 * because a heading whose first run is a zero-height positioning item would otherwise be read as body text;
 * its left edge is the smallest `x` of a glyph-bearing run, because `pdfjs` emits a line's runs in reading
 * order but a hanging indent puts the leftmost glyph second.
 *
 * @param page the one-based page number these runs came from
 * @param runs the page's runs, in reading order
 * @returns the page's lines, in order, with every empty line dropped
 */
export function linesFromRuns({ page, runs }: { page: number; runs: readonly PolicyTextRun[] }): readonly PolicyLine[] {
  const lines: PolicyLine[] = [];
  let pending: PolicyTextRun[] = [];
  const flush = (): void => {
    const glyphs = pending.filter((run) => bearsGlyphs({ run }));
    const text = pending.map((run) => run.text).join("");
    pending = [];
    if (glyphs.length === 0 || text.trim().length === 0) {
      return;
    }
    const heights = glyphs.map((run) => run.height);
    const xs = glyphs.map((run) => run.x);
    const ys = glyphs.map((run) => run.y);
    lines.push({
      fontName: glyphs[0]!.fontName,
      height: Math.max(...heights),
      page,
      runGaps: runGapsOf({ runs: glyphs }),
      text,
      x: Math.min(...xs),
      y: Math.max(...ys),
    });
  };
  for (const run of runs) {
    pending.push(run);
    if (run.endsLine) {
      flush();
    }
  }
  flush();
  return lines;
}

/**
 * Every page's lines, in document order.
 *
 * @param pages each page's runs, in page order
 * @returns one flat line list, page boundaries preserved only in each line's own `page`
 */
export function linesFromPages({ pages }: { pages: readonly PolicyPageRuns[] }): readonly PolicyLine[] {
  return pages.flatMap((entry) => linesFromRuns({ page: entry.page, runs: entry.runs }));
}
