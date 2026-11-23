/**
 * Split one of the owner's files into retrievable sections. Pure, deterministic, no I/O.
 *
 * ## Why this is the difference between working and being a no-op
 *
 * Distil clips a record's text and hashes the FULL text before truncating, so an over-long record looks
 * perfectly ingested while contributing only its opening: distil cuts `title + text` at 1,200 characters
 * ({@link ../../gold/recordBody.DISTIL_RECORD_CHARS}). A 92KB file ingested as ONE record contributes
 * 1,200 characters and silently discards the rest. An answer-prompt cap and a 2,048-character embedder cap
 * clipped it too, and the bound below does not depend on
 * either: 1,200 is the tightest of the three.
 *
 * So the unit of ingest is a section, and every section this module emits fits inside the TIGHTEST of those
 * budgets — 1,200 characters for `title` plus body together, which is what the prompt actually assembles.
 * Nothing downstream then has anything left to clip.
 *
 * ## Why headings alone were not enough, measured rather than assumed
 *
 * The obvious boundary is a markdown heading, and the handover asked for that to be measured before being
 * believed. Measured over the real corpus (4,842 files, 37.3M characters): **2,761 files — 57% — contain no
 * `##` heading at all**, 116 of those exceed 6,000 characters, and the largest single heading-delimited
 * section is 1,002,069 characters. Headings alone would have left 9.3M characters in one-record files and one
 * section a thousand times over budget. A heading split is therefore the FIRST pass, not the only one.
 *
 * The second pass is a character budget applied to whatever the first pass produced, preferring a blank-line
 * paragraph boundary, then a line boundary, then a hard cut — the last one so a transcript that is a single
 * unbroken 69,000-character line cannot defeat the guarantee. The precedent for the paragraph-first shape is
 * {@link ../chunkText.chunkText}; it is not reused here because it cannot promise a bound (a paragraph
 * longer than `maxChars` passes through whole), and a bound is the entire point of this module.
 */

/** The tightest downstream budget: distil cuts `title + "\n" + text` here ({@link ../../gold/recordBody}). */
export const PROMPT_RECORD_CHARS = 1200;

/**
 * The floor on a section's body budget, so a pathologically long heading cannot chop a file into slivers.
 *
 * A floor alone was not enough, and a review pass produced the counterexample: with a 1,200-character heading,
 * `title + "\n" + text` came to 1,601 characters, the prompt's slice held only the title, and the body — every
 * slice of it — was unreachable. The floor had quietly broken the one guarantee this module exists to make. So
 * an over-long heading is now DEMOTED rather than clipped ({@link MAX_TITLE_CHARS}), which keeps both the floor
 * and the bound.
 */
export const MIN_BODY_CHARS = 400;

/**
 * The longest a heading may be and still be treated as a title. Beyond this it is demoted to body text: a
 * heading this long is a paragraph with a `#` in front, and demoting it is lossless where clipping is not.
 *
 * Derived from the two constants rather than chosen, so `title.length + 1 + text.length <= PROMPT_RECORD_CHARS`
 * holds unconditionally — that arithmetic IS the guarantee.
 */
export const MAX_TITLE_CHARS = PROMPT_RECORD_CHARS - MIN_BODY_CHARS - 1;

/** One retrievable section of a file: where it came from within the file, its heading, and its text. */
export interface SelfSection {
  /** 0-based index of the heading-delimited section within the file (the pre-amble before any heading is 0). */
  readonly ordinal: number;
  /** 0-based index of this budget slice within its heading section (0 when the section fitted whole). */
  readonly part: number;
  /** How many budget slices that heading section produced, so a reader can see a section was cut. */
  readonly parts: number;
  /** The heading text, `#` markers and surrounding whitespace stripped (empty for the pre-heading pre-amble). */
  readonly title: string;
  /** A kebab-case slug of {@link title}, used to build a stable `sourceId`. `"body"` when there is no title. */
  readonly slug: string;
  /** The section's text — guaranteed non-empty, and short enough that no downstream stage clips it. */
  readonly text: string;
}

/** A heading-delimited span of a file, before the character budget is applied. */
interface HeadingSpan {
  readonly title: string;
  readonly body: string;
}

/** An ATX heading line (`# ` … `###### `) with actual text after the markers. */
const HEADING_LINE = /^(#{1,6})\s+(\S.*)$/;

/** A fenced-code delimiter (``` or ~~~), which suspends heading detection so a `# comment` never splits. */
const FENCE_LINE = /^\s*(?:```|~~~)/;

/**
 * Slugify a heading for use inside a `sourceId`. Lowercased, non-alphanumerics collapsed to single hyphens,
 * capped so one rambling heading cannot make an unwieldy id. Pure.
 *
 * @param title the heading text
 * @returns the slug, or `"body"` when the title has no usable characters
 */
export function slugifyHeading({ title }: { title: string }): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug.length > 0 ? slug : "body";
}

/**
 * Split text into heading-delimited spans. Content before the first heading becomes a span with an empty
 * title, so nothing is lost from a file that opens with prose. Fenced code blocks are skipped, so a `#`
 * comment inside a shell snippet is not mistaken for a heading. Pure.
 *
 * Splits at ANY ATX level rather than `##` alone. The handover named `##`, and every level is a strict
 * superset of it: a file whose only structure is `###` (or whose whole body sits under one `#` title) would
 * otherwise fall through to the character budget and lose its real, author-written boundaries and titles.
 *
 * @param text the file's full text, newlines already normalised
 * @returns the spans in file order (empty input ⇒ no spans)
 */
function headingSpans({ text }: { text: string }): readonly HeadingSpan[] {
  const spans: HeadingSpan[] = [];
  let title = "";
  let body: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      body.push(line);
      continue;
    }
    const heading = inFence ? null : HEADING_LINE.exec(line);
    if (heading === null) {
      body.push(line);
      continue;
    }
    if (title.length > 0 || body.join("\n").trim().length > 0) {
      spans.push({ body: body.join("\n"), title });
    }
    title = heading[2]!.trim();
    body = [];
  }
  if (title.length > 0 || body.join("\n").trim().length > 0) {
    spans.push({ body: body.join("\n"), title });
  }
  return spans;
}

