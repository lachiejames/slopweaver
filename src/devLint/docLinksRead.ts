/**
 * The reading half of the doc-links gate ({@link "./docLinks.js"}): one markdown document, drawn the way GitHub
 * draws it, as the anchors it offers and the local links it makes. Pure; the tree and the verdict live beside it.
 */

import { posix } from "node:path";
import GithubSlugger from "github-slugger";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { parse } from "parse5";
import { importedPathsOf } from "../canon/alwaysOnDocs.js";
import { childrenOf, type Element, isElement, type Node } from "../prformat/drawnNodes.js";

/**
 * One local link, resolved to a repo-relative target.
 *
 * @internal — produced and consumed by the pure cores below.
 */
export interface LocalDocLink {
  readonly sourcePath: string;
  /** The source line, or undefined when a rendered target cannot be found in the text as written. */
  readonly line: number | undefined;
  readonly targetPath: string;
  readonly fragment: string | undefined;
  /**
   * How it was written. An `@`-import is a tree edge and a missing file but never a fragment; an image is a missing
   * file but never a tree edge, since nobody navigates through one; a link inside a `template` and a source reference
   * are checked, never an edge.
   */
  readonly via: "link" | "image" | "template" | "import" | "source";
}

/**
 * The page a link is clicked from, as GitHub serves it, under two stand-in origins: a local target lands on the page's
 * own origin whichever it is, while one naming a host (`//host`, `\\host`) keeps that host under both — so no link can
 * pass as local by naming a stand-in.
 */
const STAND_IN_ORIGINS = ["https://one.invalid", "https://two.invalid"] as const;
const GITHUB_BLOB = "/owner/repo/blob/main/";
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
/**
 * The elements GitHub's HTML sanitiser keeps, so the only ones whose `id` or `name` survives to be jumped to. An id
 * on anything else — `<input>`, a made-up tag — is drawn as nothing, and a link to it lands nowhere.
 */
const KEPT_TAGS = new Set(
  "a abbr b bdo blockquote br caption cite code dd del details dfn div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p picture pre q rp rt ruby s samp small source span strike strong sub summary sup table tbody td tfoot th thead time tr tt ul var wbr".split(
    " ",
  ),
);

/** One markdown document as GitHub draws it: the anchors it offers and the local targets it links to. */
interface RenderedDoc {
  readonly anchors: ReadonlySet<string>;
  readonly targets: readonly { readonly raw: string; readonly via: RenderedVia }[];
}

type RenderedVia = "link" | "image" | "template";

/** How a drawn target is written: inside a `template` it is checked but never navigated, else by its element. */
function viaOf({ element, inTemplate }: { element: Element; inTemplate: boolean }): RenderedVia {
  if (inTemplate) {
    return "template";
  }
  if (element.tagName === "img") {
    return "image";
  }
  return "link";
}

/**
 * The URL standard's percent-decode, then a strict UTF-8 decode: every well-formed escape becomes its byte, a malformed
 * one (`%zz`) stays literal, and a result that is not valid UTF-8 is `undefined` — no decoding at all, never a partial one.
 */
function percentDecoded({ text }: { text: string }): string | undefined {
  const bytes = new TextEncoder().encode(text);
  const out: number[] = [];
  for (let at = 0; at < bytes.length; at += 1) {
    const pair = String.fromCharCode(...bytes.subarray(at + 1, at + 3));
    if (bytes[at] === 0x25 && /^[0-9A-Fa-f]{2}$/.test(pair)) {
      out.push(Number.parseInt(pair, 16));
      at += 2;
    } else {
      out.push(bytes[at]!);
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(out));
  } catch {
    return undefined;
  }
}

/** A path percent-decoded, or as written when its escapes do not decode to UTF-8. */
function decoded({ text }: { text: string }): string {
  const result = percentDecoded({ text });
  if (result === undefined) {
    return text;
  }
  return result;
}

