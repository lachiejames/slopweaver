/**
 * LINT ONE AUTHORED PAGE FRAGMENT — the defects a reader sees before reading a word: an image that will not
 * load, a machine timestamp where a sentence should be, an identifier that is not a link, and a raw machine id.
 *
 * A briefing read in the console showed charts as broken-image icons, and its prose carried a raw machine
 * timestamp. Both are mechanical, so both are refused at `page publish`
 * rather than left to the next author's care (`skills/page/reference/telemetry-briefing.md` is the shape).
 * The identifier half — a bare ticket key, `#<number>`, an incident key or URL, and a session id in prose — is
 * `./identifiers.ts`; this file carries its findings.
 *
 * ## Why an image breaks, and what this calls one that will not
 *
 * The console serves a page over http at `/api/page/<slug>/…` (`site/lib/localPageServe.ts`) from the files the
 * store holds for it, so those are the only files it can reach. The broken charts were `file:///Users/…` srcs:
 * they render when the file is opened from disk and never from the console. A `file:` src, a `~` path, a
 * `..` climb and an absolute path outside `/api/page/` all fail the same way; a relative path loads only when
 * the publish stores the file, read from the directory `--assets-from` names, which is what
 * {@link LintPageFragmentInput.hasPageFile} asks.
 * `http:`, `https:`, `data:` and `blob:` load on their own terms and are not this lint's business.
 *
 * ## What counts as prose
 *
 * The text a reader sees: every tag and attribute removed (so a `<time datetime>` or an `href` is never
 * read), and every `<code>`, `<pre>`, `<kbd>`, `<samp>`, `<script>` and `<style>` block and every comment
 * removed first, because a raw stamp quoted AS code is the subject rather than a way of telling the time.
 * A bare ISO date is not flagged; it reads, and it is in every slug and filename. A time of day
 * with a zone letter glued to it is, as is any ISO date-time.
 */
import { posix } from "node:path";

import { plainText } from "../briefing/text.js";
import type { BareRefContext } from "../outbound/linkify/bareRefs.js";
import { identifierFindings, type PageIdentifierFinding } from "./identifiers.js";
import { PAGE_REVIEW_FOLD_ATTRIBUTE } from "./reviewFold.js";

/** An image whose src cannot load from the console's http origin. */
export interface ImageOutsidePageFinding {
  readonly code: "IMAGE_OUTSIDE_PAGE";
  readonly message: string;
  readonly src: string;
}

/** A relative image src naming a file the page directory does not hold. */
export interface ImageMissingFinding {
  readonly code: "IMAGE_MISSING";
  readonly message: string;
  readonly src: string;
}

/** A machine timestamp in the text a reader sees. */
export interface RawTimestampFinding {
  readonly code: "RAW_TIMESTAMP";
  readonly message: string;
  readonly stamp: string;
}

/**
 * The review fold's own marker written by the author. `page publish` appends the one true fold
 * (`./reviewFold.ts`); an authored marker could forge a reviewed one, or a style selecting it could hide the real
 * one — a waived page once read as reviewed this way.
 */
export interface AuthoredReviewFoldFinding {
  readonly code: "AUTHORED_REVIEW_FOLD";
  readonly message: string;
}

/** One reason a fragment is not fit to publish. */
export type PageLintFinding =
  | ImageOutsidePageFinding
  | ImageMissingFinding
  | RawTimestampFinding
  | AuthoredReviewFoldFinding
  | PageIdentifierFinding;

/** The one place a finding's words are written. */
export const PageLintFindings = {
  authoredReviewFold: (): AuthoredReviewFoldFinding => ({
    code: "AUTHORED_REVIEW_FOLD",
    message: `the page names \`${PAGE_REVIEW_FOLD_ATTRIBUTE}\` itself — that marks the review fold publish appends, so an authored one could forge or hide it; remove it and let --review write the fold`,
  }),
  imageMissing: ({ src }: { src: string }): ImageMissingFinding => ({
    code: "IMAGE_MISSING",
    message: `<img src="${src}"> names a file the page's assets do not hold, so it shows as a broken image — put it under the directory --assets-from names before publishing`,
    src,
  }),
  imageOutsidePage: ({ src }: { src: string }): ImageOutsidePageFinding => ({
    code: "IMAGE_OUTSIDE_PAGE",
    message: `<img src="${src}"> cannot load from the console, which serves the page over http and reaches only the page's own stored files — put the file under the directory --assets-from names and point at it relatively`,
    src,
  }),
  rawTimestamp: ({ stamp }: { stamp: string }): RawTimestampFinding => ({
    code: "RAW_TIMESTAMP",
    message: `"${stamp}" is a machine timestamp in prose — write it as the owner reads time, in the owner's own zone (a day, a month and a 12-hour time), or wrap it in <code> when the raw form is the subject`,
    stamp,
  }),
} as const;

