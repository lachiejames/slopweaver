/**
 * Which characters of a published text are the AUTHOR'S prose, as one same-length mask.
 *
 * The publication scan (`./publicationScan.ts`) judges wording — first person, host wording — only where the
 * author is speaking. Code is an identifier, a link target is an address, and a quotation is somebody else's
 * words, so each of those is blanked to spaces here and the wording rules never see it. A newline is always
 * kept, so a line number read off the mask is a line number in the original text, and each blanked run
 * contributes spaces rather than nothing, so two words either side of a skipped run never weld together.
 *
 * What counts as not-prose, in the order it is blanked (later passes run over the earlier ones' output):
 *
 * - a fenced code block (three or more backticks or tildes, closed by the same character, at least as long);
 * - a blockquote line (`>`), except a GitHub alert block (`> [!NOTE]`), which is authored prose under a marker;
 * - an inline code span (a backtick run closed by a run of exactly the same length, inside one paragraph),
 *   a `<code>`/`<pre>` element, and an HTML comment;
 * - an HTML tag's own markup — but a `title`, `alt` or `aria-label` attribute value is published text a reader
 *   sees on hover, so it is RESTORED as prose;
 * - a Markdown link or image TARGET (the `(…)` after `]`), a reference definition, and an autolink;
 * - a bare URL;
 * - a double-quoted span on one line, straight or curly.
 *
 * Single quotes are deliberately not a quote: an apostrophe is the same character, so `the owner's` would open
 * a span that never closes. A quotation in published text uses double quotes or a blockquote.
 */

/** A matched region of the text, half-open. */
interface Span {
  readonly start: number;
  readonly end: number;
}

/** A fence opener or closer: three or more backticks or tildes at the start of a line. */
const FENCE = /^\s{0,3}(`{3,}|~{3,})/u;

/** A blockquote line, and the GitHub alert marker that turns a blockquote run into authored prose. */
const BLOCKQUOTE = /^\s{0,3}>/u;
const ALERT_OPENER = /^\s{0,3}>\s*\[![A-Za-z]+\]/u;

/** An inline code span: a backtick run closed by a run of the same length, never across a blank line. */
const INLINE_CODE = /(?<!`)(`+)(?!`)((?:(?!\n[ \t]*\n)[\s\S])*?)(?<!`)\1(?!`)/gu;

/** An element whose whole content is code, and an HTML comment. */
const CODE_ELEMENT = /<(code|pre)\b[^>]*>[\s\S]*?<\/\1\s*>/giu;
const HTML_COMMENT = /<!--[\s\S]*?-->/gu;

/** One HTML tag, opening, closing or self-closing. */
const HTML_TAG = /<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>/gu;

/** The attribute values inside a tag a reader actually sees: a hover title, an image's alt text, a label. */
const VISIBLE_ATTRIBUTE = /\b(?:title|alt|aria-label)\s*=\s*(?:"([^"]*)"|'([^']*)')/giu;

/** A Markdown link or image target, a reference definition line, and an autolink. */
const LINK_TARGET = /\]\((?:[^()\n]|\([^()\n]*\))*\)/gu;
const REFERENCE_DEFINITION = /^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*\S.*$/gmu;
const AUTOLINK = /<[A-Za-z][A-Za-z0-9+.-]*:[^\s<>]*>/gu;

/** A bare URL. */
const BARE_URL = /\b(?:https?|ftp):\/\/[^\s<>()]+/giu;

/** A double-quoted span on one line, straight or curly. */
const DOUBLE_QUOTED = /"[^"\n]*"|“[^”\n]*”/gu;

/** Blank one region in place, keeping every newline. */
function blank({ chars, span }: { chars: string[]; span: Span }): void {
  for (let index = span.start; index < span.end; index += 1) {
    if (chars[index] !== "\n") {
      chars[index] = " ";
    }
  }
}

/** Every match of a global pattern over the current mask, as spans. */
function spansOf({ text, pattern }: { text: string; pattern: RegExp }): readonly Span[] {
  return [...text.matchAll(pattern)].map((match) => ({ end: match.index + match[0].length, start: match.index }));
}

/** Blank every match of a pattern over the mask as it stands. */
function blankAll({ chars, pattern }: { chars: string[]; pattern: RegExp }): void {
  for (const span of spansOf({ pattern, text: chars.join("") })) {
    blank({ chars, span });
  }
}

