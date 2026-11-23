/**
 * A text with each line's quoting prefix taken off, and a map from every kept character back to where it came
 * from — so a line-anchored credential pass sees `password: x` in a copy of a file that was quoted line by line.
 *
 * Why it exists: `secret-config` and a block scalar's head only match where a key opens its line. A Claude Code
 * transcript stores every Read result numbered (`3\t  password: x`, or `     3→…`), and a patch prefixes each
 * line with `+` or `-`, so neither fired (a review showed it: the numbered copy of a Read YAML file returned
 * its password and a block scalar's body in clear, and a patch's `+  password: x` did too).
 */
import type { Unescaped } from "./jsonEscapes.js";

/**
 * A line number as a numbered listing or `grep -n` prints it, a quoted reply's `>`s, then a diff's or a combined
 * diff's `+`/`-` that is not the start of `---`/`+++`.
 */
const PREFIX =
  /^(?:[ \t]{0,16}[0-9]{1,9}(?:\t|→)|(?:[^\s:]{1,256}[:-])?[0-9]{1,9}[:-])?(?:>[ \t]?){0,8}(?:[+-]{1,2}(?![+-]))?/u;

/**
 * Take every line's number and diff marker off, keeping everything else as it is.
 *
 * @param text the source, a whole window or context
 * @returns the stripped copy and its origin map, or `undefined` when no line carried a prefix
 */
export function stripLinePrefixes({ text }: { text: string }): Unescaped | undefined {
  let out = "";
  const origin: number[] = [];
  let stripped = false;
  let lineStart = 0;
  while (lineStart <= text.length) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? text.length : newline + 1;
    const line = text.slice(lineStart, lineEnd);
    const width = PREFIX.exec(line)![0].length;
    if (width > 0) {
      stripped = true;
    }
    out += line.slice(width);
    for (let at = lineStart + width; at < lineEnd; at += 1) {
      origin.push(at);
    }
    if (newline === -1) {
      break;
    }
    lineStart = lineEnd;
  }
  origin.push(text.length);
  return stripped ? { origin, text: out } : undefined;
}
