/**
 * Every way a document fails to be one whole top-level JSON array, as `jsonArrayElements.ts` reports it.
 */

/** The document's first character is not `[`. */
export interface JsonArrayNotAnArrayError {
  readonly code: "NOT_AN_ARRAY";
  readonly message: string;
}

/** The document holds nothing but whitespace. */
export interface JsonArrayEmptyDocumentError {
  readonly code: "EMPTY_DOCUMENT";
  readonly message: string;
}

/** Something other than whitespace follows the array's closing bracket. */
export interface JsonArrayTrailingTextError {
  readonly code: "TRAILING_TEXT";
  readonly message: string;
  /** The character offset of the first trailing character. */
  readonly offset: number;
}

/** The document ends inside the array — a cut-short file. */
export interface JsonArrayUnclosedError {
  readonly code: "UNCLOSED";
  readonly message: string;
}

/** A comma or bracket where the array's grammar does not allow one — `[,1]`, `[1,,2]`, `[1,]`, `[{} {}]`. */
export interface JsonArrayMisplacedSeparatorError {
  readonly code: "MISPLACED_SEPARATOR";
  readonly message: string;
  /** The character offset of the offending character. */
  readonly offset: number;
}

/** The file could not be opened or read. */
export interface JsonArrayFileUnreadableError {
  readonly code: "FILE_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/** One element grew past the cap before it closed, so it was refused rather than joined into one string. */
export interface JsonArrayElementTooLargeError {
  readonly code: "ELEMENT_TOO_LARGE";
  readonly message: string;
  /** The cap it passed, in UTF-16 code units. */
  readonly limit: number;
}

/** The file's bytes are not UTF-8, so its text could only be read by guessing a character for the bad ones. */
export interface JsonArrayNotUtf8Error {
  readonly code: "NOT_UTF8";
  readonly message: string;
  readonly path: string;
}

/** Every way a document fails to be one whole top-level JSON array. */
export type JsonArrayError =
  | JsonArrayNotUtf8Error
  | JsonArrayNotAnArrayError
  | JsonArrayEmptyDocumentError
  | JsonArrayTrailingTextError
  | JsonArrayUnclosedError
  | JsonArrayElementTooLargeError
  | JsonArrayMisplacedSeparatorError
  | JsonArrayFileUnreadableError;

/** The cause of a thrown error as one line. */
function causeLine({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export const JsonArrayErrors = {
  elementTooLarge: ({ limit }: { limit: number }): JsonArrayElementTooLargeError => ({
    code: "ELEMENT_TOO_LARGE",
    limit,
    message: `an element passed ${String(limit)} characters before it closed, so it was refused rather than read whole`,
  }),
  emptyDocument: (): JsonArrayEmptyDocumentError => ({
    code: "EMPTY_DOCUMENT",
    message: "not a JSON array: the document is empty",
  }),
  fileUnreadable: ({
    path,
    verb,
    cause,
  }: {
    path: string;
    verb: "open" | "read";
    cause: unknown;
  }): JsonArrayFileUnreadableError => ({
    code: "FILE_UNREADABLE",
    message: `cannot ${verb} ${path}: ${causeLine({ cause })}`,
    path,
  }),
  /** The same failure, its message prefixed with the file it was found in. */
  inFile: ({ path, error }: { path: string; error: JsonArrayError }): JsonArrayError => ({
    ...error,
    message: `${path}: ${error.message}`,
  }),
  misplacedSeparator: ({ char, offset }: { char: string; offset: number }): JsonArrayMisplacedSeparatorError => ({
    code: "MISPLACED_SEPARATOR",
    message: `not a whole JSON array: ${JSON.stringify(char)} at character ${String(offset)} breaks the comma-separated element list`,
    offset,
  }),
  notUtf8: ({ path }: { path: string }): JsonArrayNotUtf8Error => ({
    code: "NOT_UTF8",
    message: `${path} is not UTF-8: it holds a byte no character is, which would be read as U+FFFD and pass for clean text`,
    path,
  }),
  notAnArray: ({ opensWith }: { opensWith: string }): JsonArrayNotAnArrayError => ({
    code: "NOT_AN_ARRAY",
    message: `not a JSON array: the document opens with ${JSON.stringify(opensWith)}`,
  }),
  trailingText: ({ offset }: { offset: number }): JsonArrayTrailingTextError => ({
    code: "TRAILING_TEXT",
    message: `text after the array closed, at character ${String(offset)}`,
    offset,
  }),
  unclosed: (): JsonArrayUnclosedError => ({
    code: "UNCLOSED",
    message: "the array never closed: the document ends inside it, so it was cut short",
  }),
} as const;
