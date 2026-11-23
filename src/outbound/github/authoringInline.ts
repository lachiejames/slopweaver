/**
 * The INLINE half of the authoring file grammar (`./authoringFile.ts`): the five {@link Inline} kinds, plus the
 * image run an evidence cell may carry, rendered to markdown and parsed back, and nothing else. Split out along
 * that seam so the file format — frontmatter, sections, list lines, note blocks — and the run grammar each stay
 * small enough to review; the block grammar reuses `escapeMd`, `unescapeMd`, `IMAGE_LINE`, `renderImage`,
 * `imageAt` and `topLevelIndexOf` from here.
 *
 * An image may carry a display width as a `{width=N}` suffix straight after its closing parenthesis. The suffix
 * sits OUTSIDE the destination, so a url carrying balanced or escaped parentheses still reads whole first, and a
 * text run that would otherwise open with `{` right after an image is written `\{`.
 */
import type { Content, ImageRun, Inline } from "./types.js";

/** One run of a line that may carry a picture: an inline run, or an image. */
type EvidenceRun = Inline | ImageRun;

/** A line's runs, pictures included. */
export type EvidenceContent = readonly EvidenceRun[];

/** Characters that carry meaning in this grammar, and so must be escaped in plain rendered text. */
const ESCAPABLE = new Set(["\\", "*", "`", "[", "]"]);

/**
 * A run of link/image TEXT: any escaped-pair-or-non-bracket character, stopping at the first UNESCAPED `]`.
 *
 * `[^\]]*` (a naive "anything but `]`") is what a hand-typed `]` inside link text would break: it stops at
 * the FIRST `]`, escaped or not, so `[see \]](url)` would parse as text `see \` with `](url)` left dangling.
 * This alternates an escaped pair (`\\.`, exactly two characters) with a single non-bracket-non-backslash
 * character, so `\]` is consumed as one unit rather than ending the match early. Linear, no nested
 * quantifiers, no ambiguity between the two alternatives — not vulnerable to catastrophic backtracking.
 */
const BRACKETED_TEXT = String.raw`(?:\\.|[^\]\\])*`;

/** One character of a url: an escaped `\`, `(` or `)`, a lone backslash before anything else, or a plain character. */
const URL_ATOM = String.raw`\\[\\()]|\\(?![\\()])|[^\\()]`;

/**
 * A url between the parentheses: atoms, plus one level of balanced parentheses, so a hand-typed
 * `https://en.wikipedia.org/wiki/Foo_(bar)` reads whole rather than stopping at its first `)`. The alternatives
 * are disjoint on their first character, so this is linear. {@link escapeUrl} is what the renderer writes.
 */
const URL_DESTINATION = `(?:${URL_ATOM}|\\((?:${URL_ATOM})*\\))*`;

/** `[text](url)`, escape-aware in the text — see {@link BRACKETED_TEXT} — and in the url. */
const LINK_PATTERN = new RegExp(`^\\[(${BRACKETED_TEXT})]\\((${URL_DESTINATION})\\)`);

/**
 * `![alt](url)` at the head of a line. An evidence cell reads it as an image run; `## Notes` reads a standalone one
 * too, so the file can represent it, and the form rules then refuse it there as `NOTE_IMAGE` — never folded.
 */
const IMAGE_LINE = new RegExp(`^!\\[(${BRACKETED_TEXT})]\\((${URL_DESTINATION})\\)`);

/** The display-width suffix an image may carry, read straight after its `)`. */
const WIDTH_SUFFIX = /^\{width=([0-9]+)\}/;

/** What a `{width=` opener that is not a whole number of pixels is refused with. */
const WIDTH_SHAPE = "an image's `{width=N}` takes a whole number of pixels, such as `{width=600}`";

/**
 * One image as the authoring grammar writes it: `![alt](url)`, then `{width=N}` when it carries a display width.
 *
 * @param image the image run
 * @returns the markdown for it
 */
export function renderImage({ image }: { image: ImageRun }): string {
  const sized = image.width === undefined ? "" : `{width=${String(image.width)}}`;
  return `![${escapeMd({ text: image.alt })}](${escapeUrl({ url: image.url })})${sized}`;
}