/**
 * The ids a fragment can land on, in the HTML standard's order: the fragment exactly as written, then its
 * percent-decoded form when that is valid UTF-8. A browser tries both, so a link is broken only when neither is an
 * anchor. Pure.
 *
 * @param fragment the text after `#`, exactly as the link wrote it
 * @returns the candidate ids, the as-written one first, never a duplicate
 */
export function fragmentCandidates({ fragment }: { fragment: string }): readonly string[] {
  const result = percentDecoded({ text: fragment });
  return result === undefined || result === fragment ? [fragment] : [fragment, result];
}

/** A node's text as a reader sees it, every descendant's text in document order. */
function textOf({ node }: { node: Node }): string {
  if ("value" in node) {
    return node.value;
  }
  return childrenOf({ node })
    .map((child) => textOf({ node: child }))
    .join("");
}

/** An element's attribute, or undefined when it has none or it is empty. */
function attributeOf({ element, name }: { element: Element; name: string }): string | undefined {
  const value = element.attrs.find((attr) => attr.name === name)?.value;
  return value === "" ? undefined : value;
}

/**
 * Every node under `node`, itself first, each marked when it sits inside a `template`. Whether GitHub draws a
 * template's content is not knowable here, so the reader takes the strict side of both: a target inside one is
 * still checked, but it is never a tree edge, and an anchor inside one is never offered.
 */
function drawnNodesOf({ node, inTemplate }: { node: Node; inTemplate: boolean }): readonly {
  readonly node: Node;
  readonly inTemplate: boolean;
}[] {
  const within = inTemplate || (isElement(node) && node.tagName === "template");
  return [
    { inTemplate, node },
    ...childrenOf({ node }).flatMap((child) => drawnNodesOf({ inTemplate: within, node: child })),
  ];
}

/**
 * The anchors one element offers: a heading's GitHub id, an `id` on any element the sanitiser keeps, and a `name` on
 * an `a` alone — the only element whose `name` the HTML standard's indicated-element rule will jump to.
 */
function anchorsOf({ element, slugger }: { element: Element; slugger: GithubSlugger }): readonly string[] {
  const heading = HEADING_TAGS.has(element.tagName) ? [slugger.slug(textOf({ node: element }))] : [];
  const kept = KEPT_TAGS.has(element.tagName);
  const explicit = [
    kept ? attributeOf({ element, name: "id" }) : undefined,
    element.tagName === "a" ? attributeOf({ element, name: "name" }) : undefined,
  ];
  return [...heading, ...explicit.filter((anchor) => anchor !== undefined)];
}

/** A URL attribute with the leading and trailing C0 controls and spaces a browser strips, and nothing else: not U+00A0. */
function urlTrimmed({ url }: { url: string | undefined }): string | undefined {
  if (url === undefined) {
    return undefined;
  }
  const stripped = ({ at }: { at: number }): boolean => url.charCodeAt(at) <= 0x20;
  let start = 0;
  let end = url.length;
  while (start < end && stripped({ at: start })) {
    start += 1;
  }
  while (end > start && stripped({ at: end - 1 })) {
    end -= 1;
  }
  return url.slice(start, end);
}

/** Where one element links: an anchor's `href` or an image's `src`, trimmed as a browser trims a URL, else nowhere. */
function targetOf({ element }: { element: Element }): string | undefined {
  if (element.tagName === "a") {
    return urlTrimmed({ url: attributeOf({ element, name: "href" }) });
  }
  if (element.tagName === "img") {
    return urlTrimmed({ url: attributeOf({ element, name: "src" }) });
  }
  return undefined;
}

/**
 * Render a markdown document the way GitHub does — CommonMark plus GFM, raw HTML kept — and read what the drawing
 * offers and links to. A source reader chased CommonMark one construct at a time here (a multi-backtick span, a
 * fence closed only by a long enough marker, a title in single quotes or with an escaped quote, an angle-bracket
 * destination, a single-quoted `id`): four review rounds, each finding the next. `src/prformat/renderedTables.ts`
 * took the same turn after eleven. What the renderer draws is what a reader clicks, so the gate reads that.
 */
