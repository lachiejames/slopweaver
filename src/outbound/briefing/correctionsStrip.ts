/**
 * The VOCABULARY a correction mark is written in, and the inverse that takes every mark back out.
 *
 * Split from `./corrections.ts` (the file-size ratchet) along the seam the mechanism already had: that file
 * decides WHAT moved and stamps the page, this one owns the attribute names both halves spell and the one
 * function that un-stamps. The dependency runs one way — the stamp imports the strip, because
 * {@link stripCorrections} runs over both sides before anything is compared and over the new page before it
 * is re-stamped, and never the other way.
 *
 * Everything here takes back EXACTLY what the stamp put in, which is a correctness requirement rather
 * than tidiness: round three compares against a round-two page that is already marked, so a strip that
 * hands back one byte more or less than it was given makes the next round diff against whitespace.
 *
 * Pure: bytes in, bytes out. No I/O, no clock.
 */
import { type HtmlPart, htmlParts, type TagAttribute, tagAttributes } from "./htmlTokens.js";

/** The attribute a marked spot carries, and the one thing the gate half counts. */
export const CORRECTION_ATTRIBUTE = "data-corr";

/** The strip's own claim about how many marks it put on the page. */
export const MARKED_ATTRIBUTE = "data-corr-marked";

/** The strip's statement of which published version it compared against. */
export const AGAINST_ATTRIBUTE = "data-corr-against";

/**
 * What a COLLAPSED fold says when the change is underneath it.
 *
 * Without it a fine-grained scan hides its own answer: `../../briefing/corrections.ts` would report six
 * marked spots and the owner would see a page with none of them visible, because five sat inside sections never
 * opened. Measured on a consecutive briefing pair, one fold spanned 100 KB of the 190 KB page.
 *
 * @internal — written by the stamp and taken back by {@link stripCorrections}; nothing else names it.
 */
export const INSIDE_ATTRIBUTE = "data-corr-inside";

/**
 * The `id` prefix minted for a marked spot that carried none of its own.
 *
 * Readability only — what identifies a minted anchor to {@link stripCorrections} is
 * {@link MINTED_ANCHOR_FLAG} beside it, never this.
 *
 * @internal — the stamp names it; nothing outside this pair does.
 */
export const MINTED_ANCHOR_PREFIX = "corr-";

/**
 * What says an `id` beside it was minted here rather than authored by the page.
 *
 * The prefix alone cannot say that, and reading it as though it could is a namespace CLAIM rather than an
 * inverse: a page whose own author wrote `<p id="corr-1">` would have that id deleted by the strip, and the
 * jump link pointing at it would then land nowhere. So the mint writes a flag it can recognise again, and
 * the prefix goes back to being what it always read as — a readable anchor.
 *
 * @internal — written by the stamp and taken back by {@link stripCorrections}; nothing else names it.
 */
export const MINTED_ANCHOR_FLAG = "data-corr-minted";

/**
 * Whether one tag is the strip's OWN opening tag — a `<div>` carrying the count only the stamp writes.
 *
 * Keyed on {@link MARKED_ATTRIBUTE} rather than on `class="corr"`, for the same reason
 * {@link MINTED_ANCHOR_FLAG} exists: a class is a namespace CLAIM, not evidence. A page whose own author
 * wrote `<div class="corr">my own notes</div>` had that element DELETED by the strip, so the round trip
 * handed back a page shorter than the one it was given and the next round diffed against the hole.
 * `data-corr-marked` is computed here and appears nowhere else, so it says what the class only assumed.
 */
function isStripOpen({ tag }: { tag: string }): boolean {
  if (!DIV_OPEN.test(tag)) {
    return false;
  }
  return tagAttributes({ tag }).some((attribute) => attribute.name === MARKED_ATTRIBUTE);
}

/** The stamp's own stylesheet, recognised by the opening tag no other `<style>` on a page carries. */
const STAMP_STYLE_OPEN = /^<style data-corr-style="1">/i;

/** A `<div>`'s opening and closing tags, which is all the nesting the strip walk has to count. */
const DIV_OPEN = /^<div[\s>]/i;
const DIV_CLOSE = /^<\/div\s*>/i;

/** The newline the stamp writes after its stylesheet, which lands at the head of the part following it. */
const LEADING_NEWLINE = /^\n/;

/**
 * Exactly what the stamp writes in front of the strip, and so exactly what the strip takes back.
 *
 * Taken back as this LITERAL rather than as a greedy whitespace run, which is a correctness detail rather
 * than a style one. A `\s*` eats the page's own bytes alongside the stamp's, so the round trip stops being
 * byte-for-byte and a second stamp over the first one's output differs by whatever it swallowed. The same
 * reasoning is why a mark attribute is taken back with exactly the one space the stamp wrote before it, and
 * `../../__tests__/unit/outbound/briefing/corrections.test.ts` pins both, with the page's own whitespace
 * present and absent.
 */
const STAMP_INDENT = "\n  ";