/**
 * The image at the head of `rest`, its optional `{width=N}` suffix included.
 *
 * The width's bounds are the schema's to judge, so this reads any whole number and leaves the refusal to the gate
 * every form crosses.
 *
 * @param rest the text from where an image may open
 * @returns the image and how many characters it took, a decline, or undefined when no image opens there
 */
export function imageAt({ rest }: { rest: string }): { run: ImageRun; length: number } | { error: string } | undefined {
  const match = IMAGE_LINE.exec(rest);
  if (match === null) {
    return undefined;
  }
  const alt = match[1]!;
  const url = unescapeUrl({ url: match[2]! });
  if (alt.length === 0 || url.length === 0) {
    return { error: "an `![alt](url)` image needs both a non-empty alt text and a non-empty url" };
  }
  const run: ImageRun = { alt: unescapeMd({ text: alt }), kind: "image", url };
  const after = rest.slice(match[0].length);
  const sized = WIDTH_SUFFIX.exec(after);
  if (sized === null) {
    return after.startsWith("{width=") ? { error: WIDTH_SHAPE } : { length: match[0].length, run };
  }
  return { length: match[0].length + sized[0].length, run: { ...run, width: Number(sized[1]!) } };
}

/**
 * A url as the authoring grammar writes it: every `\`, `(` and `)` backslash-escaped, so any url reads back whole.
 *
 * @param url the raw url
 * @returns the url, escaped for a `(url)` destination
 */
function escapeUrl({ url }: { url: string }): string {
  return url.replace(/[\\()]/g, String.raw`\$&`);
}

/**
 * Reverse {@link escapeUrl}: only an escaped `\`, `(` or `)` collapses, so a hand-typed backslash stays.
 *
 * @param url the url as written between the parentheses
 * @returns the raw url
 */
function unescapeUrl({ url }: { url: string }): string {
  return url.replace(/\\([\\()])/g, "$1");
}

/**
 * Escape the characters this grammar gives meaning to, so rendered plain text parses back as plain text.
 *
 * @param text the raw run text
 * @returns the text with every meaningful character backslash-escaped
 */
export function escapeMd({ text }: { text: string }): string {
  // Iterating by Unicode CODE POINT is exactly right: every escapable character here is single-code-unit, so
  // a multi-code-unit code point (an emoji) never matches ESCAPABLE and passes through unchanged either way.
  // oxlint-disable-next-line no-misused-spread
  return [...text].map((ch) => (ESCAPABLE.has(ch) ? `\\${ch}` : ch)).join("");
}

/**
 * One inline run, rendered in this format's own (not GitHub's) markdown.
 *
 * @param run the run to render
 * @returns the markdown text for it
 */
function renderInlineRun({ run }: { run: Inline }): string {
  switch (run.kind) {
    case "text":
      return escapeMd({ text: run.text });
    case "strong":
      return `**${escapeMd({ text: run.text })}**`;
    case "em":
      return `*${escapeMd({ text: run.text })}*`;
    case "code":
      return `\`${run.text}\``;
    case "link":
      return `[${escapeMd({ text: run.text })}](${escapeUrl({ url: run.url })})`;
  }
}

/**
 * A cell's worth of content, rendered as one run of markdown text — with the `!` before a link escaped exactly
 * as in evidence, since an unescaped one reads back as an image, which an inline cell refuses.
 *
 * @param content the ordered runs
 * @returns the markdown for them, concatenated
 */
export function renderContent({ content }: { content: Content }): string {
  return renderEvidenceContent({ content });
}

/** One decline, for the many delimiter-run failure sites below. */
function badToken({ error }: { error: string }): { error: string } {
  return { error };
}

/** `**bold**` at the head of `rest`, undefined when it doesn't start there. */
function strongTokenAt({ rest }: { rest: string }): { run: Inline; length: number } | { error: string } | undefined {
  if (!rest.startsWith("**")) {
    return undefined;
  }
  const end = rest.indexOf("**", 2);
  if (end < 0) {
    return badToken({ error: "an unclosed `**` — every `**bold**` needs a matching closing `**`" });
  }
  if (end === 2) {
    return badToken({ error: "an empty `**bold**` run — it must contain text" });
  }
  return { length: end + 2, run: { kind: "strong", text: unescapeMd({ text: rest.slice(2, end) }) } };
}

