/**
 * Every reason `policy diff` refuses to render, as one discriminated union.
 *
 * The refusals that matter are the coverage ones. A reader of a large diff needs to know why each change was made
 * and what was wrong with the old text, as a pull request reviewer does. So a material change the record does not explain is not a page with a gap
 * in it — it is no page. That makes "every change says why" a property of the schema rather than of a reviewer.
 *
 * A record with several problems reports all of them at once, so the failure value is a list of these.
 */

/** The record file did not parse, or broke one of its own rules. */
export interface InvalidRecordIssue {
  readonly code: "INVALID_RECORD";
  readonly message: string;
}

/** A before or after document, or an image one of them shows, could not be read. */
export interface UnreadableSourceIssue {
  readonly code: "UNREADABLE_SOURCE";
  readonly message: string;
  readonly source: string;
}

/** A material change no record entry explains. */
export interface UncoveredRowIssue {
  readonly code: "UNCOVERED_ROW";
  readonly message: string;
  readonly document: string;
  readonly excerpt: string;
}

/** A material change two record entries both claim. */
export interface AmbiguousRowIssue {
  readonly code: "AMBIGUOUS_ROW";
  readonly message: string;
  readonly document: string;
  readonly excerpt: string;
}

/** A record entry — a change or a mark — that matched no line, so its text no longer describes the diff. */
export interface UnusedEntryIssue {
  readonly code: "UNUSED_ENTRY";
  readonly message: string;
  readonly document: string;
  readonly entry: string;
}

/** A link target naming a Vanta object the atlas does not hold. */
export interface UnresolvedLinkIssue {
  readonly code: "UNRESOLVED_LINK";
  readonly message: string;
  readonly target: string;
}

/** A recognised identifier left as plain text, because nothing could resolve it to a link. */
export interface UnlinkedIdentifierIssue {
  readonly code: "UNLINKED_IDENTIFIER";
  readonly message: string;
  readonly identifier: string;
}

/** An address a page would publish that could run as script, or that a markdown link cannot hold. */
export interface UnsafeLinkIssue {
  readonly code: "UNSAFE_LINK";
  readonly message: string;
  readonly url: string;
}

/** One reason the diff cannot be rendered. */
export type DocDiffIssue =
  | InvalidRecordIssue
  | UnreadableSourceIssue
  | UncoveredRowIssue
  | AmbiguousRowIssue
  | UnusedEntryIssue
  | UnresolvedLinkIssue
  | UnlinkedIdentifierIssue
  | UnsafeLinkIssue;

/** The longest excerpt of a line an issue quotes. */
const EXCERPT_CHARS = 120;

/** A line cut to a readable excerpt. */
function excerptOf({ text }: { text: string }): string {
  if (text.length <= EXCERPT_CHARS) {
    return text;
  }
  return `${text.slice(0, EXCERPT_CHARS - 1)}…`;
}

/** The one place a diff issue's words are written. */
export const DocDiffIssues = {
  ambiguousRow: ({
    document,
    text,
    ids,
  }: {
    document: string;
    text: string;
    ids: readonly string[];
  }): AmbiguousRowIssue => ({
    code: "AMBIGUOUS_ROW",
    document,
    excerpt: excerptOf({ text }),
    message: `${document}: "${excerptOf({ text })}" is matched by changes ${ids.join(", ")} — narrow one of their match strings so exactly one explains it`,
  }),
  invalidRecord: ({ detail }: { detail: string }): InvalidRecordIssue => ({
    code: "INVALID_RECORD",
    message: `the diff record is not valid: ${detail}`,
  }),
  uncoveredRow: ({
    document,
    text,
    side,
  }: {
    document: string;
    text: string;
    side: "after" | "before";
  }): UncoveredRowIssue => ({
    code: "UNCOVERED_ROW",
    document,
    excerpt: excerptOf({ text }),
    message: `${document}: a material change says nothing about why — add a change whose match is a substring of this ${side} line: "${excerptOf({ text })}"`,
  }),
  unlinkedIdentifier: ({ identifier }: { identifier: string }): UnlinkedIdentifierIssue => ({
    code: "UNLINKED_IDENTIFIER",
    identifier,
    message: `"${identifier}" is an identifier nothing could resolve to a link — add it to the record's links, or sync the atlas that holds it`,
  }),
  unreadableSource: ({ source, cause }: { source: string; cause: string }): UnreadableSourceIssue => ({
    code: "UNREADABLE_SOURCE",
    message: `could not read ${source}: ${cause}`,
    source,
  }),
  unresolvedLink: ({ target }: { target: string }): UnresolvedLinkIssue => ({
    code: "UNRESOLVED_LINK",
    message: `link target ${target} names nothing the Vanta atlas holds — run slopweaver atlas vanta sync, or give an https URL`,
    target,
  }),
  unsafeLink: ({ url, why }: { url: string; why: string }): UnsafeLinkIssue => ({
    code: "UNSAFE_LINK",
    message: `the address ${url} is refused: ${why}`,
    url,
  }),
  unusedEntry: ({
    document,
    entry,
    kind,
  }: {
    document: string;
    entry: string;
    kind: "change" | "mark";
  }): UnusedEntryIssue => ({
    code: "UNUSED_ENTRY",
    document,
    entry,
    message: `${document}: ${kind} ${entry} matches no line it could apply to — its match strings no longer describe the diff`,
  }),
} as const;
