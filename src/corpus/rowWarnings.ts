/**
 * Per-file collapse of the corpus reader's rejected lines: one warning per distinct finding, carrying its
 * count, rather than one per row.
 *
 * Split out of `./corpusStore` rather than living beside the parse it serves, because the two answer
 * different questions and the file-size ratchet was right to say so: `corpusStore` decides whether a row is
 * admissible, and this decides how a file's rejections are REPORTED. Pure — no I/O, no clock.
 */

/** How many line numbers a collapsed warning names before it stops listing and says how many are left. */
const COLLAPSE_LINE_SAMPLE = 3;

/** One rejected line, kept apart from its message so a file's rejections can be grouped by what went wrong. */
export interface RowWarning {
  readonly line: number;
  readonly error: string;
}

/**
 * Collapse one FILE's rejected lines into one warning per distinct message, naming the count and where it
 * first fired. Pure.
 *
 * The count is the point. 447 identical lines are not 447 findings, and a diagnostic reprinted once per row
 * by every verb that loads the corpus becomes furniture nobody reads — which is precisely how these went
 * unexamined long enough to be described in canon as a different defect than they were. Measured on the
 * owner's bronze tree: 447 lines across 9 files become 9.
 *
 * Grouped by the MESSAGE rather than the skip class, so `empty required field: text` and `empty required
 * field: container` stay two findings; they are two different connector bugs.
 *
 * @param warnings one file's rejected lines, in file order
 * @returns one line per distinct message, in first-seen order
 */
export function collapseRowWarnings({ warnings }: { warnings: readonly RowWarning[] }): readonly string[] {
  const byError = new Map<string, number[]>();
  for (const warning of warnings) {
    const lines = byError.get(warning.error);
    if (lines === undefined) {
      byError.set(warning.error, [warning.line]);
      continue;
    }
    lines.push(warning.line);
  }
  return [...byError].map(([error, lines]) => {
    const shown = lines.slice(0, COLLAPSE_LINE_SAMPLE).map((line) => String(line));
    const rest = lines.length - shown.length;
    const more = rest > 0 ? `, +${String(rest)} more` : "";
    return `${String(lines.length)} row(s) rejected: ${error} (line ${shown.join(", ")}${more})`;
  });
}