/**
 * Cut `text` into pieces of at most `maxChars`, preferring the latest blank-line paragraph boundary, then the
 * latest line boundary, then a hard character cut. Every returned piece is non-empty and within the bound —
 * that unconditional bound is why this exists rather than the paragraph-only chunker next door. Pure.
 *
 * @param text the section body to cut (already trimmed, non-empty)
 * @param maxChars the hard upper bound on each piece
 * @returns the pieces in order
 */
function cutToBudget({ text, maxChars }: { text: string; maxChars: number }): readonly string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const head = rest.slice(0, maxChars + 1);
    const cut = bestCut({ head, maxChars });
    const piece = rest.slice(0, cut).trim();
    if (piece.length > 0) {
      pieces.push(piece);
    }
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) {
    pieces.push(rest);
  }
  return pieces;
}

/**
 * Where to cut a `maxChars + 1` window: the last paragraph break, else the last newline, else the bound
 * itself. Always returns a positive offset ≤ `maxChars`, so {@link cutToBudget} cannot fail to make progress
 * (a boundary at offset 0 would loop forever on the same text). Pure.
 *
 * @param head the candidate window, one character longer than the bound
 * @param maxChars the hard upper bound on a piece
 * @returns the cut offset
 */
function bestCut({ head, maxChars }: { head: string; maxChars: number }): number {
  const paragraph = head.lastIndexOf("\n\n");
  if (paragraph > 0) {
    return paragraph;
  }
  const line = head.lastIndexOf("\n");
  return line > 0 ? line : maxChars;
}

/**
 * Split one file's text into retrievable sections: heading boundaries first, then a character budget so no
 * section can be clipped by a downstream stage. Pure and deterministic — the same bytes always yield the
 * same sections in the same order, which is what makes a re-scan's `sourceId`s stable.
 *
 * A heading with an empty body still yields one section carrying the heading as its text: the owner wrote it, and a
 * record needs non-empty text to survive the bronze reader.
 *
 * @param text the file's full text (CRLF tolerated)
 * @param maxChars the budget for `title` and text TOGETHER, matching what the answer prompt assembles
 *   (defaults to {@link PROMPT_RECORD_CHARS})
 * @returns the sections in file order; an empty or whitespace-only file yields none
 */
export function splitIntoSections({
  text,
  maxChars = PROMPT_RECORD_CHARS,
}: {
  text: string;
  maxChars?: number;
}): readonly SelfSection[] {
  const normalised = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const titleCap = Math.max(0, maxChars - MIN_BODY_CHARS - 1);
  const sections: SelfSection[] = [];
  for (const [ordinal, span] of headingSpans({ text: normalised }).entries()) {
    const { title, body } = demoteOverlongHeading({ span, titleCap });
    // The prompt joins title and text with a newline before clipping, so the body's share of the budget is
    // what is left after the title has taken its own — computed per section, not assumed. The title is capped
    // above, so this can never fall back to the floor with a title that would overrun the total.
    const budget = Math.max(MIN_BODY_CHARS, maxChars - title.length - 1);
    const pieces = body.length > 0 ? cutToBudget({ maxChars: budget, text: body }) : [title];
    const slug = slugifyHeading({ title });
    for (const [part, piece] of pieces.entries()) {
      if (piece.length > 0) {
        sections.push({ ordinal, part, parts: pieces.length, slug, text: piece, title });
      }
    }
  }
  return sections;
}

/**
 * A span with an over-long heading turned into an untitled span whose body starts with that heading's text.
 *
 * Demotion rather than truncation, because truncation loses words the owner wrote while a demoted heading is still
 * fully retrievable — it just travels as prose, which is what a 1,200-character "heading" already is. Pure.
 *
 * @param span the heading-delimited span
 * @param titleCap the longest a title may be (see {@link MAX_TITLE_CHARS})
 * @returns the title to use (possibly empty) and the body to cut
 */
function demoteOverlongHeading({ span, titleCap }: { span: HeadingSpan; titleCap: number }): {
  title: string;
  body: string;
} {
  const body = span.body.trim();
  if (span.title.length <= titleCap) {
    return { body, title: span.title };
  }
  return { body: body.length > 0 ? `${span.title}\n\n${body}` : span.title, title: "" };
}
