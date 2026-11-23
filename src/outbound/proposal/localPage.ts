/**
 * A proposal's markdown as the HTML fragment of a LOCAL page — the same document the Notion destination
 * receives, with only destination navigation and folding syntax translated.
 *
 * ## Raw HTML is never passed through
 *
 * The draft is markdown a session wrote and a person may have hand-edited, and the page is opened in a
 * browser from disk. So micromark runs with raw HTML DISABLED: anything that looks like a tag in the body is
 * escaped and shown as text. The renderer's own two HTML constructs are translated here instead of trusted:
 *
 * - the Notion table-of-contents marker (`TOC` in `./render.ts`) is navigation, not content, and is dropped;
 * - a `<details>`/`<summary>` toggle, exactly as `./render.ts` emits it, becomes a real `<details>` whose
 *   summary is escaped and whose body is rendered as markdown in its own right.
 *
 * ## The title is an argument, not a line of the draft
 *
 * `./render.ts` leaves the title out of the markdown because Notion takes it as a page property. A local page
 * has no property, so the title arrives as an argument and is written as the page's escaped `<h1>`.
 */
import { createHash } from "node:crypto";

import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";

import { extensionOf, withMediaMarkers } from "../notion/mediaPlaceholder.js";
import { TOC } from "./render.js";

/** The line that opens a toggle, exactly as `./render.ts` writes it. */
const DETAILS_OPEN = "<details>";
/** The line that closes one. */
const DETAILS_CLOSE = "</details>";
/** A toggle's summary line, capturing the summary text. */
const SUMMARY_LINE = /^<summary>(.*)<\/summary>$/;

/**
 * Escape text for an HTML text node or attribute.
 *
 * @param text the raw text
 * @returns the text with `&`, `<`, `>`, `"` and `'` escaped
 */
export function escapeHtml({ text }: { text: string }): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Markdown to HTML, GFM tables and lists included, with every raw HTML construct escaped rather than emitted. */
function markdownHtml({ markdown }: { markdown: string }): string {
  return micromark(markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
}

/** One run of the draft: plain markdown, or a toggle whose body is itself markdown. */
type Segment =
  | { readonly kind: "markdown"; readonly lines: readonly string[] }
  | { readonly kind: "toggle"; readonly summary: string; readonly lines: readonly string[] };

/**
 * Split the draft into plain runs and toggles. A `<details>` line not followed by a summary line, or never
 * closed, is left in the plain run, where micromark escapes it into visible text rather than guessing.
 */
function segments({ lines }: { lines: readonly string[] }): readonly Segment[] {
  const out: Segment[] = [];
  let plain: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    const next = lines[index + 1];
    const summary = next === undefined ? null : SUMMARY_LINE.exec(next);
    const close = lines.indexOf(DETAILS_CLOSE, index + 2);
    if (line === DETAILS_OPEN && summary !== null && close !== -1) {
      out.push({ kind: "markdown", lines: plain });
      out.push({ kind: "toggle", lines: lines.slice(index + 2, close), summary: summary[1]! });
      plain = [];
      index = close + 1;
      continue;
    }
    plain.push(line);
    index += 1;
  }
  out.push({ kind: "markdown", lines: plain });
  return out;
}

/** One segment as HTML. */
function segmentHtml({ segment }: { segment: Segment }): string {
  const body = markdownHtml({ markdown: segment.lines.join("\n") });
  if (segment.kind === "markdown") {
    return body;
  }
  return `<details>\n<summary>${escapeHtml({ text: segment.summary })}</summary>\n${body}</details>\n`;
}

/**
 * Render a proposal's markdown as a local page fragment: an escaped `<h1>`, then the body.
 *
 * @param markdown the linted proposal markdown, exactly as `proposal publish` read it
 * @param title the proposal's title, written as the heading
 * @param icon an emoji shown before the title, if one was given
 * @returns the HTML fragment the page door wraps in its document shell
 */
