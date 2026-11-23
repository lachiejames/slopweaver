/**
 * Where a `~` strike cannot reach in `mrkdwn` text: the code spans, `<…>` tokens and bare addresses Slack reads as
 * markup, a claim welded to a word, and a claim whose line holds another `~`. Split out of `./claimStrike.ts` under
 * the file-size cap along the line between reading `mrkdwn` TEXT (here) and walking Slack's block TREE (there). Pure.
 * `./claimStrike.ts` and `./claimCorrection.ts` import from here; this module imports nothing from either.
 */

/**
 * Every offset `needle` occurs at in `haystack`, non-overlapping.
 *
 * @returns the offsets, in order
 */
export function occurrences({ haystack, needle }: { haystack: string; needle: string }): readonly number[] {
  const found: number[] = [];
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    found.push(at);
    at = haystack.indexOf(needle, at + needle.length);
  }
  return found;
}

/**
 * How many times `mrkdwn` text makes the claim inside a span a `~` strike does not reach: a code span, where Slack
 * shows `~` literally, a `<…>` token (a link's address or label, a mention, a date) or a bare address Slack links
 * itself, which are markup rather than text. An occurrence overlapping any span counts, and so does one welded to a
 * word on either side (outside any tildes around it), since Slack reads `~` as a strike only at a word's edge, and one
 * whose line holds any other `~`, which Slack could pair with one of the claim's own.
 *
 * @returns the count of occurrences inside such a span
 */
export function opaqueSpanCount({ text, wrong }: { text: string; wrong: string }): number {
  const spans = opaqueSpans({ text });
  return occurrences({ haystack: text, needle: wrong }).filter(
    (at) =>
      spans.some(({ end, start }) => at < end && at + wrong.length > start) ||
      welded({ at, text, wrong }) ||
      strayTilde({ at, text, wrong }),
  ).length;
}

/**
 * Whether a code span, `<…>` token or bare address in `mrkdwn` text opens before `at` and runs past it — an unclosed
 * fence, say, swallowing a line appended after it.
 *
 * @returns whether some opaque span crosses `at`
 */
export function opaqueSpanCrosses({ text, at }: { text: string; at: number }): boolean {
  return opaqueSpans({ text }).some(({ end, start }) => start < at && end > at);
}

/**
 * Whether the claim's line holds a `~` other than the pair wrapped exactly round it. Slack pairs tildes left to right
 * within a line, so any other one — a wider strike, a doubled `~~claim~~`, a lone `~old` before it — can take one of
 * the claim's own edges and leave the claim unstruck.
 */
function strayTilde({ at, text, wrong }: { at: number; text: string; wrong: string }): boolean {
  const end = at + wrong.length;
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  const newline = text.indexOf("\n", end);
  const lineEnd = newline === -1 ? text.length : newline;
  const wrapped = text[at - 1] === "~" && text[end] === "~";
  const ownStart = wrapped ? at - 1 : at;
  const ownEnd = wrapped ? end + 1 : end;
  return `${text.slice(lineStart, ownStart)}${text.slice(ownEnd, lineEnd)}`.includes("~");
}

/** A letter, digit or underscore: what Slack takes a `~` touching it as part of a word rather than a strike. */
const WORD_CHAR_LAST = /[\p{L}\p{N}_]$/u;

/** {@link WORD_CHAR_LAST}, at the start of the text. */
const WORD_CHAR_FIRST = /^[\p{L}\p{N}_]/u;

/** Whether the claim at `at`, or the `~…~` already wrapped round it, touches a word character on either side. */
function welded({ at, text, wrong }: { at: number; text: string; wrong: string }): boolean {
  const end = at + wrong.length;
  const wrapped = text[at - 1] === "~" && text[end] === "~";
  const before = wrapped ? at - 2 : at - 1;
  const after = wrapped ? end + 1 : end;
  // Read whole code points, so a letter outside the BMP (two UTF-16 units) is still a letter.
  const wordEndsAt = ({ index }: { index: number }): boolean =>
    index >= 0 && WORD_CHAR_LAST.test(text.slice(0, index + 1));
  const wordStartsAt = ({ index }: { index: number }): boolean =>
    index < text.length && WORD_CHAR_FIRST.test(text.slice(index));
  return wordEndsAt({ index: before }) || wordStartsAt({ index: after });
}

const FENCE = "```";

/** The closer that ends the opaque span opening at `at`. */
function spanCloser({ text, at }: { text: string; at: number }): string {
  if (text.startsWith(FENCE, at)) {
    return FENCE;
  }
  return text[at] === "<" ? ">" : "`";
}

/**
 * The opaque spans in `mrkdwn` text, as `[start, end)` offsets, scanned left to right: a ``` fence first (a lone
 * backtick inside it included), else a single-backtick span, else a `<…>` token. Inside one, nothing opens another.
 * One left open runs to the end, so an unsure reading refuses rather than strikes.
 */
function opaqueSpans({ text }: { text: string }): readonly { readonly start: number; readonly end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let at = text.search(/[`<]/u);
  while (at >= 0) {
    const closer = spanCloser({ at, text });
    const openerLength = closer === ">" ? 1 : closer.length;
    const close = text.indexOf(closer, at + openerLength);
    const end = close < 0 ? text.length : close + closer.length;
    spans.push({ end, start: at });
    const next = text.slice(end).search(/[`<]/u);
    at = next < 0 ? -1 : end + next;
  }
  // A bare address Slack links by itself is markup too: a `~` inside it changes the address, never strikes it.
  const addresses = [...text.matchAll(BARE_URL)].map((match) => ({
    end: match.index + match[0].length,
    start: match.index,
  }));
  return [...spans, ...addresses];
}

/** An address Slack auto-links in `mrkdwn`: a scheme, then everything up to whitespace or a `<…>` bracket. */
const BARE_URL = /\b(?:https?|mailto|ftp):[^\s<>]+/gu;