/** Where a fence opened: its character and length, so only a matching closer ends it. */
interface OpenFence {
  readonly char: string;
  readonly length: number;
}

/** Whether a fence marker closes the open fence. */
function closesFence({ open, marker }: { open: OpenFence; marker: string }): boolean {
  return marker[0] === open.char && marker.length >= open.length;
}

/** Whether one line's characters are code or quotation, given the fence and blockquote state before it. */
interface LineState {
  readonly fence: OpenFence | undefined;
  readonly alert: boolean;
}

/** Decide one line: blank it, keep it, or keep it as an alert body, and the state the next line inherits. */
function judgeLine({ line, state }: { line: string; state: LineState }): { blankLine: boolean; next: LineState } {
  const marker = FENCE.exec(line)?.[1];
  if (state.fence !== undefined) {
    const closed = marker !== undefined && closesFence({ marker, open: state.fence });
    return { blankLine: true, next: { alert: false, fence: closed ? undefined : state.fence } };
  }
  if (marker !== undefined) {
    return { blankLine: true, next: { alert: false, fence: { char: marker[0]!, length: marker.length } } };
  }
  if (!BLOCKQUOTE.test(line)) {
    return { blankLine: false, next: { alert: false, fence: undefined } };
  }
  const alert = state.alert || ALERT_OPENER.test(line);
  return { blankLine: !alert, next: { alert, fence: undefined } };
}

/** Blank fenced code and quoted (non-alert) blockquote lines, and an alert's own `>` and `[!TYPE]` markers. */
function blankBlocks({ chars }: { chars: string[] }): void {
  let state: LineState = { alert: false, fence: undefined };
  let offset = 0;
  for (const line of chars.join("").split("\n")) {
    const judged = judgeLine({ line, state });
    if (judged.blankLine) {
      blank({ chars, span: { end: offset + line.length, start: offset } });
    } else if (judged.next.alert) {
      const marker = /^\s{0,3}>\s*(?:\[![A-Za-z]+\])?/u.exec(line)![0];
      blank({ chars, span: { end: offset + marker.length, start: offset } });
    }
    state = judged.next;
    offset += line.length + 1;
  }
}

/** Blank every HTML tag, then restore the attribute values a reader sees from the original text. */
function blankTagsKeepingVisibleAttributes({ chars, original }: { chars: string[]; original: string }): void {
  for (const tag of spansOf({ pattern: HTML_TAG, text: chars.join("") })) {
    blank({ chars, span: tag });
    const markup = original.slice(tag.start, tag.end);
    for (const attribute of markup.matchAll(VISIBLE_ATTRIBUTE)) {
      // Exactly one of the two groups matched: the quoted value, else the bare one. An unmatched group is
      // `undefined` at runtime though the lib types it `string`, so the callback states the real type.
      const value = attribute.slice(1).find((group: string | undefined) => group !== undefined)!;
      const valueStart = tag.start + attribute.index + attribute[0].length - value.length - 1;
      for (let index = valueStart; index < valueStart + value.length; index += 1) {
        chars[index] = original[index]!;
      }
    }
  }
}

/**
 * The text with every character that is not the author's prose replaced by a space. Pure.
 *
 * @param text the published text exactly as it will be sent
 * @returns a string as long as the text with CRLF normalised to LF, newlines in place, holding only authored prose
 */
export function publicationProseMask({ text }: { text: string }): string {
  // UTF-16 code units, the same unit every regex index below is measured in.
  const chars = text.replace(/\r\n/gu, "\n").split("");
  const original = chars.join("");
  blankBlocks({ chars });
  blankAll({ chars, pattern: HTML_COMMENT });
  blankAll({ chars, pattern: CODE_ELEMENT });
  blankAll({ chars, pattern: INLINE_CODE });
  blankTagsKeepingVisibleAttributes({ chars, original });
  blankAll({ chars, pattern: LINK_TARGET });
  blankAll({ chars, pattern: REFERENCE_DEFINITION });
  blankAll({ chars, pattern: AUTOLINK });
  blankAll({ chars, pattern: BARE_URL });
  blankAll({ chars, pattern: DOUBLE_QUOTED });
  return chars.join("");
}
