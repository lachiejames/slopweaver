/**
 * One page cut into the four things a byte of HTML can be: TEXT, a TAG, a COMMENT, or an INERT element.
 *
 * ## Why a scan and not a pattern
 *
 * The corrections mechanism writes attributes onto a page and has to take exactly those bytes back out again
 * ({@link ./corrections.ts}, {@link ./correctionsStrip.ts}). That inverse was built out of regular
 * expressions, and four consecutive Codex review passes each found a different page it destroyed — a script
 * quoting the strip, a script closed `</script >`, an unclosed script, a paragraph whose PROSE spells
 * `data-corr="changed"`, a comment holding markup, an author id written `id='x'`, `id = 'x'` or `id=x`, and
 * an attribute value quoting one of our own. Every fix was correct and every one left the next spelling
 * open, because the question each pattern was really being asked — "is this byte markup or is it content?" —
 * has no regular answer. A page has to be SCANNED to answer it, so this file scans it once and everything
 * downstream reads the answer.
 *
 * Two further passes (`r3-scan`, `r3-scan2`) then found pages this file read wrongly, and every one is that
 * same question asked about a region the first version had not enumerated: the inside of a quoted attribute
 * value, a `<textarea>` body, an `<iframe>` body. Each is recorded on the code that answers it —
 * {@link maskNonMarkup} and {@link INERT_NAMES}. The scan itself did not change for any of them, which is
 * the lesson: what has to be right is the SET of regions where markup is content, and a set assembled one
 * counterexample at a time is a set with the next counterexample still in it.
 *
 * The scan is deliberately not a parser. It builds no tree, resolves no nesting, and implies nothing about
 * whether the page is well-formed: a reader gets byte RANGES and slices the original string, so a stamp
 * still splices real bytes and a strip still hands back exactly what it was given. That is the property the
 * whole mechanism turns on, and a tree would lose it on the first re-serialisation.
 *
 * ## What each kind means here
 *
 * - `tag` — one opening or closing tag, `<` through the `>` that closes IT. A `>` inside a quoted attribute
 *   value does not close a tag, which is the whole reason this is a walk rather than `[^>]*`.
 * - `inert` — a whole raw-text element ({@link INERT_NAMES}), body included. Its contents are text that
 *   merely LOOKS like markup: a published page carries the artifact runtime's preamble, and the corrections
 *   stylesheet spells `[data-corr="new"]` twice. An unclosed one runs to the end of the page, which is what
 *   every browser does with one.
 * - `comment` — `<!-- … -->`, and also a doctype or processing instruction, which are the same thing to
 *   every reader here: markup nobody may edit and text nobody may count.
 * - `text` — everything else, including a stray `<` that opens no tag.
 *
 * Pure: bytes in, ranges out. No I/O, no clock.
 */

/** One run of bytes, as a half-open range into the page it was scanned from. */
export interface HtmlPart {
  /** Which of the four things this run of bytes is. */
  readonly kind: "text" | "tag" | "comment" | "inert";
  /** Index of the run's first byte. */
  readonly start: number;
  /** Index one past its last. */
  readonly end: number;
}

/** One attribute of one tag, as written, with the range it occupies IN THAT TAG'S own source. */
export interface TagAttribute {
  /** Lowercased, because HTML attribute names are case-insensitive and a reader compares them. */
  readonly name: string;
  /** The value with its quotes taken off; the empty string for a bare attribute that declares none. */
  readonly value: string;
  /** Index of the name's first byte within the tag source. */
  readonly start: number;
  /** Index one past the attribute's last byte within the tag source. */
  readonly end: number;
}

/** A tag's opening bracket and name, matched STICKILY so it can be applied at one offset without slicing. */
const TAG_OPEN = /<\/?([a-zA-Z][^\s/>]*)/y;

