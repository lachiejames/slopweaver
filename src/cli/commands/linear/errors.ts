/**
 * The typed failures the `slopweaver linear` write and read verbs author themselves while reading their
 * command line and their `--form`: a usage the verb does not have, a sub-verb or argument it cannot route, a
 * flag it cannot run without or a value it does not accept, and a form that is not JSON or not the verb's
 * shape.
 *
 * ONE union for the whole verb directory per `.claude/rules/error-handling.md`. The flag tokeniser's own
 * refusals (`parseFlags`), the collected per-invocation problems, and the schema's per-path issues each arrive
 * as a list and ride as `reasons`; {@link linearVerbErrorLines} gives them back one line per problem, exactly
 * as the string list they replaced did. The door, provider and corpus unions (`LinearAttachError`,
 * `LinearLiveError`, `LinearQueryError`) stay where they are raised.
 */

/** The shared flag parser refused the tail; `reasons` carries each of its refusals. */
export interface LinearFlagsRefusedError {
  readonly code: "FLAGS_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The invocation named no sub-verb this noun has; the message is the noun's own usage line. */
export interface LinearUsageError {
  readonly code: "USAGE";
  readonly message: string;
  readonly noun: string;
}

/** A positional the verb needs was not given — a sub-verb, or a search term. */
export interface LinearArgumentMissingError {
  readonly code: "ARGUMENT_MISSING";
  readonly message: string;
  readonly name: string;
}

/** A positional was given that the verb does not route — an unknown sub-verb, or one too many. */
export interface LinearArgumentRefusedError {
  readonly code: "ARGUMENT_REFUSED";
  readonly message: string;
  readonly got: string;
}

/** A flag the verb cannot run without was not given. */
export interface LinearFlagMissingError {
  readonly code: "FLAG_MISSING";
  readonly message: string;
  readonly flag: string;
}

/** A flag was given a value it does not accept. */
export interface LinearInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
}

