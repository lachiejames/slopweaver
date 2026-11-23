/**
 * What one CodeRabbit comment SAYS about itself — its severity, its finding type, its category — and what a
 * thread's later comments say about whether it was addressed. Pure text recognition, no judgement.
 *
 * Every recogniser here matches a format OBSERVED on a live pull request, never a guess at one, and each
 * answers `unknown` rather than a neighbouring value when the text does not match. Measured on live
 * `acme/acme-admin` pull requests (reproduce with
 * `slopweaver github read <pull-request-url> --json`):
 *
 * - the opener's first line is `_<category>_ | _<severity>_ | _<effort>_` on current reviews, and
 *   `_<type>_ | _<severity>_` on older ones; the finding TYPE is carried separately as
 *   `<!-- cr-indicator-types:potential_issue -->`;
 * - CodeRabbit EDITS its own opener to append `✅ Addressed in commit <sha>` or
 *   `✅ Addressed in commits <sha> to <sha>`, and replies `✅ Confirmed as addressed by @<login>` once
 *   the author says so. Both are CodeRabbit's CLAIM: where the author disputed an automatic range and
 *   CodeRabbit agreed it was stale, so the report calls this "reported addressed", never "fixed";
 * - the fleet's own convention (`skills/github/reference/coderabbit.md`) is to reply naming the commit a fix
 *   landed in — `Fixed in \`<sha>\`` — which is the second signal, from the other side of the thread.
 */

import { CODERABBIT_LOGIN } from "./reviewState.js";

/** CodeRabbit's own severity word, or `unknown` when the opener carries none this recogniser knows. */
export type CoderabbitSeverity = "critical" | "major" | "minor" | "trivial" | "unknown";

/** CodeRabbit's finding type — the HTML marker first, the legacy header phrase second. */
export type CoderabbitFindingType = "potential-issue" | "refactor-suggestion" | "nitpick" | "unknown";

/** Which recognised line says a finding was addressed. */
export type AddressMarkerKind = "commit-marker" | "confirmed-marker";

/** One comment on a review thread, as the audit reads it. */
export interface YieldComment {
  /** Null when GitHub reports no author, which a deleted account produces. */
  readonly authorLogin: string | null;
  readonly body: string;
  readonly url: string;
}

/**
 * Each severity word, bounded by non-letters rather than `\b`: the header wraps it in underscores
 * (`_🟡 Minor_`), and `_` is a word character, so `\bMinor\b` never matches there.
 */
const SEVERITIES: readonly (readonly [RegExp, CoderabbitSeverity])[] = [
  [/(?<![A-Za-z])Critical(?![A-Za-z])/u, "critical"],
  [/(?<![A-Za-z])Major(?![A-Za-z])/u, "major"],
  [/(?<![A-Za-z])Minor(?![A-Za-z])/u, "minor"],
  [/(?<![A-Za-z])Trivial(?![A-Za-z])/u, "trivial"],
];

/** The type words a two-part header (`_⚠️ Potential issue_ | _🟠 Major_`) spells out, before the indicator comment existed. */
const TWO_PART_TYPES: readonly (readonly [RegExp, CoderabbitFindingType])[] = [
  [/Potential issue/iu, "potential-issue"],
  [/Refactor suggestion/iu, "refactor-suggestion"],
  [/Nitpick/iu, "nitpick"],
];

const INDICATOR_TYPES: Readonly<Record<string, CoderabbitFindingType>> = {
  nitpick: "nitpick",
  potential_issue: "potential-issue",
  refactor_suggestion: "refactor-suggestion",
};

/**
 * Whether a login is CodeRabbit's, compared case-insensitively and without GitHub's `[bot]` suffix.
 *
 * @param login the comment or review author, or null when GitHub reports none
 * @returns true only for CodeRabbit itself — never for any other bot
 */
export function isCoderabbit({ login }: { login: string | null }): boolean {
  return login?.toLowerCase().replace(/\[bot\]$/u, "") === CODERABBIT_LOGIN;
}

/** The opener's header line — the first line shaped `_…_ | _…_` — or undefined when there is none. */
function headerLine({ body }: { body: string }): string | undefined {
  return body.split("\n").find((line) => /^_[^_].*_\s*\|\s*_.*_\s*$/u.test(line.trim()));
}

