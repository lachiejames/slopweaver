/**
 * Every way the ruling register refuses — one union for the whole `src/ruling/` tree, so each failure a caller can
 * branch on has a code and the directory never accumulates loose message strings.
 */

/** The register file exists and could not be read. */
interface RegisterUnreadableError {
  readonly code: "REGISTER_UNREADABLE";
  readonly message: string;
  readonly file: string;
}

/** A register line is not a ruling row, or the rows contradict each other. */
interface RegisterMalformedError {
  readonly code: "REGISTER_MALFORMED";
  readonly message: string;
  readonly file: string;
  readonly line: number;
}

/** A category is not a kebab slug. */
interface CategoryInvalidError {
  readonly code: "CATEGORY_INVALID";
  readonly message: string;
  readonly category: string;
}

/** A category no row uses yet, named without `--new-category`. */
interface CategoryUnknownError {
  readonly code: "CATEGORY_UNKNOWN";
  readonly message: string;
  readonly category: string;
  readonly known: readonly string[];
}

/** `--new-category` named a category a row already uses. */
interface CategoryExistsError {
  readonly code: "CATEGORY_EXISTS";
  readonly message: string;
  readonly category: string;
}

/** A decision date that is not a real calendar date. */
interface DateInvalidError {
  readonly code: "DATE_INVALID";
  readonly message: string;
  readonly value: string;
}

/** Words with nothing but whitespace in them. */
interface WordsEmptyError {
  readonly code: "WORDS_EMPTY";
  readonly message: string;
}

/** A `replaces` id that names no current ruling. */
interface ReplacesNotCurrentError {
  readonly code: "REPLACES_NOT_CURRENT";
  readonly message: string;
  readonly id: string;
}

/** A current ruling in the same category the new one neither replaces nor stands alongside. */
interface UndisposedError {
  readonly code: "UNDISPOSED";
  readonly message: string;
  readonly category: string;
  readonly undisposed: readonly string[];
}

/** A source document could not be read. */
interface SourceUnreadableError {
  readonly code: "SOURCE_UNREADABLE";
  readonly message: string;
  readonly file: string;
}

/** A seed decisions line that is not a decision, or a decision set that does not cover the candidates. */
interface SeedDecisionsInvalidError {
  readonly code: "SEED_DECISIONS_INVALID";
  readonly message: string;
}

/** The register's operation lock is held, or could not be taken. */
interface LockUnavailableError {
  readonly code: "LOCK_UNAVAILABLE";
  readonly message: string;
}

/** The append itself failed. */
interface AppendFailedError {
  readonly code: "APPEND_FAILED";
  readonly message: string;
  readonly file: string;
}

/** The page would be larger than the view may publish. */
interface PageTooLargeError {
  readonly code: "PAGE_TOO_LARGE";
  readonly message: string;
  readonly bytes: number;
}

/** Why a ruling-register operation refused. */
export type RulingError =
  | RegisterUnreadableError
  | RegisterMalformedError
  | CategoryInvalidError
  | CategoryUnknownError
  | CategoryExistsError
  | DateInvalidError
  | WordsEmptyError
  | ReplacesNotCurrentError
  | UndisposedError
  | SourceUnreadableError
  | SeedDecisionsInvalidError
  | LockUnavailableError
  | AppendFailedError
  | PageTooLargeError;

/** A cause's own message, for an error that wraps a thrown value. */
function causeText({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The factory for {@link RulingError}. */
export const RulingErrors = {
  appendFailed: ({
    file,
    cause,
    restored,
  }: {
    file: string;
    cause: unknown;
    restored: boolean;
  }): AppendFailedError => ({
    code: "APPEND_FAILED",
    file,
    message: restored
      ? `could not append to ${file}: ${causeText({ cause })}; the register was cut back to what it held before`
      : `could not append to ${file}: ${causeText({ cause })}; cutting it back failed too, so its last line may be ` +
        "partial and the next read refuses it",
  }),
  categoryExists: ({ category }: { category: string }): CategoryExistsError => ({
    category,
    code: "CATEGORY_EXISTS",
    message: `category ${category} already exists — drop --new-category`,
  }),
  categoryInvalid: ({ category }: { category: string }): CategoryInvalidError => ({
    category,
    code: "CATEGORY_INVALID",
    message: `category "${category}" is not a kebab slug (lowercase letters and digits, joined by single hyphens)`,
  }),
  categoryUnknown: ({ category, known }: { category: string; known: readonly string[] }): CategoryUnknownError => ({
    category,
    code: "CATEGORY_UNKNOWN",
    known,
    message:
      `no ruling uses category ${category} yet — pass --new-category to start it, or use one that exists: ` +
      (known.length === 0 ? "(none yet)" : known.join(", ")),
  }),
  dateInvalid: ({ value }: { value: string }): DateInvalidError => ({
    code: "DATE_INVALID",
    message: `"${value}" is not a calendar date in YYYY-MM-DD form`,
    value,
  }),
  lockUnavailable: ({ why }: { why: string }): LockUnavailableError => ({
    code: "LOCK_UNAVAILABLE",
    message: `the ruling register is locked by another writer: ${why}`,
  }),
  malformed: ({ file, line, why }: { file: string; line: number; why: string }): RegisterMalformedError => ({
    code: "REGISTER_MALFORMED",
    file,
    line,
    message: `${file}:${String(line)} is not a ruling row (${why}) — the register is never repaired by hand or rewritten`,
  }),
  replacesNotCurrent: ({ id }: { id: string }): ReplacesNotCurrentError => ({
    code: "REPLACES_NOT_CURRENT",
    id,
    message: `--replaces ${id} names no current ruling — \`ruling list --all\` shows every id and what replaced it`,
  }),
  seedDecisionsInvalid: ({ why }: { why: string }): SeedDecisionsInvalidError => ({
    code: "SEED_DECISIONS_INVALID",
    message: `seed decisions refused: ${why}`,
  }),
  sourceUnreadable: ({ file, cause }: { file: string; cause: unknown }): SourceUnreadableError => ({
    code: "SOURCE_UNREADABLE",
    file,
    message: `could not read ${file}: ${causeText({ cause })}`,
  }),
  tooLarge: ({ bytes, max }: { bytes: number; max: number }): PageTooLargeError => ({
    bytes,
    code: "PAGE_TOO_LARGE",
    message: `the rulings page would be ${String(bytes)} bytes, over the ${String(max)}-byte cap`,
  }),
  undisposed: ({ category, undisposed }: { category: string; undisposed: readonly string[] }): UndisposedError => ({
    category,
    code: "UNDISPOSED",
    message:
      `${String(undisposed.length)} current ruling(s) in ${category} stand beside this one: ${undisposed.join(", ")} — ` +
      "read each, then pass --replaces <id> for one it supersedes, or --alongside when they do not conflict",
    undisposed,
  }),
  unreadable: ({ file, cause }: { file: string; cause: unknown }): RegisterUnreadableError => ({
    code: "REGISTER_UNREADABLE",
    file,
    message: `${file} could not be read: ${causeText({ cause })}`,
  }),
  wordsEmpty: (): WordsEmptyError => ({
    code: "WORDS_EMPTY",
    message: "--words holds nothing but whitespace — a ruling is the owner's words",
  }),
} as const;
