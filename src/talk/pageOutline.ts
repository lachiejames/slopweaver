/**
 * The map of a published page the console voice reads beside every `file_read` window: each `<h1>`–`<h3>` and
 * the byte offset it opens at, so a question about one section is answered from THAT section, read with one
 * `from`, rather than from whichever window happened to be in hand.
 *
 * MEASURED: over a 54,311-byte code-ownership briefing the owner asked whether
 * any proposal came close to satisfying everyone. The voice's one read was a 10 KiB window from byte 7,800,
 * which ends inside the "Platform's boxes" table; "Options you could bring back" opens at byte 44,613. It
 * answered out of that table's tick notes, which describe today's settings, and the owner heard the current state of
 * CODEOWNERS read back as the proposal. Repro: `slopweaver talk file read --path
 * ~/.slopweaver/pages/code-ownership-briefing/index.html --from 7800 --json`.
 *
 * Pure: `./localText.ts` reads the bytes and masks the heading text.
 */

/** The largest HTML file an outline is built for; a larger one still reads, with an empty outline. */
export const PAGE_OUTLINE_MAX_BYTES = 256 * 1024;

/**
 * The most headings one outline carries. Sixteen headings of {@link PAGE_OUTLINE_TEXT_MAX_CHARS} `"` beside a
 * worst-case 10 KiB window of `"` still fit the console page's 24 KiB tool cap — `voiceReadWindow.test.ts`.
 */
export const PAGE_OUTLINE_MAX_ENTRIES = 16;

/**
 * The console page's tool cap in UTF-8 bytes of serialised answer — `site/components/live/talkSession.ts`'s
 * `TOOL_OUTPUT_MAX`, which `src/` cannot import. An answer over it is refused whole, so `file_read` sheds outline
 * headings ({@link outlineShortened}) until it fits rather than letting the outline cost the window. Bytes since the
 * page keeps each answer on the call file, whose route takes 64 KiB of UTF-8.
 */
export const PAGE_TOOL_ANSWER_MAX_BYTES = 24 * 1024;

/** The most characters (code points) of one heading's text an outline carries. */
export const PAGE_OUTLINE_TEXT_MAX_CHARS = 80;

/** Which heading element. */
type PageHeadingLevel = 1 | 2 | 3;

/** One heading of a page. */
export interface PageHeading {
  readonly level: PageHeadingLevel;
  /** Tags stripped, five entities decoded once, whitespace collapsed, cut to {@link PAGE_OUTLINE_TEXT_MAX_CHARS}. */
  readonly text: string;
  /** The UTF-8 byte offset its opening tag starts at, to pass back to `file_read` as `from`. */
  readonly from: number;
}

/** A page's outline, and whether a heading the page does have is not in it. */
export interface PageOutlineResult {
  readonly headings: readonly PageHeading[];
  readonly cut: boolean;
}

/**
 * An `<h1>`–`<h3>` element and its inner markup. A regex, not a parser, so a `</h1>` inside a quoted attribute
 * ends a heading early. What that can cost is bounded by the window: the bytes it
 * splits a secret across do not hold the secret contiguously, so a masked `file_read` window over them sends
 * both halves too, and the outline shows a subset of that. A real HTML parser would close it; for our own
 * briefings it is not worth one.
 */
const HEADING = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1\s*>/giu;

/** A `<style>` or `<script>` block or a comment, whose contents are never headings. */
const RAW_BLOCK = /<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/giu;

/**
 * The five entities a heading's text is decoded from, in ONE pass, so `&amp;lt;` stays `&lt;`. Decoding can spell
 * a run the window spells as an entity — `&lt;aaa` shows as `<aaa` — which is the same
 * text in another spelling, never a secret the page's bytes did not already show.
 */