function renderedDoc({ content }: { content: string }): RenderedDoc {
  const html = micromark(content, {
    allowDangerousHtml: true,
    extensions: [gfm(), { disable: { null: ["strikethrough"] } }],
    htmlExtensions: [gfmHtml()],
  });
  const elements = drawnNodesOf({ inTemplate: false, node: parse(html, { scriptingEnabled: false }) }).flatMap(
    ({ node, inTemplate }) => (isElement(node) ? [{ element: node, inTemplate }] : []),
  );
  const slugger = new GithubSlugger();
  const anchors = new Set(
    elements.filter(({ inTemplate }) => !inTemplate).flatMap(({ element }) => anchorsOf({ element, slugger })),
  );
  const targets = elements.flatMap(({ element, inTemplate }) => {
    const raw = targetOf({ element });
    return raw === undefined ? [] : [{ raw, via: viaOf({ element, inTemplate }) }];
  });
  return { anchors, targets };
}

/**
 * The 1-based source line a rendered target was written on: the first place at or after `from` its text appears,
 * as written or percent-decoded, else anywhere. The rendering keeps no source positions, so a target whose text
 * also appears EARLIER inside code is reported at the first later match — the verdict is exact, the line a pointer.
 */
function sourceLineOf({ content, raw, from }: { content: string; raw: string; from: number }): {
  readonly line: number | undefined;
  readonly next: number;
} {
  const needles = [raw, decoded({ text: raw })];
  const firstAt = ({ start }: { start: number }): number => {
    const hits = needles.map((needle) => content.indexOf(needle, start)).filter((hit) => hit !== -1);
    return hits.length === 0 ? -1 : Math.min(...hits);
  };
  let at = firstAt({ start: from });
  if (at === -1) {
    at = firstAt({ start: 0 });
  }
  if (at === -1) {
    return { line: undefined, next: from };
  }
  return { line: content.slice(0, at).split("\n").length, next: at + 1 };
}

/**
 * Every anchor a markdown document offers: GitHub's heading ids, in document order with duplicate suffixes,
 * plus every surviving explicit `id`, and `name` on an `a`. Pure.
 *
 * @param content the document's text
 * @returns the set of fragment names a link may target
 */
export function markdownAnchorsIn({ content }: { content: string }): ReadonlySet<string> {
  return renderedDoc({ content }).anchors;
}

/**
 * Resolve a raw link target the way a click does: the URL standard's own parser (`URL`), against the page's GitHub
 * blob URL, so tabs and newlines are dropped, `\` is a separator, `\\host` is external and dot segments collapse
 * exactly as a browser does them. GitHub rewrites a path-absolute link (`/docs/a.md`) to the repository root, and a
 * link climbing above the root lands outside the checkout. Answers the decoded repo-relative path (`.` for the root)
 * and the fragment as the URL serialises it, or undefined for an external target: an absolute URL, whatever its origin,
 * or one that leaves the page's origin under either stand-in.
 */
