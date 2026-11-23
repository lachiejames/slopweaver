/*
 * PURE reduction of a Gmail HTML body to readable plain text, and the one HTML entity decoder that a body, a
 * snippet and a link target all go through. No I/O, no clock, no imports.
 *
 * This output is read by an agent session, so surviving markup is a prompt-injection surface rather than merely
 * ugly text. That is why the walk is one left-to-right pass, and `htmlToText` says why it is not a regex chain.
 */

/** Tags whose close ends a visual block, so it becomes a paragraph break rather than nothing. */
const BLOCK_TAGS: ReadonlySet<string> = new Set([
  "p",
  "div",
  "tr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
]);

/** Tags whose CONTENT is not text at all and must be dropped with them. */
const OPAQUE_TAGS: ReadonlySet<string> = new Set(["script", "style"]);

/**
 * Reduce an HTML body to readable plain text. Deliberately crude and deliberately not a parser: this is the
 * FALLBACK for a message with no `text/plain` alternative, and the reader it serves is an agent session
 * that copes fine with imperfect whitespace. Anything richer belongs in a real HTML library, and no verb
 * here has yet needed one.
 *
 * ## Why this is a scanner and not a chain of `.replace()` calls
 *
 * Every regex approach to stripping HTML is wrong in a way that is invisible by inspection. Removing
 * `<script>…</script>` pairs leaves `<scr` behind on `<scr<script>ipt>`; removing `<[^>]*>` once leaves a
 * tag assembled out of what it just removed; looping to a fixed point fixes that but puts the correctness
 * argument outside the expression, where neither a reader nor a static analyser can check it. CodeQL
 * flagged this function through three rounds of exactly those patches and was right every time.
 *
 * One left-to-right pass that never reconsiders emitted output makes "no `<…>` survives" true by
 * construction. It also matters more than the crude-fallback framing suggests: this output is read by an
 * agent session, so surviving markup is a prompt-injection surface rather than merely ugly text.
 *
 * @param html the raw HTML body
 * @returns the flattened text
 */
