/**
 * Why a `talk capabilities` or `talk find-card` invocation is refused before anything runs — the typed union the
 * two positional-word parsers share, one per bounded module (`.claude/rules/error-handling.md`). Each is a usage
 * problem the verb prints above its usage text.
 */

/** A flag the shared parser refused: unknown, repeated, or missing its value. */
export interface PositionalFlagsUnparsedError {
  readonly code: "FLAGS_UNPARSED";
  readonly message: string;
  readonly problems: readonly string[];
}

/** More positional words than the verb takes. */
export interface TooManyWordsError {
  readonly code: "TOO_MANY_WORDS";
  readonly message: string;
  readonly got: number;
}

/** No positional word where the verb needs at least one. */
export interface WordsMissingError {
  readonly code: "WORDS_MISSING";
  readonly message: string;
}

/** Every way a positional-word `talk` invocation is refused before anything runs. */
export type TalkPositionalArgsError = PositionalFlagsUnparsedError | TooManyWordsError | WordsMissingError;

/** The factories for {@link TalkPositionalArgsError}. */
export const TalkPositionalArgsErrors = {
  findCardWordsMissing: (): WordsMissingError => ({
    code: "WORDS_MISSING",
    message: "talk find-card needs the words the card would be about",
  }),
  flagsUnparsed: ({ problems }: { problems: readonly string[] }): PositionalFlagsUnparsedError => ({
    code: "FLAGS_UNPARSED",
    message: problems.join("\n"),
    problems,
  }),
  tooManyCapabilityWords: ({ got }: { got: number }): TooManyWordsError => ({
    code: "TOO_MANY_WORDS",
    got,
    message: `talk capabilities takes at most a noun and a verb, got ${String(got)} words`,
  }),
} as const;

/**
 * The lines a refusal prints above the verb's usage: each flag problem on its own line, else the one message.
 *
 * @param error the refusal a positional-word parser returned
 * @returns one line per problem, in the order the parser found them
 */
export function talkPositionalArgsErrorLines({ error }: { error: TalkPositionalArgsError }): readonly string[] {
  if (error.code === "FLAGS_UNPARSED") {
    return error.problems;
  }
  return [error.message];
}
