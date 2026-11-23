/**
 * The replacement map's own typed failure union — why `$SLOPWEAVER_HOME/hygiene-replacements.tsv` could not be
 * applied. Every variant names the file and, where there is one, the 1-based line, and NONE quotes the line: the
 * map's rows spell the names they replace, so an error that echoed one would print what the map exists to remove.
 *
 * A union rather than `readonly string[]` because every caller branches on it the same way — any of these refuses
 * the write before a row is touched — and the operator needs to know WHICH column of which line to fix.
 */

/** The file exists and could not be read. Never conflated with an absent file, which is a normal state. */
export interface MapUnreadableError {
  readonly code: "MAP_UNREADABLE";
  readonly message: string;
  readonly path: string;
  readonly reason: string;
}

/** A rule line does not hold exactly three tab-separated columns, or one of its first two is empty. */
export interface MapColumnsInvalidError {
  readonly code: "MAP_COLUMNS_INVALID";
  readonly message: string;
  readonly path: string;
  readonly line: number;
}

/** The flags column is outside the closed set, repeats a flag, or combines two that contradict. */
export interface MapFlagsInvalidError {
  readonly code: "MAP_FLAGS_INVALID";
  readonly message: string;
  readonly path: string;
  readonly line: number;
}

/** A `regex` rule's pattern does not compile, or a `preserve-case` rule's tokens are not bare ASCII words. */
export interface MapPatternInvalidError {
  readonly code: "MAP_PATTERN_INVALID";
  readonly message: string;
  readonly path: string;
  readonly line: number;
}

/** A `regex` rule's replacement names a group the pattern lacks, or a backslash escapes nothing it may. */
export interface MapBackreferenceInvalidError {
  readonly code: "MAP_BACKREFERENCE_INVALID";
  readonly message: string;
  readonly path: string;
  readonly line: number;
}

/** Every way the replacement map can fail to load. */
export type ReplacementMapError =
  | MapUnreadableError
  | MapColumnsInvalidError
  | MapFlagsInvalidError
  | MapPatternInvalidError
  | MapBackreferenceInvalidError;

/** One located line, the shape four of the five variants share. */
interface MapLine {
  readonly path: string;
  readonly line: number;
}

/** The factory every map failure is built through. */
export const ReplacementMapErrors = {
  backreferenceInvalid: ({ path, line }: MapLine): MapBackreferenceInvalidError => ({
    code: "MAP_BACKREFERENCE_INVALID",
    line,
    message:
      `replacement map ${path}:${String(line)}: the replacement names a group the pattern does not have, or a ` +
      "backslash is followed by something other than a group digit 1-9 or another backslash",
    path,
  }),
  columnsInvalid: ({ path, line }: MapLine): MapColumnsInvalidError => ({
    code: "MAP_COLUMNS_INVALID",
    line,
    message:
      `replacement map ${path}:${String(line)}: a rule is exactly three tab-separated columns — ` +
      "flags, pattern, replacement — and the first two are never empty",
    path,
  }),
  flagsInvalid: ({ path, line }: MapLine): MapFlagsInvalidError => ({
    code: "MAP_FLAGS_INVALID",
    line,
    message:
      `replacement map ${path}:${String(line)}: flags are a comma-separated list holding exactly one of ` +
      "literal or regex, plus optionally i or (literal only) preserve-case, each at most once — never both",
    path,
  }),
  patternInvalid: ({ path, line }: MapLine): MapPatternInvalidError => ({
    code: "MAP_PATTERN_INVALID",
    line,
    message:
      `replacement map ${path}:${String(line)}: a regex rule's pattern must compile, and a preserve-case ` +
      "rule's pattern and replacement must both be bare ASCII letters",
    path,
  }),
  unreadable: ({ path, reason }: { path: string; reason: string }): MapUnreadableError => ({
    code: "MAP_UNREADABLE",
    message: `replacement map ${path} exists but could not be read (${reason}) — nothing was redacted or written`,
    path,
    reason,
  }),
} as const;