/** What {@link lintPageFragment} reads. */
export interface LintPageFragmentInput {
  /** The page as its author wrote it. */
  readonly fragment: string;
  /**
   * Whether the page's assets hold a FILE at this normalised, percent-decoded relative path — a
   * directory is not one, so `src=""` (which normalises to `.`) and `src="charts"` are reported missing.
   */
  readonly hasPageFile: (input: { path: string }) => boolean;
  /** What the page's identifiers resolve against — `./identifiers.ts`'s `pageIdentifierContext`. */
  readonly context: BareRefContext;
}

/** Every `<img>` opening tag, read past a `>` inside a quoted value; group 1 is everything after the name. */
const IMAGE_TAG = /<img\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
/**
 * One attribute after another, each consuming its whole value, so text inside one attribute's quotes is never
 * read as a second attribute: group 1 the name, groups 2 to 4 the value in its three quoting styles.
 */
const ATTRIBUTE = /([^\s"'=<>/`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
/** A URL scheme, the part a browser resolves before any path. */
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
/** The schemes that load on their own terms from an http page. */
const LOADING_SCHEMES = new Set(["blob", "data", "http", "https"]);
/** The one absolute path prefix the console serves page files under. */
const SERVED_PREFIX = "/api/page/";
/** Elements whose text is not prose, removed whole before reading. */
const NOT_PROSE = /<(code|pre|kbd|samp|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
/** An HTML comment. */
const COMMENT = /<!--[\s\S]*?-->/g;
/** An ISO date-time, or a time of day with a zone letter glued to it. */
const RAW_STAMP =
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?|\b\d{1,2}:\d{2}(?::\d{2})?Z\b/g;

/**
 * The value one attribute match captured, whichever quoting style carried it, or `undefined` for a bare name.
 *
 * @returns the attribute's raw value, or `undefined` when it has none
 */
function attributeValue({ match }: { match: RegExpExecArray }): string | undefined {
  const [, , doubleQuoted, singleQuoted, unquoted] = match;
  if (doubleQuoted !== undefined) {
    return doubleQuoted;
  }
  if (singleQuoted !== undefined) {
    return singleQuoted;
  }
  return unquoted;
}

/**
 * The first index at or after `from` whose character satisfies `stop`, or the text's length when none does.
 *
 * @param from where the scan starts
 * @param stop the test a character passes to end the scan
 * @returns the index the scan stopped at
 */
function indexWhere({ text, from, stop }: { text: string; from: number; stop: (char: string) => boolean }): number {
  let at = from;
  while (at < text.length && !stop(text.charAt(at))) {
    at += 1;
  }
  return at;
}

/**
 * The address of each candidate in one `srcset`, read the way the HTML parser reads it: an address is a run of
 * non-space characters (so a `data:` URL keeps its comma), a trailing comma ends the candidate, and otherwise
 * its descriptors run to the next comma.
 *
 * @returns the candidate addresses, in order
 */
function srcsetAddresses({ srcset }: { srcset: string }): readonly string[] {
  const addresses: string[] = [];
  const candidateStart = ({ from }: { from: number }): number =>
    indexWhere({ from, stop: (char) => !/[\s,]/.test(char), text: srcset });
  let at = candidateStart({ from: 0 });
  while (at < srcset.length) {
    const end = indexWhere({ from: at, stop: (char) => /\s/.test(char), text: srcset });
    const run = srcset.slice(at, end);
    const address = run.replace(/,+$/, "");
    addresses.push(address);
    const descriptorsEnd =
      address === run ? indexWhere({ from: end, stop: (char) => char === ",", text: srcset }) : end;
    at = candidateStart({ from: descriptorsEnd });
  }
  return addresses;
}

/**
 * Every image address the fragment asks a browser to load: each `src`, and each candidate of each `srcset`.
 * An image inside a comment is never loaded, so comments are removed first.
 *
 * @returns the addresses, in document order, entities in `&amp;` form decoded
 */
function imageSources({ fragment }: { fragment: string }): readonly string[] {
  const sources: string[] = [];
  for (const [, attributes] of fragment.replace(COMMENT, " ").matchAll(IMAGE_TAG)) {
    for (const match of attributes!.matchAll(ATTRIBUTE)) {
      const name = match[1]!.toLowerCase();
      const raw = attributeValue({ match });
      if ((name !== "src" && name !== "srcset") || raw === undefined) {
        continue;
      }
      const value = raw.replace(/&amp;/g, "&").trim();
      if (name === "src") {
        sources.push(value);
        continue;
      }
      sources.push(...srcsetAddresses({ srcset: value }));
    }
  }
  return sources;
}

/**
 * What one image address does when the console serves the page: loads on its own, cannot load at all, or
 * loads only if the page directory holds the file at the returned path.
 *
 * @returns the verdict, with the normalised relative path when it depends on the directory
 */
function imageReach({
  src,
}: {
  src: string;
}): { readonly kind: "loads" | "outside" } | { readonly kind: "relative"; readonly path: string } {
  const scheme = SCHEME.exec(src);
  if (scheme !== null) {
    return { kind: LOADING_SCHEMES.has(scheme[1]!.toLowerCase()) ? "loads" : "outside" };
  }
  if (src.startsWith("//") || src.startsWith(SERVED_PREFIX)) {
    return { kind: "loads" };
  }
  if (src.startsWith("/") || src.startsWith("~")) {
    return { kind: "outside" };
  }
  const path = posix.normalize(decodedPath({ path: src.split(/[?#]/)[0]! }));
  if (path === ".." || path.startsWith("../")) {
    return { kind: "outside" };
  }
  return { kind: "relative", path };
}

/**
 * A URL path as the file name it names: `pool%20may.png` is the file `pool may.png`. A malformed escape is
 * kept as written, so the directory lookup reports it missing rather than this throwing.
 *
 * @returns the percent-decoded path
 */
function decodedPath({ path }: { path: string }): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * The text a reader sees: non-prose blocks and comments out first, then every tag, attributes with them.
 *
 * @returns the prose, whitespace collapsed
 */
function prose({ fragment }: { fragment: string }): string {
  return plainText({ html: fragment.replace(COMMENT, " ").replace(NOT_PROSE, " ") });
}

/**
 * A CSS escape: a hex code point and its one optional whitespace terminator (CRLF counting as one, as CSS reads it),
 * or a backslash before any other character.
 */
const CSS_ESCAPE = /\\(?:([0-9a-f]{1,6})(?:\r\n|[ \t\n\r\f])?|(.))/giu;

/**
 * Whether the fragment names the review fold's marker, CSS escapes decoded first — a CSS escape hid the real fold
 * (`[data-page-\72 eview]`), which carries no literal marker. Hiding it by structure (`details:last-of-type`) names
 * nothing and is stated residue (`skills/page/reference/review-record.md`).
 */
function namesReviewFold({ fragment }: { fragment: string }): boolean {
  const decoded = fragment.replace(CSS_ESCAPE, (_escape, hex: string | undefined, char: string | undefined) => {
    if (hex !== undefined) {
      return String.fromCodePoint(Number.parseInt(hex, 16));
    }
    return char!;
  });
  return decoded.toLowerCase().includes(PAGE_REVIEW_FOLD_ATTRIBUTE);
}

/**
 * Every reason this fragment is not fit to publish: images that will not load from the console, raw timestamps
 * in its prose, an authored review-fold marker, identifiers that are not links and raw machine ids. Each distinct
 * one is reported once.
 *
 * @returns the findings — images, stamps, the fold marker, then identifiers — empty when the fragment is fit
 */
export function lintPageFragment({
  fragment,
  hasPageFile,
  context,
}: LintPageFragmentInput): readonly PageLintFinding[] {
  const findings: PageLintFinding[] = [];
  for (const src of new Set(imageSources({ fragment }))) {
    const reach = imageReach({ src });
    if (reach.kind === "outside") {
      findings.push(PageLintFindings.imageOutsidePage({ src }));
    } else if (reach.kind === "relative" && !hasPageFile({ path: reach.path })) {
      findings.push(PageLintFindings.imageMissing({ src }));
    }
  }
  const stamps = [...prose({ fragment }).matchAll(RAW_STAMP)].map(([stamp]) => stamp);
  for (const stamp of new Set(stamps)) {
    findings.push(PageLintFindings.rawTimestamp({ stamp }));
  }
  if (namesReviewFold({ fragment })) {
    findings.push(PageLintFindings.authoredReviewFold());
  }
  findings.push(...identifierFindings({ context, fragment }));
  return findings;
}