/** `` `code` `` at the head of `rest`, undefined when it doesn't start there. */
function codeTokenAt({ rest }: { rest: string }): { run: Inline; length: number } | { error: string } | undefined {
  if (!rest.startsWith("`")) {
    return undefined;
  }
  const end = rest.indexOf("`", 1);
  if (end < 0) {
    return badToken({ error: "an unclosed `` ` `` — every code run needs a matching closing backtick" });
  }
  if (end === 1) {
    return badToken({ error: "an empty `` ` `` run — it must contain text" });
  }
  // Code text is taken verbatim: it renders inside a real code element, so nothing in it is escaped either
  // way, and unescaping it here would mangle a literal backslash the author meant to keep.
  return { length: end + 1, run: { kind: "code", text: rest.slice(1, end) } };
}

/** `[text](url)` at the head of `rest`, undefined when it doesn't start there. */
function linkTokenAt({ rest }: { rest: string }): { run: Inline; length: number } | { error: string } | undefined {
  if (!rest.startsWith("[")) {
    return undefined;
  }
  const match = LINK_PATTERN.exec(rest);
  if (match === null) {
    return badToken({
      error: "an unmatched `[` — a link must be the whole `[text](url)` shape, or escape it as `\\[`",
    });
  }
  const linkText = match[1]!;
  const url = unescapeUrl({ url: match[2]! });
  if (linkText.length === 0 || url.length === 0) {
    return badToken({ error: "a `[text](url)` link needs both a non-empty text and a non-empty url" });
  }
  return { length: match[0].length, run: { kind: "link", text: unescapeMd({ text: linkText }), url } };
}

/** `*em*` at the head of `rest`, undefined when it doesn't start there. */
function emTokenAt({ rest }: { rest: string }): { run: Inline; length: number } | { error: string } | undefined {
  if (!rest.startsWith("*")) {
    return undefined;
  }
  const end = rest.indexOf("*", 1);
  if (end < 0) {
    return badToken({ error: "an unclosed `*` — every `*em*` needs a matching closing `*`" });
  }
  if (end === 1) {
    return badToken({ error: "an empty `*em*` run — it must contain text" });
  }
  return { length: end + 1, run: { kind: "em", text: unescapeMd({ text: rest.slice(1, end) }) } };
}

/** Whether a run of characters at `rest`'s head opens an inline construct, and where it ends if so. */
function inlineTokenAt({ rest }: { rest: string }): { run: Inline; length: number } | { error: string } | undefined {
  for (const tokenAt of [strongTokenAt, codeTokenAt, linkTokenAt, emTokenAt]) {
    const token = tokenAt({ rest });
    if (token !== undefined) {
      return token;
    }
  }
  return undefined;
}

/**
 * Reverse {@link escapeMd}: a backslash before any character means that character literally.
 *
 * @param text the escaped source text
 * @returns the text with every `\X` collapsed to `X`
 */
function unescapeMd({ text }: { text: string }): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\\" && i + 1 < text.length) {
      out += text[i + 1];
      i += 1;
      continue;
    }
    out += text[i];
  }
  return out;
}

/** One step of the inline reader: raw text for the buffer, a complete run, or a decline. */
type Step =
  | { readonly kind: "text"; readonly text: string; readonly length: number }
  | { readonly kind: "run"; readonly run: EvidenceRun; readonly length: number }
  | { readonly error: string };

/** A token that was found at the head of the text, as a step: its run, or its decline. */
function tokenStep({ token }: { token: { run: EvidenceRun; length: number } | { error: string } }): Step {
  if ("error" in token) {
    return { error: token.error };
  }
  return { kind: "run", length: token.length, run: token.run };
}

/**
 * What the head of `rest` contributes: raw text for the buffer (an escaped pair kept whole, for
 * {@link unescapeMd} to collapse later, or one plain character), a complete run, or a decline.
 */
function stepAt({ rest, images }: { rest: string; images: boolean }): Step {
  if (rest.startsWith("\\") && rest.length > 1) {
    return { kind: "text", length: 2, text: rest.slice(0, 2) };
  }
  const image = imageAt({ rest });
  if (!images && image !== undefined) {
    // Read as a `!` then a link, it renders a stray `!` before a link to the picture rather than the picture.
    return {
      error:
        "an `![alt](url)` image belongs only in an evidence field, where it renders as the picture: a " +
        "`## Before and after` evidence line, the `## Click-through` destination, a `- proven:` claim's evidence " +
        "in `## Other claims`, or a `## Proof` line. Move the screenshot to the claim it proves rather than linking it here",
    };
  }
  if (image !== undefined) {
    return tokenStep({ token: image });
  }
  const token = inlineTokenAt({ rest });
  if (token === undefined) {
    return { kind: "text", length: 1, text: rest[0]! };
  }
  return tokenStep({ token });
}

