/**
 * A JSONL journal file's lines, parsed one by one: what the one-time import of `resume.jsonl` and
 * `cmux-revive.jsonl` reads, and what their pure parsers decode. Pure: text in, values out.
 */

/** One non-blank line: its 1-based number in the file, and its JSON — `undefined` when it was not JSON. */
export interface JsonlValue {
  readonly line: number;
  readonly value: unknown;
}

/**
 * One line's JSON.
 *
 * @param line the line's text, already known not to be blank
 * @returns the parsed value, or `undefined` when the line is not JSON
 */
export function jsonLineValue({ line }: { line: string }): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/**
 * Parse every non-blank line of a JSONL text, keeping each one's line number and never its text.
 *
 * @param text the file's contents
 * @returns one entry per non-blank line, in order; a line that is not JSON carries an `undefined` value
 */
export function jsonlValues({ text }: { text: string }): readonly JsonlValue[] {
  const values: JsonlValue[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() !== "") {
      values.push({ line: index + 1, value: jsonLineValue({ line }) });
    }
  }
  return values;
}