export function htmlToText({ html }: { html: string }): string {
  return decodeEntities({ text: scanToText({ html }) })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The tag name at `open`, lower-cased, plus whether it was a closing tag. */
function tagAt({ html, open }: { html: string; open: number }): { name: string; closing: boolean } {
  const closing = html[open + 1] === "/";
  const nameStart = open + (closing ? 2 : 1);
  let end = nameStart;
  while (end < html.length) {
    const character = html[end];
    if (character === undefined || !/[a-zA-Z0-9]/.test(character)) {
      break;
    }
    end += 1;
  }
  return { closing, name: html.slice(nameStart, end).toLowerCase() };
}

/**
 * Whether the character after a `<` starts markup rather than ordinary prose.
 *
 * `!` is here for the case that made this parser's output land in the CORPUS rather than only on a screen.
 * A bulk-sender's HTML body opens `<!doctype html>` and is threaded with `<!--[if mso]>…<![endif]-->`
 * conditional comments, none of which begins with a letter or a slash — so every one of them was emitted as
 * prose. Measured over 944 real mail records: 121 of them (12.8%, and 17.4% of all stored characters) had
 * survived as raw markup, every one from a body with no plain-text alternative.
 *
 * On a screen that was ugly. In bronze it is worse than ugly, because this text is what a store read pastes into a
 * visible session: this file's own header argues that surviving markup is a prompt-injection surface, and
 * that argument only became load-bearing when the output stopped being ephemeral.
 */
function isTagStart({ next }: { next: string | undefined }): boolean {
  return next !== undefined && (next === "/" || next === "!" || /[a-zA-Z]/.test(next));
}

/** How a `<!…` run ends: a comment closes on `-->`, any other declaration on the next `>`. */
const COMMENT_OPEN = "<!--";
const COMMENT_CLOSE = "-->";

/**
 * Consume a `<!…` run: an HTML comment, or a declaration such as `<!doctype html>`.
 *
 * A comment must close on `-->` rather than on the first `>`, because a conditional comment
 * (`<!--[if mso]> … <![endif]-->`) contains one — stopping at it would emit the browser-hidden branch as
 * prose, which is exactly the content it exists to hide.
 *
 * @param html the raw HTML body
 * @param open the index of the `<`
 * @returns where scanning resumes, or undefined when the run is never terminated (which ends the scan,
 *   exactly as an unclosed tag does)
 */
function stepOverDeclaration({ html, open }: { html: string; open: number }): number | undefined {
  if (html.startsWith(COMMENT_OPEN, open)) {
    const close = html.indexOf(COMMENT_CLOSE, open + COMMENT_OPEN.length);
    return close === -1 ? undefined : close + COMMENT_CLOSE.length;
  }
  const close = html.indexOf(">", open);
  return close === -1 ? undefined : close + 1;
}

/** The whitespace a tag contributes to the flattened text: a line for `<br>`, a paragraph for a block close. */
function whitespaceFor({ tag }: { tag: { name: string; closing: boolean } }): string {
  if (tag.name === "br") {
    return "\n";
  }
  return tag.closing && BLOCK_TAGS.has(tag.name) ? "\n\n" : "";
}

/**
 * Consume one tag beginning at `open`.
 *
 * @param html the raw HTML body
 * @param open the index of the `<`
 * @returns what the tag contributes and where scanning resumes, or undefined when it is never terminated —
 *   which ends the scan, because an unclosed tag swallows the rest exactly as a browser would
 */
function stepOverTag({ html, open }: { html: string; open: number }): { emit: string; next: number } | undefined {
  if (html[open + 1] === "!") {
    const next = stepOverDeclaration({ html, open });
    return next === undefined ? undefined : { emit: "", next };
  }
  const close = html.indexOf(">", open);
  if (close === -1) {
    return undefined;
  }
  const tag = tagAt({ html, open });
  if (!tag.closing && OPAQUE_TAGS.has(tag.name)) {
    const skipped = skipOpaque({ html, name: tag.name, after: close + 1 });
    return skipped === undefined ? undefined : { emit: "", next: skipped };
  }
  return { emit: whitespaceFor({ tag }), next: close + 1 };
}

/**
 * Walk the HTML once, emitting text and translating tags as they are met.
 *
 * An unterminated `<tag` swallows the rest, exactly as a browser would; a `<` that begins nothing
 * tag-like (`a < b`, `5 <3`) is prose and is kept.
 *
 * @param html the raw HTML body
 * @returns the text, with tags removed and block boundaries turned into newlines
 */
function scanToText({ html }: { html: string }): string {
  let out = "";
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (open === -1) {
      return out + html.slice(index);
    }
    if (!isTagStart({ next: html[open + 1] })) {
      out += html.slice(index, open + 1);
      index = open + 1;
      continue;
    }
    out += html.slice(index, open);
    const step = stepOverTag({ html, open });
    if (step === undefined) {
      return out;
    }
    out += step.emit;
    index = step.next;
  }
  return out;
}

/**
 * Skip an opaque element's content and its closing tag.
 *
 * @param html the raw HTML body
 * @param name the opaque tag name, lower-cased
 * @param after the index just past the opening tag
 * @returns the index just past the closing tag, or undefined when the element is never closed
 */
function skipOpaque({ html, name, after }: { html: string; name: string; after: number }): number | undefined {
  let index = after;
  while (index < html.length) {
    const open = html.indexOf("<", index);
    const close = open === -1 ? -1 : html.indexOf(">", open);
    if (open === -1 || close === -1) {
      return undefined;
    }
    const tag = tagAt({ html, open });
    if (tag.closing && tag.name === name) {
      return close + 1;
    }
    index = close + 1;
  }
  return undefined;
}

/**
 * Decode the handful of HTML entities an email body actually uses, in ONE pass.
 *
 * Sequential `.replace()` calls double-unescape: `&amp;lt;` becomes `&lt;` on the ampersand pass and then
 * `<` on the next, so text an author escaped twice arrives as markup. A single pass over one alternation
 * cannot revisit what it just produced, which is the property that makes the difference.
 *
 * @param text the tag-free text
 * @returns the text with its entities decoded exactly once
 */
export function decodeEntities({ text }: { text: string }): string {
  const entities: Readonly<Record<string, string>> = {
    "&#39;": "'",
    "&amp;": "&",
    "&gt;": ">",
    "&lt;": "<",
    "&nbsp;": " ",
    "&quot;": '"',
  };
  // The pattern's alternation is exactly the six keys above, so every match it yields is one of them.
  return text.replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (match) => entities[match]!);
}