/** One attribute: a name, and optionally a value in either quoting or none at all. */
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>`]*))?/g;

/**
 * The one raw-text element HTML gives NO end tag at all: everything after it is text, to the last byte.
 *
 * A literal `</plaintext>` in the document is therefore text like everything else around it, and reading it
 * as a close is what review `r3-scan3` measured — the `<p>` after it came back a tag, the gate half counted
 * a mark on it, and the strip deleted an attribute the page's own author had typed. The comment on the set
 * below had said "which never closes" from the moment the name was added, while the code looked for a close
 * anyway, which is the shape to watch for: prose that already knows what the code does not do.
 */
const UNCLOSABLE_NAME = "plaintext";

/**
 * The elements whose BODIES are text however much they look like markup.
 *
 * This is HTML's own set, TAKEN FROM THE SPEC rather than assembled from the pages that caught it — the
 * tokenizer's RCDATA (`title`, `textarea`), RAWTEXT (`style`, `xmp`, `iframe`, `noembed`, `noframes`,
 * `noscript` with scripting on, which a published page always has), script-data (`script`) and PLAINTEXT
 * (`plaintext`, which never closes) states. A browser reads every one of these as one text node.
 *
 * Reading it from the spec is the actual lesson. `style` and `script` are the pair a published page
 * obviously carries, and each of the next two arrived as a counterexample — review `r3-scan` on
 * `<textarea><p id="ghost" data-corr="changed">example</p></textarea>`, then `r3-scan2` on the same page
 * written with an `<iframe>`. Each time, the gate half counted a mark that was text and the strip deleted
 * bytes the page's own author wrote. Adding one name per review would have been three correct fixes and a
 * fourth page still open; the SET is the thing that has to be right.
 *
 * Reading it from the spec is not the whole job either: `r3-scan3` then broke {@link UNCLOSABLE_NAME}, a
 * member whose own TERMINATION rule this file had got wrong. A name in the set still has to be read the way
 * the spec reads it.
 */
const INERT_NAMES = new Set([
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
  UNCLOSABLE_NAME,
]);

/**
 * Index one past the `>` that closes the tag opening at `from`, or the page's length when none does.
 *
 * A quoted attribute value is walked through rather than scanned for brackets, which is the one thing a
 * `[^>]*` pattern cannot do: `<a title="1 > 0">` closes at its second `>`, not its first. `./spots.ts`
 * takes a spot's opening-tag length from here for exactly that reason — it is the offset the stamp writes
 * its attributes at, so reading it one `>` early splices them into the middle of somebody's title.
 *
 * @param from index of the tag's own `<`
 * @returns the index its `>` closes at, one past
 */
export function tagEnd({ from, html }: { from: number; html: string }): number {
  let quote = "";
  for (let index = from + 1; index < html.length; index += 1) {
    const character = html[index]!;
    if (quote !== "") {
      if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") {
      return index + 1;
    }
  }
  return html.length;
}

/** Index one past an inert element's end tag, or the page's length when it never closes. */
function inertEnd({ from, html, name }: { from: number; html: string; name: string }): number {
  if (name === UNCLOSABLE_NAME) {
    return html.length;
  }
  // `name` is one of INERT_NAMES, read off the page's own bytes, so there is nothing here to escape.
  const close = new RegExp(`</${name}\\s*>`, "i").exec(html.slice(from));
  if (close === null) {
    return html.length;
  }
  return from + close.index + close[0].length;
}

/** The part opening at `at`, or undefined when the `<` there opens nothing and is ordinary text. */
function partAt({ at, html }: { at: number; html: string }): HtmlPart | undefined {
  if (html.startsWith("<!--", at)) {
    const close = html.indexOf("-->", at + 4);
    return { end: close < 0 ? html.length : close + 3, kind: "comment", start: at };
  }
  if (html.startsWith("<!", at) || html.startsWith("<?", at)) {
    const close = html.indexOf(">", at + 2);
    return { end: close < 0 ? html.length : close + 1, kind: "comment", start: at };
  }
  TAG_OPEN.lastIndex = at;
  const opening = TAG_OPEN.exec(html);
  if (opening === null) {
    return undefined;
  }
  const end = tagEnd({ from: at, html });
  const name = opening[1]!.toLowerCase();
  if (!html.startsWith("</", at) && INERT_NAMES.has(name)) {
    return { end: inertEnd({ from: end, html, name }), kind: "inert", start: at };
  }
  return { end, kind: "tag", start: at };
}

/**
 * One page as an ordered, gapless list of parts: every byte of `html` belongs to exactly one of them.
 *
 * Gapless is the contract callers depend on — joining every part's slice reproduces the page byte for byte,
 * so a pass that rewrites one kind and copies the rest is an exact transformation of the original.
 *
 * @param html the whole page
 * @returns every run of bytes, in the order they appear
 */
export function htmlParts({ html }: { html: string }): readonly HtmlPart[] {
  const parts: HtmlPart[] = [];
  let textStart = 0;
  let cursor = 0;
  while (cursor < html.length) {
    const at = html.indexOf("<", cursor);
    if (at < 0) {
      break;
    }
    const part = partAt({ at, html });
    if (part === undefined) {
      cursor = at + 1;
      continue;
    }
    if (at > textStart) {
      parts.push({ end: at, kind: "text", start: textStart });
    }
    parts.push(part);
    cursor = part.end;
    textStart = part.end;
  }
  if (textStart < html.length) {
    parts.push({ end: html.length, kind: "text", start: textStart });
  }
  return parts;
}

/**
 * Every attribute one tag declares, in source order.
 *
 * Reads all three of HTML's spellings — `id="x"`, `id='x'` and the unquoted `id=x` — with whitespace
 * permitted around the `=`, because each one is a thing an author writes and a reader that misses any of
 * them concludes the tag carries no id at all.
 *
 * @param tag one `tag` part's own source, `<` through `>`
 * @returns one entry per attribute, each carrying its range within that source
 */
export function tagAttributes({ tag }: { tag: string }): readonly TagAttribute[] {
  if (tag.startsWith("</")) {
    // An END TAG declares nothing: HTML parses its attributes and throws them away, so a browser renders
    // `</p id="ghost" data-corr="changed">` as a close and nothing else. Review `r3-scan5` measured a page
    // that claimed a mark and offered a jump, both written on one, and passed the gate with no defects —
    // the count agreed with a count of something no reader can see and no anchor can reach.
    return [];
  }
  TAG_OPEN.lastIndex = 0;
  const opening = TAG_OPEN.exec(tag);
  if (opening === null) {
    return [];
  }
  const out: TagAttribute[] = [];
  ATTRIBUTE.lastIndex = opening[0].length;
  for (let match = ATTRIBUTE.exec(tag); match !== null; match = ATTRIBUTE.exec(tag)) {
    const written = match[2];
    const quoted = written !== undefined && (written.startsWith('"') || written.startsWith("'"));
    out.push({
      end: match.index + match[0].length,
      name: match[1]!.toLowerCase(),
      start: match.index,
      value: value({ quoted, written }),
    });
  }
  return out;
}

/** One attribute's value as the author meant it: quotes off, and the empty string when it declares none. */
function value({ quoted, written }: { quoted: boolean; written: string | undefined }): string {
  if (written === undefined) {
    return "";
  }
  if (quoted) {
    return written.slice(1, -1);
  }
  return written;
}

/**
 * Every tag on the page whose ATTRIBUTES a reader must see, as source, in document order.
 *
 * That is every `tag` part, plus the OPENING TAG of every inert element. An inert element's body is text;
 * its own tags are markup like any other and carry attributes an author wrote. Review `r3-scan4` measured
 * what skipping them costs: `<textarea id="corr-0">notes</textarea>` hid its id from {@link declaredIds}, so
 * the mint handed `corr-0` to a paragraph as well and the strip's jump link landed on the textarea. An inert
 * element's CLOSING tag is not here — `</textarea>` declares nothing, and a reader after attributes is what
 * this exists for.
 *
 * @param html the whole page
 * @returns each tag's own source, `<` through the `>` that closes it
 */
export function tagSources({ html }: { html: string }): readonly string[] {
  const out: string[] = [];
  for (const part of htmlParts({ html })) {
    if (part.kind === "tag") {
      out.push(html.slice(part.start, part.end));
      continue;
    }
    if (part.kind === "inert") {
      out.push(html.slice(part.start, tagEnd({ from: part.start, html })));
    }
  }
  return out;
}

/**
 * Every `id` a tag on the page declares, in whichever of HTML's spellings its author chose.
 *
 * Both readers of this want the same set for the same reason and would be wrong in the same way without it:
 * `./corrections.ts` mints an anchor that must not collide with one, and `../../briefing/corrections.ts`
 * decides whether a jump link lands. An id written INSIDE a comment or a script body is not one an anchor
 * can reach, so neither counts it — while an id ON a `<script>`'s or a `<textarea>`'s own tag is an ordinary
 * anchor and counts like any other, which is why this reads {@link tagSources} rather than the tag parts.
 *
 * @param html the whole page
 * @returns every declared id, deduplicated
 */
export function declaredIds({ html }: { html: string }): ReadonlySet<string> {
  return new Set(
    tagSources({ html })
      .flatMap((tag) => tagAttributes({ tag }))
      .filter((attribute) => attribute.name === "id")
      .map((attribute) => attribute.value),
  );
}

/**
 * One tag's own source with every `<` and `>` INSIDE a quoted attribute value replaced by a space.
 *
 * A quoted value is content: `<span title='<p id="p1">old</p>'>` declares a title, not a paragraph. Only the
 * two brackets go, never the whole value, because a mask reader still has to see `class="need"` to tell a
 * card from a wrapper — and an attribute value cannot open an element once it cannot spell one.
 */
function maskTagValues({ tag }: { tag: string }): string {
  const out: string[] = [];
  let quote = "";
  for (let index = 0; index < tag.length; index += 1) {
    // Walked one UTF-16 unit at a time, which is safe here because every character it tests is ASCII and
    // every other one is pushed back unchanged, so a surrogate pair survives as the pair it arrived as.
    const character = tag[index]!;
    if (quote === "") {
      if (character === '"' || character === "'") {
        quote = character;
      }
      out.push(character);
      continue;
    }
    if (character === quote) {
      quote = "";
      out.push(character);
      continue;
    }
    out.push(character === "<" || character === ">" ? " " : character);
  }
  return out.join("");
}

/**
 * The page with everything that is not markup — comments, inert bodies, and the insides of quoted attribute
 * values — replaced by spaces, leaving a string of the SAME LENGTH.
 *
 * Same length is the whole point: every index a scan of the mask produces is an index into the original
 * string, so a caller splices the real bytes rather than a sanitised copy of them.
 *
 * The attribute half is what `./spots.ts` needs and review `r3-scan` measured: its `SPOT_OPEN` is a pattern
 * run over this mask, so a `<p id="p1">` sitting inside somebody's `title=` read as a real paragraph, took a
 * `data-corr` spliced into the middle of that value, and neither the round trip nor a second stamp held.
 *
 * @param html the whole page
 * @returns a string of identical length carrying only the parts that are markup
 */
export function maskNonMarkup({ html }: { html: string }): string {
  const out: string[] = [];
  for (const part of htmlParts({ html })) {
    const text = html.slice(part.start, part.end);
    if (part.kind === "inert" || part.kind === "comment") {
      out.push(" ".repeat(text.length));
      continue;
    }
    out.push(part.kind === "tag" ? maskTagValues({ tag: text }) : text);
  }
  return out.join("");
}