const ENTITY = /&(amp|lt|gt|quot|#39);/gu;

/** Each entity's character, keyed by the whole entity. */
const ENTITY_CHARACTER: Readonly<Record<string, string>> = {
  "&#39;": "'",
  "&amp;": "&",
  "&gt;": ">",
  "&lt;": "<",
  "&quot;": '"',
};

/**
 * Every `<h1>`–`<h3>` of an HTML page, in order, with the byte offset each opens at. Past
 * {@link PAGE_OUTLINE_MAX_ENTRIES} headings every `<h1>` and `<h2>` is kept first, up to the cap, and the slots
 * left go to the page's first `<h3>`s, so a page's top-level sections survive its sub-headings and a page of
 * only sub-headings still gets an outline. A heading past the cap is reached by reading on with `nextFrom`.
 *
 * The page is scanned as its raw BYTES, one character each, so a match's index IS its byte offset; only a
 * heading's own text is decoded as UTF-8: decoded first, a byte-order mark (which the
 * decoder strips) put every offset three bytes short, and an invalid byte (which it widens to U+FFFD) two long.
 *
 * Only a heading the outline KEEPS is masked, twice and both before the cut, so a secret longer than the cap is
 * masked whole rather than leaving a prefix too short to recognise: its markup as a span of the page, which masks
 * it exactly as a window over the same bytes would, a secret running on past the heading's own tags included
 * (masked on its own, a secret spelled with a tag or ending in `</h1>` would leave its prefix);
 * then its shown words, because a tag splitting a secret only joins it there.
 *
 * @param bytes the page's whole contents
 * @param mask `markup` masks the page's bytes `[start, end)` against the whole page; `words` masks shown text
 * @returns the outline in page order, empty when the page has no headings, and whether the cap left one out
 */
export function pageOutline({
  bytes,
  mask,
}: {
  bytes: Uint8Array;
  mask: { readonly markup: (span: { start: number; end: number }) => string; readonly words: (text: string) => string };
}): PageOutlineResult {
  const raw = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  const blanked = raw.replace(RAW_BLOCK, (block) => " ".repeat(block.length));
  const top: PageHeading[] = [];
  const sub: PageHeading[] = [];
  let qualifying = 0;
  // Walked to the page's end, past the cap, so a heading left out is known rather than guessed: only pages under
  // {@link PAGE_OUTLINE_MAX_BYTES} get here, and past the cap a heading costs one regex step and no masking.
  for (const match of blanked.matchAll(HEADING)) {
    if (shownWords({ inner: Buffer.from(match[2]!, "latin1").toString("utf8") }) === "") {
      continue;
    }
    qualifying += 1;
    const level = levelOf({ digit: match[1]! });
    const kept = level < 3 ? top : sub;
    if (kept.length < PAGE_OUTLINE_MAX_ENTRIES && top.length < PAGE_OUTLINE_MAX_ENTRIES) {
      const start = match.index + match[0].indexOf(">") + 1;
      const markup = mask.markup({ end: start + match[2]!.length, start });
      const text = Array.from(mask.words(shownWords({ inner: markup })))
        .slice(0, PAGE_OUTLINE_TEXT_MAX_CHARS)
        .join("");
      kept.push({ from: match.index, level, text });
    }
  }
  const headings = [...top, ...sub.slice(0, PAGE_OUTLINE_MAX_ENTRIES - top.length)].toSorted((a, b) => a.from - b.from);
  return { cut: qualifying > headings.length, headings };
}

/**
 * An outline one heading shorter: the LAST heading of the deepest level it holds, so sub-headings go before the
 * top-level sections and a page's opening sections outlast its closing ones.
 *
 * @param outline an outline, in page order
 * @returns the outline without that one heading, still in page order; empty stays empty
 */
export function outlineShortened({ outline }: { outline: readonly PageHeading[] }): readonly PageHeading[] {
  const deepest = Math.max(...outline.map((heading) => heading.level));
  const drop = outline.findLastIndex((heading) => heading.level === deepest);
  return outline.filter((_, at) => at !== drop);
}

/** The heading level a matched digit names. */
function levelOf({ digit }: { digit: string }): PageHeadingLevel {
  if (digit === "1") {
    return 1;
  }
  if (digit === "2") {
    return 2;
  }
  return 3;
}

// A C0 or C1 control character or DEL. JSON escapes a C0 one to six characters (`\u0001`) where `"` costs two,
// so a heading of them would cost an outline three times the budget `voiceReadWindow.test.ts` measures.
// oxlint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/gu;

/** A heading's inner markup as the words it shows: raw blocks and tags dropped, entities decoded, space collapsed. */
function shownWords({ inner }: { inner: string }): string {
  return inner
    .replace(RAW_BLOCK, " ")
    .replace(/<[^>]*>/gu, "")
    .replace(ENTITY, (entity) => ENTITY_CHARACTER[entity]!)
    .replace(CONTROL, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
