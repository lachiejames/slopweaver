/**
 * Why a `talk offer` invocation does not describe a call — the offer parser's own typed union, one per bounded
 * module (`.claude/rules/error-handling.md`). Each is a usage problem the verb prints above its usage text.
 */

/** A flag the shared parser refused: unknown, repeated, or missing its value. */
export interface FlagsUnparsedError {
  readonly code: "FLAGS_UNPARSED";
  readonly message: string;
}

/** A voice the owner's ChatGPT plan does not have. */
export interface VoiceUnknownError {
  readonly code: "VOICE_UNKNOWN";
  readonly message: string;
  readonly voice: string;
}

/** `--reconnect` and `--rollover` together: a mint is one or the other, and the voice is told different things. */
export interface ModesContradictError {
  readonly code: "MODES_CONTRADICT";
  readonly message: string;
}

/** `--typed` with `--reconnect` or `--rollover`: those carry a call on, and a typed conversation is never one. */
export interface TypedNotACallError {
  readonly code: "TYPED_NOT_A_CALL";
  readonly message: string;
}

/** `--test-instance` naming anything but `e2e`, the one test instance a call can be placed from. */
export interface TestInstanceUnknownError {
  readonly code: "TEST_INSTANCE_UNKNOWN";
  readonly message: string;
}

/** Every way a `talk offer` invocation is refused before anything runs. */
export type TalkOfferArgsError =
  FlagsUnparsedError | ModesContradictError | TestInstanceUnknownError | TypedNotACallError | VoiceUnknownError;

/** The factories for {@link TalkOfferArgsError}. */
export const TalkOfferArgsErrors = {
  flagsUnparsed: ({ problems }: { problems: readonly string[] }): FlagsUnparsedError => ({
    code: "FLAGS_UNPARSED",
    message: problems.join("\n"),
  }),
  modesContradict: (): ModesContradictError => ({
    code: "MODES_CONTRADICT",
    message:
      "talk offer: --reconnect re-opens a call that dropped and --rollover replaces one in a pause — pass one, not both",
  }),
  testInstanceUnknown: ({ value }: { value: string }): TestInstanceUnknownError => ({
    code: "TEST_INSTANCE_UNKNOWN",
    message: `talk offer: --test-instance ${value} names no test instance — the one there is, is e2e`,
  }),
  typedNotACall: ({ flag }: { flag: "--reconnect" | "--rollover" }): TypedNotACallError => ({
    code: "TYPED_NOT_A_CALL",
    message: `talk offer: ${flag} carries a voice call on, and --typed opens the orb messenger's typed conversation — pass one, not both`,
  }),
  voiceUnknown: ({ voice, known }: { voice: string; known: readonly string[] }): VoiceUnknownError => ({
    code: "VOICE_UNKNOWN",
    message: `talk offer: --voice ${voice} is not a plan voice — one of ${known.join(", ")}`,
    voice,
  }),
} as const;
