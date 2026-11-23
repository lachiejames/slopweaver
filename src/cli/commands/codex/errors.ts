/**
 * The typed failures `slopweaver codex review` and `codex review-fallback prepare` author themselves: a review
 * with no property to check, a properties file that cannot be read or does not hold what a review needs, and a
 * `prepare` call missing one of its required flags.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this verb directory. The properties
 * failures stay distinct variants because their remedies differ: an unreadable file is a path or JSON fault,
 * while a readable one with a bad entry names which entry to fix.
 */

/** Neither `--property-id`/`--property` nor `--properties-file` was given, so there is nothing to review. */
export interface CodexNoPropertySourceError {
  readonly code: "NO_PROPERTY_SOURCE";
  readonly message: string;
}

/** `--properties-file` could not be read or parsed as JSON. */
export interface CodexPropertiesFileUnreadableError {
  readonly code: "PROPERTIES_FILE_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly cause: unknown;
}

/** The properties file parsed, and its top level is not a JSON object. */
export interface CodexPropertiesNotObjectError {
  readonly code: "PROPERTIES_NOT_OBJECT";
  readonly message: string;
}

/** The properties file is an object whose `properties` array is missing or empty. */
export interface CodexPropertiesEmptyError {
  readonly code: "PROPERTIES_EMPTY";
  readonly message: string;
}

/** One or more entries of the `properties` array are invalid; `reasons` names each, by index. */
export interface CodexPropertiesEntriesInvalidError {
  readonly code: "PROPERTIES_ENTRIES_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** `codex review-fallback prepare` is missing, or was given an unusable value for, one of its required flags. */
export interface CodexPrepareFlagsMissingError {
  readonly code: "PREPARE_FLAGS_MISSING";
  readonly message: string;
}

/** Every failure this verb directory authors. */
export type CodexCommandError =
  | CodexNoPropertySourceError
  | CodexPropertiesFileUnreadableError
  | CodexPropertiesNotObjectError
  | CodexPropertiesEmptyError
  | CodexPropertiesEntriesInvalidError
  | CodexPrepareFlagsMissingError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const CodexCommandErrors = {
  noPropertySource: (): CodexNoPropertySourceError => ({
    code: "NO_PROPERTY_SOURCE",
    message: "no property source",
  }),
  prepareFlagsMissing: (): CodexPrepareFlagsMissingError => ({
    code: "PREPARE_FLAGS_MISSING",
    message:
      "codex review-fallback prepare: --pass r1|r2|r3, --property-id, --property, --base and a positive integer --max-diff-bytes are all required",
  }),
  propertiesEmpty: (): CodexPropertiesEmptyError => ({
    code: "PROPERTIES_EMPTY",
    message: "the properties file must have a non-empty `properties` array",
  }),
  propertiesEntriesInvalid: ({ reasons }: { reasons: readonly string[] }): CodexPropertiesEntriesInvalidError => ({
    code: "PROPERTIES_ENTRIES_INVALID",
    message: reasons.join("; "),
    reasons,
  }),
  propertiesFileUnreadable: ({
    path,
    cause,
  }: {
    path: string;
    cause: unknown;
  }): CodexPropertiesFileUnreadableError => ({
    cause,
    code: "PROPERTIES_FILE_UNREADABLE",
    message: `could not read --properties-file ${path}: ${String(cause)}`,
    path,
  }),
  propertiesNotObject: (): CodexPropertiesNotObjectError => ({
    code: "PROPERTIES_NOT_OBJECT",
    message: "the properties file must contain a JSON object",
  }),
} as const;

/**
 * The lines a {@link CodexCommandError} prints, one per problem. A list-carrying variant gives each entry its own line, as the
 * `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function codexCommandErrorLines({ error }: { error: CodexCommandError }): readonly string[] {
  if (error.code === "PROPERTIES_ENTRIES_INVALID") {
    return error.reasons;
  }
  return [error.message];
}