/**
 * The severity, finding type and category CodeRabbit wrote on a thread's opening comment.
 *
 * @param body the opening comment's markdown
 * @returns each dimension, `unknown` wherever the opener does not say, and the raw header line
 */
export function findingHeader({ body }: { body: string }): {
  readonly severity: CoderabbitSeverity;
  readonly findingType: CoderabbitFindingType;
  readonly category: string;
  readonly rawHeader: string;
} {
  const header = headerLine({ body });
  if (header === undefined) {
    return { category: "unknown", findingType: indicatorType({ body }), rawHeader: "", severity: "unknown" };
  }
  const segments = header
    .split("|")
    .map((segment) => segment.trim().replace(/^_|_$/gu, "").trim())
    .filter((segment) => segment.length > 0);
  const severity = SEVERITIES.find(([pattern]) => pattern.test(header));
  let findingType = indicatorType({ body });
  if (findingType === "unknown") {
    const spelled = TWO_PART_TYPES.find(([pattern]) => pattern.test(header));
    findingType = spelled === undefined ? "unknown" : spelled[1];
  }
  return {
    category: categoryOf({ segments }),
    findingType,
    rawHeader: header.trim(),
    severity: severity === undefined ? "unknown" : severity[1],
  };
}

/** The type the HTML indicator marker names, or `unknown`. */
function indicatorType({ body }: { body: string }): CoderabbitFindingType {
  const match = /<!--\s*cr-indicator-types:([a-z_]+)/u.exec(body);
  if (match === null) {
    return "unknown";
  }
  const mapped = INDICATOR_TYPES[match[1]!];
  if (mapped === undefined) {
    return "unknown";
  }
  return mapped;
}

/**
 * The category segment of a current three-part header, emoji stripped; `unknown` on the legacy two-part
 * header, whose first segment is a TYPE rather than a category.
 */
function categoryOf({ segments }: { segments: readonly string[] }): string {
  if (segments.length < 3) {
    return "unknown";
  }
  const words = segments[0]!.replace(/^[^\p{L}]+/u, "").trim();
  return words.length === 0 ? "unknown" : words;
}

