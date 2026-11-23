/**
 * The typed failures the `browser` verb's pure halves author themselves: a tail the flag tokeniser refused,
 * a sub-verb not named, a flag a sub-verb cannot run without, a flag given a value it does not accept, and a
 * shot refused because the address belongs to a provider that is only ever read through its door.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this verb directory and separate from
 * `browser/actionErrors.ts` and `browser/pageTransport.ts`: those name what the BROWSER did, these name what
 * the COMMAND LINE or the register refused before a browser was touched.
 */

/** The flag tokeniser refused the tail — an unknown flag, a missing value; `reasons` is its own list. */
export interface BrowserVerbFlagsInvalidError {
  readonly code: "FLAGS_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** No sub-verb, or one this verb does not have; `got` is what arrived, absent when nothing did. */
export interface BrowserVerbSubverbMissingError {
  readonly code: "SUBVERB_MISSING";
  readonly message: string;
  readonly got: string | undefined;
}

/** A flag the named sub-verb cannot run without was not given. */
export interface BrowserVerbFlagMissingError {
  readonly code: "FLAG_MISSING";
  readonly message: string;
  readonly flag: string;
}

/** A flag was given a value it does not accept; `flag` names it and `got` is what arrived. */
export interface BrowserVerbInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
}

/** The address belongs to a doored provider registered `refuse-every-write`, so it is never photographed. */
export interface BrowserVerbDooredProviderError {
  readonly code: "DOORED_PROVIDER";
  readonly message: string;
  readonly provider: string;
  readonly door: string;
  /** The refusal as the two lines it has always been: why, then where to go instead. */
  readonly reasons: readonly string[];
}

/** Every failure this verb directory authors. */
export type BrowserVerbError =
  | BrowserVerbFlagsInvalidError
  | BrowserVerbSubverbMissingError
  | BrowserVerbFlagMissingError
  | BrowserVerbInvalidFlagValueError
  | BrowserVerbDooredProviderError;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const BrowserVerbErrors = {
  dooredProvider: ({ provider, door }: { provider: string; door: string }): BrowserVerbDooredProviderError => {
    const reasons = [
      `${provider} is registered refuse-every-write, so its web client is never photographed — doctrine rule 3`,
      `take the evidence through it instead: ${door}`,
    ];
    return { code: "DOORED_PROVIDER", door, message: reasons.join("; "), provider, reasons };
  },
  flagsInvalid: ({ reasons }: { reasons: readonly string[] }): BrowserVerbFlagsInvalidError => ({
    code: "FLAGS_INVALID",
    message: reasons.join("; "),
    reasons,
  }),
  annotateFormMissing: (): BrowserVerbFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--form",
    message:
      "`browser annotate` needs --form <file.json>: the source PNG, the out path, the boxes with their notes, and " +
      "what you saw in the source",
  }),
  terminalShotFormMissing: (): BrowserVerbFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--form",
    message:
      "`browser terminal-shot` needs --form <file.json>: the text file to draw (a `cmux read-screen` dump, a " +
      "command's output), the lines to keep, a label, and the out path",
  }),
  redactFormMissing: (): BrowserVerbFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--form",
    message:
      "`browser redact` needs --form <file.json>: the captured PNG, the out path, and the rectangles to burn solid",
  }),
  formMissing: (): BrowserVerbFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--form",
    message: "`browser image-record` needs --form <file.json>, the observation to record",
  }),
  limitNotPositive: ({ got }: { got: string }): BrowserVerbInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--limit",
    got,
    message: `--limit must be a whole number of rows, 1 or more (got ${got})`,
  }),
  originMissing: (): BrowserVerbFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--origin",
    message: "`browser cookies` needs --origin <url>, e.g. --origin https://github.com",
  }),
  readinessTimeoutNotWhole: ({ got }: { got: string }): BrowserVerbInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--readiness-timeout",
    got,
    message: `--readiness-timeout takes whole milliseconds, got '${got}'`,
  }),
  readinessTimeoutOutOfRange: ({ got, max }: { got: string; max: number }): BrowserVerbInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--readiness-timeout",
    got,
    message: `--readiness-timeout takes 1..${String(max)}ms, got '${got}'`,
  }),
  settleNotWhole: ({ got }: { got: string }): BrowserVerbInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--settle",
    got,
    message: `--settle takes whole milliseconds, got '${got}'`,
  }),
  settleTooLong: ({ got, max }: { got: string; max: number }): BrowserVerbInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--settle",
    got,
    message: `--settle may be at most ${String(max)}ms, got '${got}'`,
  }),
  subverbMissing: ({
    got,
    choices,
  }: {
    got: string | undefined;
    choices: readonly string[];
  }): BrowserVerbSubverbMissingError => {
    const required = `a sub-verb is required: ${choices.join(", ")}`;
    if (got === undefined) {
      return { code: "SUBVERB_MISSING", got, message: `${required} (got nothing)` };
    }
    return { code: "SUBVERB_MISSING", got, message: `${required} (got ${got})` };
  },
  urlNotAbsolute: ({ got }: { got: string }): BrowserVerbInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--url",
    got,
    message: `--url takes an absolute address, got '${got}'`,
  }),
  urlNotHttp: ({ got }: { got: string }): BrowserVerbInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--url",
    got,
    message: `--url takes an http or https address, got '${got}'`,
  }),
} as const;

/**
 * The lines a refused `browser` verb prints: a refusal that is a list (the tokeniser's reasons, a doored
 * provider's why-then-where) one reason per line, any other its one message.
 *
 * @param error the refusal
 * @returns the diagnostic lines, byte for byte what the verb has always printed
 */
export function browserVerbErrorLines({ error }: { error: BrowserVerbError }): readonly string[] {
  if (error.code === "FLAGS_INVALID" || error.code === "DOORED_PROVIDER") {
    return error.reasons;
  }
  return [error.message];
}
