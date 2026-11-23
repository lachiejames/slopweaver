/**
 * The typed failures the `slopweaver claude` verbs author themselves: an argument tail the flag parser
 * refused, a required flag left out, flags given together that contradict each other, a flag value that is
 * not the shape it names, and the identity assertions file a sign-in refuses to write over.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to this verb directory. The plan store's
 * own failures (`../../../claude/errors.ts`) are a different domain and are not re-authored here. The
 * assertions-file variants stay distinct because their remedies differ: an unreadable or undecodable file is
 * a path or JSON fault, while a readable one names which row cannot be trusted with a write.
 */

import type { Result } from "../../../lib/result.js";

/** The flag parser refused the argument tail; `reasons` carries each of its refusals, one per problem. */
export interface ClaudeFlagsRefusedError {
  readonly code: "FLAGS_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A flag the verb cannot run without was not given, or was given empty. */
export interface ClaudeFlagMissingError {
  readonly code: "FLAG_MISSING";
  readonly message: string;
  readonly flag: string;
}

/** A flag was given together with one it contradicts, or more than once where it must appear once. */
export interface ClaudeFlagCombinationRefusedError {
  readonly code: "FLAG_COMBINATION_REFUSED";
  readonly message: string;
  readonly flag: string;
}

/** A flag was given a value that is not the shape it names; `got` is what arrived. */
export interface ClaudeInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
}

/** The identity assertions file is present and could not be read. */
export interface ClaudeAssertionsUnreadableError {
  readonly code: "ASSERTIONS_UNREADABLE";
  readonly message: string;
}

/** The identity assertions file was read and is not valid JSON. */
export interface ClaudeAssertionsNotJsonError {
  readonly code: "ASSERTIONS_NOT_JSON";
  readonly message: string;
}

/** The identity assertions file decoded to something other than the `{ "assertions": [...] }` object. */
export interface ClaudeAssertionsWrongShapeError {
  readonly code: "ASSERTIONS_WRONG_SHAPE";
  readonly message: string;
}

/** A stored enrollment names a store that is not a configured plan. */
export interface ClaudeAssertionStoreUnconfiguredError {
  readonly code: "ASSERTION_STORE_UNCONFIGURED";
  readonly message: string;
}

/** A stored enrollment's `assertedAtIso` is not the canonical ISO instant an enrollment writes. */
export interface ClaudeAssertionInstantInvalidError {
  readonly code: "ASSERTION_INSTANT_INVALID";
  readonly message: string;
}

/** One problem a verb's own argument checks found: a flag left out, in conflict, or holding a value of the wrong shape. */
export type ClaudeArgumentProblem =
  ClaudeFlagMissingError | ClaudeFlagCombinationRefusedError | ClaudeInvalidFlagValueError;

/** A verb's own argument checks refused the tail; `problems` are every one found, `reasons` their messages in order. */
export interface ClaudeArgumentsRefusedError {
  readonly code: "ARGUMENTS_REFUSED";
  readonly message: string;
  readonly problems: readonly ClaudeArgumentProblem[];
  readonly reasons: readonly string[];
}

/** The `UserPromptSubmit` payload on stdin was not JSON; `cause` is what the parser threw. */
export interface ClaudeSeatPayloadNotJsonError {
  readonly code: "SEAT_PAYLOAD_NOT_JSON";
  readonly message: string;
  readonly cause: unknown;
}

/** The `UserPromptSubmit` payload decoded and names no `session_id`. */
export interface ClaudeSeatPayloadSessionMissingError {
  readonly code: "SEAT_PAYLOAD_SESSION_MISSING";
  readonly message: string;
}

/** Every failure this verb directory authors. */
export type ClaudeCommandError =
  | ClaudeFlagsRefusedError
  | ClaudeArgumentsRefusedError
  | ClaudeSeatPayloadNotJsonError
  | ClaudeSeatPayloadSessionMissingError
  | ClaudeFlagMissingError
  | ClaudeFlagCombinationRefusedError
  | ClaudeInvalidFlagValueError
  | ClaudeAssertionsUnreadableError
  | ClaudeAssertionsNotJsonError
  | ClaudeAssertionsWrongShapeError
  | ClaudeAssertionStoreUnconfiguredError
  | ClaudeAssertionInstantInvalidError;

