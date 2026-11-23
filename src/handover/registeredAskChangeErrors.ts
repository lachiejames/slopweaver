/**
 * The ways an edit to a never-started registered ask (`./registeredAskChange.ts`) is refused with nothing written.
 *
 * Its own small union per `.claude/rules/error-handling.md`: the row stopped being one the Queue draws as a
 * registered ask between the verb resolving it and the write, the edited row would still read malformed, its file moved under the verb, its body carries no
 * single heading to correct, it mixes line endings, the edit would change a front-matter line it does not name, it changed while being edited, or the front-matter writer refused the splice. Every variant carries `reasons`, the
 * refusal as the lines a verb prints, because the front-matter writer's own refusals are plural.
 *
 * Pure: every factory takes what it names.
 */

import type { FrontMatterError } from "./frontmatterErrors.js";

/** The row no longer reads as a registered ask the Queue draws — a run opened, it settled, the owner ruled. */
export interface RegisteredAskNotEligibleError {
  readonly code: "NOT_A_REGISTERED_ASK";
  readonly message: string;
  readonly slug: string;
  readonly reasons: readonly string[];
}

/** The file could not be read or written, or now holds a different row. */
export interface RegisteredAskFileError {
  readonly code: "ROW_FILE";
  readonly message: string;
  readonly path: string;
  readonly reasons: readonly string[];
}

/** The body carries the old question's H1 zero times or more than once, so there is no telling which to restate. */
export interface RegisteredAskHeadingError {
  readonly code: "HEADING_NOT_UNIQUE";
  readonly message: string;
  readonly count: number;
  readonly reasons: readonly string[];
}

/** The old question's H1 is not the body's first line, where the register writes it. */
export interface RegisteredAskHeadingMisplacedError {
  readonly code: "HEADING_MISPLACED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** There is no closed front-matter block, so the body cannot be told from it. */
export interface RegisteredAskNoFrontMatterError {
  readonly code: "NO_FRONT_MATTER";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The file mixes CRLF and LF line endings, so there is no one ending to write the edited file back in. */
export interface RegisteredAskMixedLineEndingsError {
  readonly code: "MIXED_LINE_ENDINGS";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A key the edit replaces carries a comment after its value, which would go with the line. */
export interface RegisteredAskInlineCommentError {
  readonly code: "INLINE_COMMENT";
  readonly message: string;
  readonly key: string;
  readonly reasons: readonly string[];
}

/** The front-matter writer would change a line the edit does not name — a comment or blank line after a key. */
export interface RegisteredAskFrontMatterCollateralError {
  readonly code: "FRONT_MATTER_COLLATERAL";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The front-matter writer refused the splice; `reasons` are its own. */
export interface RegisteredAskFrontMatterError {
  readonly code: "FRONT_MATTER_REFUSED";
  readonly message: string;
  readonly cause: FrontMatterError;
  readonly reasons: readonly string[];
}

/** The edited row would still read malformed — a still-real line past its cap, say — so it is never written. */
export interface RegisteredAskLeavesMalformedError {
  readonly code: "LEAVES_MALFORMED";
  readonly message: string;
  readonly problems: readonly string[];
  readonly reasons: readonly string[];
}

/** Every way an edit to a registered ask is refused. */
export type RegisteredAskChangeError =
  | RegisteredAskNotEligibleError
  | RegisteredAskLeavesMalformedError
  | RegisteredAskFileError
  | RegisteredAskHeadingError
  | RegisteredAskHeadingMisplacedError
  | RegisteredAskNoFrontMatterError
  | RegisteredAskMixedLineEndingsError
  | RegisteredAskInlineCommentError
  | RegisteredAskFrontMatterCollateralError
  | RegisteredAskFrontMatterError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const RegisteredAskChangeErrors = {
  file: ({ path, detail }: { path: string; detail: string }): RegisteredAskFileError => {
    const message = `${path}: ${detail}`;
    return { code: "ROW_FILE", message, path, reasons: [message] };
  },
  frontMatter: ({ cause }: { cause: FrontMatterError }): RegisteredAskFrontMatterError => ({
    cause,
    code: "FRONT_MATTER_REFUSED",
    message: cause.message,
    reasons: cause.reasons,
  }),
  frontMatterCollateral: (): RegisteredAskFrontMatterCollateralError => {
    const message =
      "the edit would change a front-matter line it does not name (a comment or blank line after a key it " +
      "replaces) — tidy the front matter first";
    return { code: "FRONT_MATTER_COLLATERAL", message, reasons: [message] };
  },
  inlineComment: ({ key }: { key: string }): RegisteredAskInlineCommentError => {
    const message = `\`${key}:\` carries a comment after its value, which the edit would drop — move it first`;
    return { code: "INLINE_COMMENT", key, message, reasons: [message] };
  },
  headingMisplaced: ({ heading }: { heading: string }): RegisteredAskHeadingMisplacedError => {
    const message =
      `the heading "${heading}" is not the body's first line, where the register writes the question, so it is ` +
      "not telling which line is the question — restate it by hand";
    return { code: "HEADING_MISPLACED", message, reasons: [message] };
  },
  headingNotUnique: ({ heading, count }: { heading: string; count: number }): RegisteredAskHeadingError => {
    const message =
      `the body carries the heading "${heading}" ${String(count)} time(s), not once, so there is no telling which ` +
      "line is the question — restate it by hand";
    return { code: "HEADING_NOT_UNIQUE", count, message, reasons: [message] };
  },
  leavesMalformed: ({ problems }: { problems: readonly string[] }): RegisteredAskLeavesMalformedError => {
    const message = `the edited row would still read malformed, so nothing was written: ${problems.join("; ")}`;
    return { code: "LEAVES_MALFORMED", message, problems, reasons: [message] };
  },
  mixedLineEndings: (): RegisteredAskMixedLineEndingsError => {
    const message =
      "the file mixes CRLF and LF line endings, so an edit would rewrite lines it does not name — make them one " +
      "ending first";
    return { code: "MIXED_LINE_ENDINGS", message, reasons: [message] };
  },
  noFrontMatter: (): RegisteredAskNoFrontMatterError => {
    const message = "no closed front-matter block (`---` … `---`), so the body cannot be told from it";
    return { code: "NO_FRONT_MATTER", message, reasons: [message] };
  },
  notEligible: ({ slug }: { slug: string }): RegisteredAskNotEligibleError => {
    const message =
      `${slug} no longer reads as a registered ask waiting on the owner (a run opened, it settled or paused, or the owner ` +
      "ruled) — nothing was written";
    return { code: "NOT_A_REGISTERED_ASK", message, reasons: [message], slug };
  },
} as const;
