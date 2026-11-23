/**
 * Line positions for the transient-reference gate's findings: which line an offset sits on, and that line as a
 * one-line preview. Kept apart from the patterns so each module stays one responsibility.
 */

/** The longest preview a finding line carries, so one finding stays one line. */
const MAX_PREVIEW_CHARS = 90;

/**
 * Where each line of a text starts and what it says, across every line break a file can carry: CRLF is one, and a
 * lone CR ends a line too. Pure.
 *
 * @param content the file's text
 * @returns each line's text, and every line-start offset in ascending order
 */
export function lineTable({ content }: { content: string }): {
  readonly lines: readonly string[];
  readonly lineStarts: readonly number[];
} {
  const lineStarts: number[] = [0];
  for (const lineBreak of content.matchAll(/\r\n|\r|\n/gu)) {
    lineStarts.push(lineBreak.index + lineBreak[0].length);
  }
  return { lineStarts, lines: content.split(/\r\n|\r|\n/u) };
}

/**
 * The 1-based line an offset sits on, and that line as a clipped single-line preview. Pure.
 *
 * @param table the file's {@link lineTable}
 * @param offset a character offset into the same file
 * @returns the line number and its preview
 */
export function lineAt({
  table,
  offset,
}: {
  table: { readonly lines: readonly string[]; readonly lineStarts: readonly number[] };
  offset: number;
}): { readonly line: number; readonly preview: string } {
  let low = 0;
  let high = table.lineStarts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (table.lineStarts[mid]! <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  const collapsed = table.lines[low]!.replace(/\s+/gu, " ").trim();
  const preview = collapsed.length <= MAX_PREVIEW_CHARS ? collapsed : `${collapsed.slice(0, MAX_PREVIEW_CHARS - 3)}...`;
  return { line: low + 1, preview };
}