/** The part indices `[from, to)` the strip element spans, or undefined when the page carries no strip. */
function stripElementParts({
  html,
  parts,
}: {
  html: string;
  parts: readonly HtmlPart[];
}): { readonly from: number; readonly to: number } | undefined {
  const from = parts.findIndex((part) => part.kind === "tag" && isStripOpen({ tag: html.slice(part.start, part.end) }));
  if (from < 0) {
    return undefined;
  }
  let depth = 0;
  for (let index = from; index < parts.length; index += 1) {
    const part = parts[index]!;
    if (part.kind !== "tag") {
      continue;
    }
    const tag = html.slice(part.start, part.end);
    if (DIV_OPEN.test(tag)) {
      depth += 1;
      continue;
    }
    if (DIV_CLOSE.test(tag)) {
      depth -= 1;
      if (depth === 0) {
        return { from, to: index + 1 };
      }
    }
  }
  return { from, to: parts.length };
}

/**
 * Every tag inside the corrections strip, its own opening tag first, or undefined when there is no strip.
 *
 * The gate half in `../../briefing/corrections.ts` reads the strip's claims and its jump links off these,
 * so the two halves agree on what the strip IS by sharing the walk that finds it rather than by carrying
 * two patterns that have to be kept in step.
 *
 * @param html the whole page
 * @returns the strip's tags in source order, or undefined on a page that was never stamped
 */
export function stripElementTags({ html }: { html: string }): readonly string[] | undefined {
  const parts = htmlParts({ html });
  const span = stripElementParts({ html, parts });
  if (span === undefined) {
    return undefined;
  }
  return parts
    .slice(span.from, span.to)
    .filter((part) => part.kind === "tag")
    .map((part) => html.slice(part.start, part.end));
}

/** Whether one attribute of one tag is something the stamp wrote, rather than something its author did. */
function isStampAttribute({ attribute, minted }: { attribute: TagAttribute; minted: boolean }): boolean {
  if (attribute.name === CORRECTION_ATTRIBUTE) {
    return attribute.value === "changed" || attribute.value === "new";
  }
  if (attribute.name === INSIDE_ATTRIBUTE || attribute.name === MINTED_ANCHOR_FLAG) {
    return true;
  }
  if (attribute.name === "id") {
    return minted;
  }
  return false;
}

/**
 * One tag with every attribute the stamp wrote taken back off it, and every attribute its author wrote left
 * exactly where it was.
 *
 * An `id` comes off only when {@link MINTED_ANCHOR_FLAG} is on the same tag saying this mechanism minted it.
 * The prefix alone cannot say that — a page whose own author wrote `<p id="corr-1">` would have its id
 * deleted and the jump pointing at it would then land nowhere.
 *
 * Removal runs from the LAST attribute backwards so each range stays an index into the string still being
 * cut, and takes the one space the stamp wrote in front of each attribute along with it.
 */
function withoutMarkAttributes({ tag }: { tag: string }): string {
  const attributes = tagAttributes({ tag });
  const minted = attributes.some((one) => one.name === MINTED_ANCHOR_FLAG && one.value === "1");
  const stamped = attributes.filter((attribute) => isStampAttribute({ attribute, minted }));
  let out = tag;
  for (const attribute of stamped.toReversed()) {
    out = out.slice(0, attribute.start - 1) + out.slice(attribute.end);
  }
  return out;
}

/**
 * One page with every trace of a previous stamping removed: the strip, its stylesheet, every mark attribute
 * and every anchor id the stamp minted.
 *
 * Run over both sides before comparing and over the new page before re-stamping — see `./corrections.ts`'s
 * header for why a second round is wrong without it.
 *
 * NOTHING here reads the page as one string. Every decision is made against `./htmlTokens.ts`'s scan, so a
 * `<script>` quoting the strip, a comment holding markup and a paragraph whose prose spells a mark attribute
 * are all left exactly as their author wrote them — the four review passes in that file's header are the
 * measurements, one page each.
 *
 * @param html the page, stamped or not
 * @returns the same bytes with the mechanism's own output taken back out
 */
export function stripCorrections({ html }: { html: string }): string {
  const parts = htmlParts({ html });
  const texts = withoutStripElement({ html, parts });
  const out: string[] = [];
  let dropNewline = false;
  for (const [index, part] of parts.entries()) {
    const text = texts[index]!;
    if (part.kind === "inert" && STAMP_STYLE_OPEN.test(text)) {
      dropNewline = true;
      continue;
    }
    if (dropNewline && part.kind === "text") {
      out.push(text.replace(LEADING_NEWLINE, ""));
      dropNewline = false;
      continue;
    }
    out.push(part.kind === "tag" ? withoutMarkAttributes({ tag: text }) : text);
  }
  return out.join("");
}

/**
 * Every part's own source, with the strip element's parts EMPTIED and the {@link STAMP_INDENT} the stamp
 * wrote in front of them taken off the part before.
 *
 * Emptied rather than removed so the list stays index-for-index with `parts`, which is what lets the caller
 * keep one loop over the two of them. The indent is a lookback because the strip is not one string any
 * more — it is a run of parts, and the bytes in front of it belong to whichever part precedes it.
 */
function withoutStripElement({ html, parts }: { html: string; parts: readonly HtmlPart[] }): readonly string[] {
  const texts = parts.map((part) => html.slice(part.start, part.end));
  const strip = stripElementParts({ html, parts });
  if (strip === undefined) {
    return texts;
  }
  const before = texts[strip.from - 1];
  if (before?.endsWith(STAMP_INDENT) === true) {
    texts[strip.from - 1] = before.slice(0, -STAMP_INDENT.length);
  }
  return texts.map((text, index) => (index >= strip.from && index < strip.to ? "" : text));
}