/** A value one of these verbs produced, or the {@link ClaudeCommandError} that refused it. */
export type ClaudeCommandResult<T> = Result<T, ClaudeCommandError>;

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const ClaudeCommandErrors = {
  aliasMissingForPause: (): ClaudeFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "<alias>",
    message: 'name the plan to pause: `slopweaver claude pause <alias> --reason "<why>"`',
  }),
  aliasMissingForResume: (): ClaudeFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "<alias>",
    message: "name the plan to resume: `slopweaver claude resume <alias>`",
  }),
  argumentsRefused: ({ problems }: { problems: readonly ClaudeArgumentProblem[] }): ClaudeArgumentsRefusedError => {
    const reasons = problems.map((problem) => problem.message);
    return { code: "ARGUMENTS_REFUSED", message: reasons.join("; "), problems, reasons };
  },
  demandUnknown: ({ got }: { got: string }): ClaudeInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--demand",
    got,
    message: `--demand is trailing or peak, got ${got}`,
  }),
  extraPlans: ({ extra }: { extra: readonly string[] }): ClaudeFlagCombinationRefusedError => ({
    code: "FLAG_COMBINATION_REFUSED",
    flag: "<alias>",
    message: `one plan at a time; also got ${extra.join(", ")}`,
  }),
  nowNotIso: ({ got }: { got: string }): ClaudeInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--now",
    got,
    message: `--now ${got} is not an ISO-8601 instant`,
  }),
  pauseReasonMissing: (): ClaudeFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--reason",
    message: 'say what the plan is out for with --reason "<why>" — a pause nobody can explain is a forgotten one',
  }),
  seatModesExclusive: (): ClaudeFlagCombinationRefusedError => ({
    code: "FLAG_COMBINATION_REFUSED",
    flag: "--from-payload",
    message: "--session and --from-payload are exclusive: the hook names its session in the payload",
  }),
  seatPayloadNotJson: ({ cause }: { cause: unknown }): ClaudeSeatPayloadNotJsonError => ({
    cause,
    code: "SEAT_PAYLOAD_NOT_JSON",
    message: `the hook payload is not JSON (${String(cause)})`,
  }),
  seatPayloadSessionMissing: (): ClaudeSeatPayloadSessionMissingError => ({
    code: "SEAT_PAYLOAD_SESSION_MISSING",
    message: "the hook payload names no session_id",
  }),
  seatSessionMissing: (): ClaudeFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--session",
    message: "name the session to judge with --session <id>, or pass --from-payload as the hook does",
  }),
  weeksOutOfRange: ({ got, max }: { got: string; max: number }): ClaudeInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--weeks",
    got,
    message: `--weeks must be a whole number from 1 to ${String(max)}, got ${got}`,
  }),
  assertionInstantInvalid: (): ClaudeAssertionInstantInvalidError => ({
    code: "ASSERTION_INSTANT_INVALID",
    message: "an enrollment assertedAtIso is not a date; no enrollment was changed",
  }),
  assertionStoreUnconfigured: (): ClaudeAssertionStoreUnconfiguredError => ({
    code: "ASSERTION_STORE_UNCONFIGURED",
    message: "an enrollment names a store that is not configured; no enrollment was changed",
  }),
  assertionsHoldNull: (): ClaudeAssertionsWrongShapeError => ({
    code: "ASSERTIONS_WRONG_SHAPE",
    message:
      'the identity assertions file holds null, not the expected { "assertions": [...] } object; no enrollment was changed',
  }),
  assertionsNotJson: (): ClaudeAssertionsNotJsonError => ({
    code: "ASSERTIONS_NOT_JSON",
    message: "the identity assertions file is not valid JSON; no enrollment was changed",
  }),
  assertionsUnreadable: (): ClaudeAssertionsUnreadableError => ({
    code: "ASSERTIONS_UNREADABLE",
    message: "the identity assertions file could not be read; no enrollment was changed",
  }),
  assertionsWrongShape: ({ problem }: { problem: string }): ClaudeAssertionsWrongShapeError => ({
    code: "ASSERTIONS_WRONG_SHAPE",
    message: `${problem}; no enrollment was changed`,
  }),
  flagsRefused: ({ reasons }: { reasons: readonly string[] }): ClaudeFlagsRefusedError => ({
    code: "FLAGS_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  planAndEnrollTogether: (): ClaudeFlagCombinationRefusedError => ({
    code: "FLAG_COMBINATION_REFUSED",
    flag: "--enroll",
    message: "`--plan` signs a store in and `--enroll` binds one already live; pass one, not both",
  }),
  reenrollEmptyEntry: ({ got }: { got: string }): ClaudeInvalidFlagValueError => ({
    code: "INVALID_FLAG_VALUE",
    flag: "--reenroll",
    got,
    message: "`--reenroll` names stores as a comma-separated list with no empty entry, e.g. plan-two,plan-three",
  }),
  readBesideStoreAct: ({ flag }: { flag: "--enroll" | "--plan" }): ClaudeFlagCombinationRefusedError => ({
    code: "FLAG_COMBINATION_REFUSED",
    flag,
    message: `\`${flag}\` acts on a store and \`--status\`, \`--json\`, \`--page\` and \`--out\` only read; pass one or the other — \`--status\` alone reads every plan and launches nothing`,
  }),
  outWithoutPage: (): ClaudeFlagCombinationRefusedError => ({
    code: "FLAG_COMBINATION_REFUSED",
    flag: "--out",
    message:
      "`--out` names where `--page` writes its page, and alone it would fall through to the sign-in walk; pass `--page --out <path>`",
  }),
  reenrollNotAlone: (): ClaudeFlagCombinationRefusedError => ({
    code: "FLAG_COMBINATION_REFUSED",
    flag: "--reenroll",
    message: "`--reenroll` deliberately replaces standing enrollments; pass it on its own",
  }),
  reenrollRepeated: (): ClaudeFlagCombinationRefusedError => ({
    code: "FLAG_COMBINATION_REFUSED",
    flag: "--reenroll",
    message: "`--reenroll` takes one comma-separated list; pass it once, e.g. --reenroll plan-two,plan-three",
  }),
  rotateTargetMissing: (): ClaudeFlagMissingError => ({
    code: "FLAG_MISSING",
    flag: "--to",
    message: "name the plan with --to <alias>",
  }),
} as const;

/**
 * The lines a {@link ClaudeCommandError} prints, one per problem. A list-carrying variant gives each entry its own line, as the
 * `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function claudeCommandErrorLines({ error }: { error: ClaudeCommandError }): readonly string[] {
  if (error.code === "FLAGS_REFUSED" || error.code === "ARGUMENTS_REFUSED") {
    return error.reasons;
  }
  return [error.message];
}