export function renderProposalHtml({
  markdown,
  title,
  icon,
}: {
  markdown: string;
  title: string;
  icon: string | undefined;
}): string {
  const heading = icon === undefined ? title : `${icon} ${title}`;
  const lines = markdown.split("\n").filter((line) => line.trim() !== TOC);
  const body = segments({ lines })
    .map((segment) => segmentHtml({ segment }))
    .join("");
  return `<h1>${escapeHtml({ text: heading })}</h1>\n${body}`;
}

/**
 * A file extension a media name may carry: a dot and a short alphanumeric run. `extensionOf` returns
 * everything after the LAST dot, so a source such as `x.png/../../payload` would otherwise carry its path
 * segments into the name and walk out of `media/`.
 */
const SAFE_EXTENSION = /^\.[a-z0-9]{1,10}$/;

/** One placeholder file a local page loads, stored beside it. */
export interface LocalPageMediaCopy {
  /** The path exactly as written after `file:`, resolved by the caller against the draft's directory. */
  readonly source: string;
  /** Where it goes, relative to the page's own directory, which is also how the page links it. */
  readonly relative: string;
}

/**
 * Rewrite a draft's `file:` media placeholders into links relative to the page's own directory.
 *
 * A local page is served from its own directory and nothing else (`../../pages/assets.ts` says why), so a
 * placeholder pointing at the draft's directory would render as a broken image. Each one is assigned a name
 * under `media/`, keyed by the same position-and-source id the Notion upload uses, and the caller hands the
 * publisher each source under that name, so the store holds it beside the page. A line that is not a placeholder is
 * untouched.
 *
 * @param markdown the authored proposal markdown
 * @returns the markdown the renderer reads, and the files the page's store copy holds beside it
 */
export function localPageMedia({ markdown }: { markdown: string }): {
  readonly markdown: string;
  readonly copies: readonly LocalPageMediaCopy[];
} {
  const marked = withMediaMarkers({ markdown });
  const byMarker = new Map(
    marked.placeholders.map((placeholder) => {
      const extension = extensionOf({ path: placeholder.source });
      // An extension that is not a plain one is left off: the name stays inside `media/`, and a browser
      // sniffs an image's type from its bytes rather than its name.
      const relative = SAFE_EXTENSION.test(extension)
        ? `media/${placeholder.id}${extension}`
        : `media/${placeholder.id}`;
      const sigil = placeholder.kind === "image" ? "!" : "";
      return [placeholder.marker, { line: `${sigil}[${placeholder.caption}](${relative})`, relative, placeholder }];
    }),
  );
  const lines = marked.markdown.split("\n").map((line) => {
    const hit = byMarker.get(line);
    if (hit === undefined) {
      return line;
    }
    return hit.line;
  });
  return {
    copies: [...byMarker.values()].map(({ placeholder, relative }) => ({ relative, source: placeholder.source })),
    markdown: lines.join("\n"),
  };
}

/** The longest title stem a derived slug keeps, so the directory name stays readable. */
const SLUG_STEM_MAX = 48;

/**
 * The page slug a proposal published with no intake gets: its title, slugified, plus a digest of the markdown.
 *
 * Without an intake nothing records which page a later publish should replace, so the same bytes land on the
 * same slug and edited bytes land on a new one, exactly as a no-intake Notion publish creates a new page. An
 * intake is how a proposal keeps one address across edits.
 *
 * @param title the proposal's title
 * @param markdown the proposal markdown
 * @returns a slug the page door accepts
 */
export function derivedLocalPageSlug({ title, markdown }: { title: string; markdown: string }): string {
  const stem = title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, SLUG_STEM_MAX)
    .replaceAll(/-+$/g, "");
  const digest = createHash("sha256").update(markdown).digest("hex").slice(0, 12);
  if (stem.length === 0) {
    return `proposal-${digest}`;
  }
  return `proposal-${stem}-${digest}`;
}
