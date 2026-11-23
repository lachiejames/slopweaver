/**
 * The typed failures the `calendar` verbs' pure parsers author themselves: a tail the flag tokeniser
 * refused, a flag given a value it does not accept, a positional or a required flag missing, and the
 * several refusals `calendar free` collects at once.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this verb directory. Every refusal of a
 * whole tail carries the usage its verb prints after it, so a caller prints {@link calendarErrorLines} and
 * the lines on screen are the ones the verb always printed. The window resolver's refusals carry none: they
 * are one flag's value, and the parser that called it attaches the usage of whichever verb it was parsing.
 */

/** The flag tokeniser refused the tail — an unknown flag, a missing value; `reasons` is its own list. */
export interface CalendarFlagsInvalidError {
  readonly code: "FLAGS_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A flag was given a value it does not accept; `flag` names it and `got` is what arrived. */
export interface CalendarInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
}

/** A required positional was not given; `name` is its usage placeholder, e.g. `<event-id>`. */
export interface CalendarArgumentMissingError {
  readonly code: "ARGUMENT_MISSING";
  readonly message: string;
  readonly name: string;
}

/** A flag the verb cannot run without was not given. */
export interface CalendarFlagMissingError {
  readonly code: "FLAG_MISSING";
  readonly message: string;
  readonly flag: string;
}

/** `calendar free` refused several arguments at once, so the caller can fix them together; one line each. */
export interface CalendarArgumentsRefusedError {
  readonly code: "ARGUMENTS_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** Every refusal this directory authors, before a verb's usage is attached. */
export type CalendarArgsRefusal =
  | CalendarFlagsInvalidError
  | CalendarInvalidFlagValueError
  | CalendarArgumentMissingError
  | CalendarFlagMissingError
  | CalendarArgumentsRefusedError;

/** A whole tail's refusal: what went wrong, and the usage of the verb whose tail it was. */
export type CalendarArgsError = CalendarArgsRefusal & { readonly usage: string };

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const CalendarArgsErrors = {
  argumentMissing: ({ name }: { name: string }): CalendarArgumentMissingError => ({
    code: "ARGUMENT_MISSING",
    message: `missing ${name}`,
    name,
  }),
  approvalTwice: (): CalendarArgumentsRefusedError => ({
    code: "ARGUMENTS_REFUSED",
    message: "pass --anchor OR --approve, never both: a commit carries exactly one approval",
    reasons: ["pass --anchor OR --approve, never both: a commit carries exactly one approval"],
  }),
  argumentsRefused: ({ reasons }: { reasons: readonly string[] }): CalendarArgumentsRefusedError => ({
    code: "ARGUMENTS_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  daysOutOfRange: ({ got, max }: { got: string; max: number }): CalendarInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--days",
    got,
    message: `--days must be an integer between 1 and ${String(max)}`,
  }),
  flagsInvalid: ({ reasons }: { reasons: readonly string[] }): CalendarFlagsInvalidError => ({
    code: "FLAGS_INVALID",
    message: reasons.join("; "),
    reasons,
  }),
  formMissing: (): CalendarFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--form",
    message: "--form is required: pass JSON, or `-` to read it from stdin (recommended for prose)",
  }),
  grantUnknown: ({ got, choices }: { got: string; choices: readonly string[] }): CalendarInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--grant",
    got,
    message: `unknown --grant: ${got} (expected ${choices.join(" | ")})`,
  }),
  limitOutOfRange: ({ got, max }: { got: string; max: number }): CalendarInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--limit",
    got,
    message: `--limit must be an integer between 1 and ${String(max)}`,
  }),
  notADate: ({ flag, got }: { flag: "--from" | "--to"; got: string }): CalendarInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag,
    got,
    message: `${flag} must be a YYYY-MM-DD date: ${got}`,
  }),
  toBeforeFrom: ({ got }: { got: string }): CalendarInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--to",
    got,
    message: `--to (${got}) is before --from`,
  }),
  withUsage: ({ error, usage }: { error: CalendarArgsRefusal; usage: string }): CalendarArgsError => ({
    ...error,
    usage,
  }),
} as const;

/**
 * The lines a refused tail prints, in order: each reason on its own line, then the verb's usage.
 *
 * @param error the refusal, with the usage its verb attached
 * @returns the diagnostic lines, byte for byte what the verb has always printed
 */
export function calendarErrorLines({ error }: { error: CalendarArgsError }): readonly string[] {
  const reasons =
    error.code === "FLAGS_INVALID" || error.code === "ARGUMENTS_REFUSED" ? error.reasons : [error.message];
  return [...reasons, error.usage];
}