/** The open fence after one line: a fence line opens one; inside one, only a bare matching run closes it. */
function fenceStep({ fence, line }: { fence: string | undefined; line: string }): {
  fence: string | undefined;
  isFenceLine: boolean;
} {
  const marker = /^(`{3,}|~{3,})/u.exec(line);
  if (marker === null) {
    return { fence, isFenceLine: false };
  }
  const run = marker[1]!;
  if (fence === undefined) {
    return { fence: run, isFenceLine: true };
  }
  // CommonMark: a closing fence is the opening character, at least as long, and nothing after it.
  const closes = run[0] === fence[0] && run.length >= fence.length && line.slice(run.length).trim() === "";
  return { fence: closes ? undefined : fence, isFenceLine: true };
}

/**
 * Lines outside fenced code blocks (backtick or tilde, closed only by the same character at least as long),
 * blockquotes (markdown `>` and HTML `<blockquote>` alike), HTML `<pre>` blocks and lines indented as code
 * — where a quoted marker is not a claim. Each line says whether
 * it OPENS a paragraph: after a blank line, at column 0 — the only place a line cannot be the lazy continuation
 * of a quote above it.
 */
function unquotedLines({
  body,
}: {
  body: string;
}): readonly { readonly line: string; readonly opensParagraph: boolean }[] {
  const lines: { line: string; opensParagraph: boolean }[] = [];
  let fence: string | undefined;
  let quoteDepth = 0;
  let afterBlank = true;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    const opensParagraph = afterBlank && raw === raw.trimStart();
    afterBlank = line === "";
    const step = fenceStep({ fence, line });
    fence = step.fence;
    if (step.isFenceLine) {
      continue;
    }
    const fenced = fence !== undefined;
    const opens = [...line.matchAll(/<(?:blockquote|pre)\b/giu)].length;
    const closes = [...line.matchAll(/<\/(?:blockquote|pre)>/giu)].length;
    const indentedCode = /^(?: {4}|\t)/u.test(raw);
    const quoted = fenced || indentedCode || quoteDepth > 0 || opens > 0 || line.startsWith(">");
    quoteDepth = Math.max(0, quoteDepth + opens - closes);
    if (!quoted) {
      lines.push({ line, opensParagraph });
    }
  }
  return lines;
}

/**
 * Every addressed-marker line in one comment CodeRabbit wrote. A marker in anybody else's comment is a
 * quotation of one, and counts for nothing. CodeRabbit writes its marker as a paragraph of its own, so a marker
 * line that does not open a paragraph is not counted — which is what closes every quote-continuation shape.
 *
 * @param comment one thread comment
 * @returns the recognised kinds with their exact lines, empty when there are none
 */
export function addressMarkers({
  comment,
}: {
  comment: YieldComment;
}): readonly { readonly kind: AddressMarkerKind; readonly line: string }[] {
  if (!isCoderabbit({ login: comment.authorLogin })) {
    return [];
  }
  const found: { kind: AddressMarkerKind; line: string }[] = [];
  for (const { line, opensParagraph } of unquotedLines({ body: comment.body })) {
    if (!opensParagraph) {
      continue;
    }
    if (/^✅\s*Addressed in commits?\s+[0-9a-f]{7,40}/u.test(line)) {
      found.push({ kind: "commit-marker", line });
    } else if (/^✅\s*Confirmed as addressed by\s+@\S+/u.test(line)) {
      found.push({ kind: "confirmed-marker", line });
    }
  }
  return found;
}

/**
 * A commit cue, then the hex run it names, optionally in backticks. What may FOLLOW the run is an allowlist —
 * closing punctuation, then whitespace or the end — so it can never be the head of a longer token in any script
 * (a blacklist missed characters).
 */
const COMMIT_CITATION =
  /(?:\b(?:fixed|addressed|done|resolved|landed|applied|pushed|handled|taken|changed|updated|removed|added|moved|reworded)\s+(?:in|by|with|at|via)\s+(?:commit\s+)?|\bcommits?:?\s+|\/commit\/)`?([0-9a-f]{7,40})(?=`?[.,;:!?)\]'"]*(?:\s|$))/giu;

/**
 * Whether a reply from someone other than CodeRabbit names a commit — the fleet's convention for a fix
 * (`Fixed in \`<sha>\``). A hex run counts only right after a commit cue — `fixed in`, `commit`, a
 * `/commit/` link — and only when it carries a digit and a letter and is not the head of a longer hex or
 * dashed run: a request id `94c5152d-1234-…` quoted in a reply is not a commit.
 *
 * @param comment one thread comment
 * @returns the first commit-looking token outside quotes, or undefined
 */
export function replyCommitCitation({ comment }: { comment: YieldComment }): string | undefined {
  if (isCoderabbit({ login: comment.authorLogin })) {
    return undefined;
  }
  for (const { line } of unquotedLines({ body: comment.body })) {
    for (const match of line.matchAll(COMMIT_CITATION)) {
      const token = match[1]!.toLowerCase();
      if (/[0-9]/u.test(token) && /[a-f]/u.test(token)) {
        return token;
      }
    }
  }
  return undefined;
}

/**
 * The bold one-line summary CodeRabbit puts under a finding's header — what a reader skims to judge it.
 *
 * @param body the opening comment of a CodeRabbit thread
 * @returns the summary without its asterisks, or "" when no line is wholly bold
 */
export function findingTitle({ body }: { body: string }): string {
  const line = body.split("\n").find((one) => /^\*\*[^*].*\*\*$/u.test(one.trim()));
  if (line === undefined) {
    return "";
  }
  return line.trim().slice(2, -2).trim();
}

/**
 * The finding counts a CodeRabbit review BODY carries — nitpicks and outside-diff comments are posted there,
 * never as threads, so nothing records what became of them. One count per section per review, read off the
 * outer `<summary>` only: the per-file summaries nested inside it repeat the same findings.
 *
 * @param body one CodeRabbit review's body
 * @returns the nitpick and outside-diff counts, each null when the review has no such section
 */
export function reviewBodyCounts({ body }: { body: string }): {
  readonly nitpicks: number | null;
  readonly outsideDiff: number | null;
} {
  const nitpicks = /Nitpick comments \((\d+)\)/u.exec(body);
  const outside = /Outside diff range comments \((\d+)\)/u.exec(body);
  return {
    nitpicks: nitpicks === null ? null : Number(nitpicks[1]),
    outsideDiff: outside === null ? null : Number(outside[1]),
  };
}