/** One or more problems in one invocation, collected rather than reported one at a time. */
export interface LinearArgumentsRefusedError {
  readonly code: "ARGUMENTS_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The `--form` text is not JSON at all. */
export interface LinearFormNotJsonError {
  readonly code: "FORM_NOT_JSON";
  readonly message: string;
  readonly cause: unknown;
}

/** The `--form` is JSON and not the verb's shape; `reasons` is one `path: message` line per issue. */
export interface LinearFormInvalidError {
  readonly code: "FORM_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A document comment's destination could not be read, or carried nothing a comment can attach to. */
export interface LinearDocumentUnreadableError {
  readonly code: "DOCUMENT_UNREADABLE";
  readonly message: string;
  readonly documentId: string;
}

/** A document comment's `quotedText` is not in the document's current content, so it would anchor nowhere. */
export interface LinearQuoteNotFoundError {
  readonly code: "QUOTE_NOT_FOUND";
  readonly message: string;
  readonly documentId: string;
  readonly quotedText: string;
}

/** A document reply's `parentId` is not a comment on that document, so the reply would land in no thread. */
export interface LinearParentNotFoundError {
  readonly code: "PARENT_NOT_FOUND";
  readonly message: string;
  readonly documentId: string;
  readonly parentId: string;
}

/** A document reply's `parentId` is itself a reply; Linear threads one level deep, so it must be the root. */
export interface LinearParentIsReplyError {
  readonly code: "PARENT_IS_REPLY";
  readonly message: string;
  readonly parentId: string;
  readonly rootId: string;
}

/** Every failure this verb directory authors. */
export type LinearVerbError =
  | LinearDocumentUnreadableError
  | LinearQuoteNotFoundError
  | LinearParentNotFoundError
  | LinearParentIsReplyError
  | LinearFlagsRefusedError
  | LinearUsageError
  | LinearArgumentMissingError
  | LinearArgumentRefusedError
  | LinearFlagMissingError
  | LinearInvalidFlagValueError
  | LinearArgumentsRefusedError
  | LinearFormNotJsonError
  | LinearFormInvalidError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const LinearVerbErrors = {
  acknowledgementTooShort: ({ got, minWords }: { got: string; minWords: number }): LinearInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--acknowledge",
    got,
    message:
      "--acknowledge needs the REASON the real surface was unavailable, in at least " +
      `${String(minWords)} words — a bare marker waives nothing`,
  }),
  argumentsRefused: ({ reasons }: { reasons: readonly string[] }): LinearArgumentsRefusedError => ({
    code: "ARGUMENTS_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  attachExtraArgument: ({ got }: { got: string }): LinearArgumentRefusedError => ({
    code: "ARGUMENT_REFUSED",
    got,
    message: `unexpected argument ${got} — attach takes exactly one sub-verb`,
  }),
  attachFileMissing: (): LinearFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--file",
    message: "--file <path> is required",
  }),
  attachSubVerbMissing: (): LinearArgumentMissingError => ({
    code: "ARGUMENT_MISSING",
    message: "a sub-verb is required: upload",
    name: "sub-verb",
  }),
  attachSubVerbUnknown: ({ got }: { got: string }): LinearArgumentRefusedError => ({
    code: "ARGUMENT_REFUSED",
    got,
    message: `unknown sub-verb ${got} — expected upload`,
  }),
  documentUnreadable: ({
    documentId,
    reason,
  }: {
    documentId: string;
    reason: string;
  }): LinearDocumentUnreadableError => ({
    code: "DOCUMENT_UNREADABLE",
    documentId,
    message: `cannot comment on document ${documentId}: ${reason}`,
  }),
  parentIsReply: ({ parentId, rootId }: { parentId: string; rootId: string }): LinearParentIsReplyError => ({
    code: "PARENT_IS_REPLY",
    message:
      `parentId ${parentId} is itself a reply, and Linear threads one level deep — reply to its thread's root, ` +
      `parentId ${rootId}`,
    parentId,
    rootId,
  }),
  parentNotFound: ({ documentId, parentId }: { documentId: string; parentId: string }): LinearParentNotFoundError => ({
    code: "PARENT_NOT_FOUND",
    documentId,
    message:
      `parentId ${parentId} is not a comment on document ${documentId}, so the reply would land in no thread — ` +
      "read the thread ids with `slopweaver linear read <url> --include comments`",
    parentId,
  }),
  quoteNotFound: ({
    documentId,
    quotedText,
  }: {
    documentId: string;
    quotedText: string;
  }): LinearQuoteNotFoundError => ({
    code: "QUOTE_NOT_FOUND",
    documentId,
    message:
      `quotedText "${quotedText}" is not in document ${documentId}'s current content, so the inline comment ` +
      "would anchor to nothing — quote the passage as it reads now (`slopweaver linear read <url>`)",
    quotedText,
  }),
  flagsRefused: ({ reasons }: { reasons: readonly string[] }): LinearFlagsRefusedError => ({
    code: "FLAGS_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  formInvalid: ({
    issues,
  }: {
    issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];
  }): LinearFormInvalidError => {
    const reasons = issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    return { code: "FORM_INVALID", message: reasons.join("; "), reasons };
  },
  formNotJson: ({ cause }: { cause: unknown }): LinearFormNotJsonError => ({
    cause,
    code: "FORM_NOT_JSON",
    message: `the form is not valid JSON: ${cause instanceof Error ? cause.message : "unknown"}`,
  }),
  limitOutOfRange: ({ got, max }: { got: string; max: number }): LinearInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--limit",
    got,
    message: `--limit must be an integer from 1 to ${String(max)}`,
  }),
  searchTermMissing: (): LinearArgumentMissingError => ({
    code: "ARGUMENT_MISSING",
    message: "a search term is required",
    name: "search term",
  }),
  teamMissing: (): LinearFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--team",
    message: "--team <team-key> is required (the `ENG` in `ENG-42`)",
  }),
  usage: ({ noun, shape }: { noun: string; shape: string }): LinearUsageError => ({
    code: "USAGE",
    message: `usage: slopweaver linear ${noun} ${shape} --form <json|-> [...]`,
    noun,
  }),
} as const;

/**
 * The lines a {@link LinearVerbError} prints, one per problem. A list-carrying variant gives each entry its own line, as
 * the `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function linearVerbErrorLines({ error }: { error: LinearVerbError }): readonly string[] {
  if (error.code === "FLAGS_REFUSED" || error.code === "ARGUMENTS_REFUSED" || error.code === "FORM_INVALID") {
    return error.reasons;
  }
  return [error.message];
}