function resolveTarget({
  raw,
  sourcePath,
}: {
  raw: string;
  sourcePath: string;
}): { readonly targetPath: string; readonly fragment: string | undefined } | undefined {
  if (URL.canParse(raw)) {
    return undefined;
  }
  const page = sourcePath.split("/").map(encodeURIComponent).join("/");
  // A relative reference the parser refuses (`//`, a host with no name) goes nowhere when clicked: broken, not external.
  if (!STAND_IN_ORIGINS.every((origin) => URL.canParse(raw, `${origin}${GITHUB_BLOB}${page}`))) {
    return { fragment: undefined, targetPath: `/(not a URL)/${raw}` };
  }
  const urls = STAND_IN_ORIGINS.map((origin) => {
    try {
      const resolved = new URL(raw, `${origin}${GITHUB_BLOB}${page}`);
      return resolved.origin === origin ? resolved : undefined;
    } catch {
      return undefined;
    }
  });
  const url = urls[0];
  if (url === undefined || urls[1] === undefined) {
    return undefined;
  }
  const fragment = url.hash === "" ? undefined : url.hash.slice(1);
  // GitHub rewrites a leading `/` to the root, whatever follows it; a leading `\` it leaves alone.
  const pathAbsolute = raw.startsWith("/");
  const inBlob = !pathAbsolute && `${url.pathname}/`.startsWith(GITHUB_BLOB);
  if (!inBlob && !pathAbsolute) {
    // Rooted, so no tracked path (git lists only relative ones) can ever match it.
    return { fragment, targetPath: `/(outside the checkout)/${raw}` };
  }
  const rooted = url.pathname.slice(inBlob ? GITHUB_BLOB.length : 1);
  if (rooted === "") {
    return { fragment, targetPath: "." };
  }
  // Decoded one segment at a time; one trailing slash is kept on the result, since it names a directory only. A segment that names no filename —
  // an empty one (`a//b`, `.//`), an encoded `/` (`%2F`), or bytes that are not UTF-8 (`%FF`) — is reported under a
  // rooted path rather than aliased onto the root, a nested file or a literally-named one.
  const segments = rooted
    .replace(/\/$/, "")
    .split("/")
    .map((segment) => percentDecoded({ text: segment }));
  if (segments.some((segment) => segment === undefined || segment === "" || segment.includes("/"))) {
    return { fragment, targetPath: `/(no such filename)/${raw}` };
  }
  const directory = rooted.endsWith("/") ? "/" : "";
  return { fragment, targetPath: `${segments.join("/")}${directory}` };
}

/**
 * One markdown document read once: the anchors it offers, every local link GitHub draws in it — inline and reference
 * links, images, raw HTML `href`/`src` — each resolved relative to the document, then its `@`-imports. Code is never
 * a link, and a reference definition nothing uses is drawn as nothing, so it is not one either. Pure.
 *
 * The `@`-imports are NOT read from the drawing: Claude Code reads the source, where `@a*b.md*` is one specifier
 * that emphasis would split in two once rendered. They are exactly `importedPathsOf`'s, the always-on measure's
 * own reader, so the two gates cannot disagree on what a document imports.
 *
 * @param content the document's text
 * @param path the document's repo-relative path, which relative targets resolve against
 * @returns the anchors, and each local link in document order
 */
export function markdownDocOf({ content, path }: { content: string; path: string }): {
  readonly anchors: ReadonlySet<string>;
  readonly links: readonly LocalDocLink[];
} {
  const { anchors, targets } = renderedDoc({ content });
  const links: LocalDocLink[] = [];
  let from = 0;
  for (const { raw, via } of targets) {
    const resolved = resolveTarget({ raw, sourcePath: path });
    if (resolved !== undefined) {
      const { line, next } = sourceLineOf({ content, from, raw });
      from = next;
      links.push({ ...resolved, line, sourcePath: path, via });
    }
  }
  from = 0;
  for (const targetPath of importedPathsOf({ content, from: path })) {
    const { line, next } = sourceLineOf({ content, from, raw: posix.basename(targetPath) });
    from = next;
    links.push({ fragment: undefined, line, sourcePath: path, targetPath, via: "import" });
  }
  return { anchors, links };
}

/**
 * Every local link in a markdown document — {@link markdownDocOf}'s links alone. Pure.
 *
 * @param content the document's text
 * @param path the document's repo-relative path, which relative targets resolve against
 * @returns each local link, in document order
 */
export function markdownLinksIn({ content, path }: { content: string; path: string }): readonly LocalDocLink[] {
  return markdownDocOf({ content, path }).links;
}