/**
 * The runs of one stretch of markdown — inline runs, plus image runs when `images` is set.
 *
 * @param source the raw text
 * @param images whether an `![alt](url)` reads as an image run rather than a `!` then a link
 * @returns the parsed runs, or the reason parsing declined
 */
function parseRuns({
  source,
  images,
}: {
  source: string;
  images: boolean;
}): { readonly runs: readonly EvidenceRun[] } | { readonly error: string } {
  const runs: EvidenceRun[] = [];
  let buffer = "";
  let pos = 0;
  const flush = (): void => {
    if (buffer.length > 0) {
      runs.push({ kind: "text", text: unescapeMd({ text: buffer }) });
      buffer = "";
    }
  };
  while (pos < source.length) {
    const step = stepAt({ images, rest: source.slice(pos) });
    if ("error" in step) {
      return { error: step.error };
    }
    if (step.kind === "text") {
      buffer += step.text;
    } else {
      flush();
      runs.push(step.run);
    }
    pos += step.length;
  }
  flush();
  return runs.length === 0 ? { error: "this section is empty — it must contain at least some text" } : { runs };
}

/**
 * Parse one section's inline markdown into {@link Content}.
 *
 * @param source the section's raw text
 * @returns the parsed content, or the reasons parsing declined
 */
export function parseInlineContent({
  source,
}: {
  source: string;
}): { readonly content: Content } | { readonly error: string } {
  const parsed = parseRuns({ images: false, source });
  if ("error" in parsed) {
    return parsed;
  }
  return { content: parsed.runs.filter((run): run is Inline => run.kind !== "image") };
}

/**
 * Parse an evidence cell's markdown — the inline runs plus `![alt](url)` image runs — into
 * {@link EvidenceContent}.
 *
 * @param source the cell's raw text
 * @returns the parsed evidence, or the reason parsing declined
 */
export function parseEvidenceContent({
  source,
}: {
  source: string;
}): { readonly content: EvidenceContent } | { readonly error: string } {
  const parsed = parseRuns({ images: true, source });
  return "error" in parsed ? parsed : { content: parsed.runs };
}

/**
 * An evidence cell rendered as one run of markdown, images as `![alt](url)`.
 *
 * A text run ending in `!` directly before a link would read back as an image, so that one `!` is escaped; one
 * opening with `{` directly after an image would read back as its width suffix, so that `{` is escaped too.
 *
 * @param content the evidence runs
 * @returns the markdown for them, concatenated
 */
export function renderEvidenceContent({ content }: { content: EvidenceContent }): string {
  return content
    .map((run, index) => {
      if (run.kind === "image") {
        return renderImage({ image: run });
      }
      const rendered = renderInlineRun({ run });
      const afterImage = content[index - 1]?.kind === "image";
      const opened = run.kind === "text" && afterImage && rendered.startsWith("{") ? `\\${rendered}` : rendered;
      const beforeLink = content[index + 1]?.kind === "link";
      return run.kind === "text" && beforeLink && opened.endsWith("!") ? `${opened.slice(0, -1)}\\!` : opened;
    })
    .join("");
}

/**
 * Where `separator` first occurs OUTSIDE every inline construct and escape — the split point of a line whose
 * fields are joined by it, so a code run or a link label carrying the separator never splits the line.
 *
 * @param source the raw line
 * @param separator the literal joining the line's fields
 * @returns the separator's index, or -1 when no top-level occurrence exists
 */
export function topLevelIndexOf({ source, separator }: { source: string; separator: string }): number {
  let pos = 0;
  while (pos < source.length) {
    const rest = source.slice(pos);
    if (rest.startsWith(separator)) {
      return pos;
    }
    if (rest.startsWith("\\") && rest.length > 1) {
      pos += 2;
      continue;
    }
    const token = inlineTokenAt({ rest });
    pos += token !== undefined && !("error" in token) ? token.length : 1;
  }
  return -1;
}
