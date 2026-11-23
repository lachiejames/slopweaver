/**
 * The typed failures the `slack` verbs author while reading an invocation: a flag tail the tokeniser refused, a
 * list of problems pooled in one pass, a sub-command the verb does not have, a required argument that was not
 * given, a flag value the verb does not accept, a flag refused by name, two flags that cannot be combined, a
 * positional count the verb does not take, a `slack shot` target that is not a message permalink, and the
 * narrowing guard every pooled parser ends on.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to argument parsing in this directory; the
 * thread and file reads (`./readErrors.ts`), the edit/delete/release lifecycle (`./lifecycleErrors.ts`), the
 * drafting and sending lanes (`../../../outbound/slack/deliveryErrors.ts`) and `slack status` (`./statusErrors.ts`) each hold their
 * own. A list of problems rides as `reasons`, and {@link slackArgumentErrorLines} prints it one line each, as
 * the `readonly string[]` it replaced did.
 */
import type { Result } from "../../../lib/result.js";
import { ALLOW_UNRESOLVED_OWNER_FLAG } from "./coreTypes.js";

/** The flag tokeniser refused the tail; `reasons` is its own list. */
export interface SlackArgumentFlagsInvalidError {
  readonly code: "FLAGS_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** An invocation refused for every reason in `reasons`, pooled in one pass so one run reports them all. */
export interface SlackArgumentArgumentsRefusedError {
  readonly code: "ARGUMENTS_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A verb was given no sub-command it has; `got` is the word that arrived, if any. */
export interface SlackArgumentSubcommandUnknownError {
  readonly code: "SUBCOMMAND_UNKNOWN";
  readonly message: string;
  readonly verb: string;
  readonly got: string | undefined;
}

/** A required argument was not given; `name` is the flag or positional it names. */
export interface SlackArgumentMissingError {
  readonly code: "ARGUMENT_MISSING";
  readonly message: string;
  readonly name: string;
}

/** A flag was given a value it does not accept; `flag` names it and `got` is what arrived. */
export interface SlackArgumentInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
}

/** A flag this verb refuses by name, because taking it would mean something the verb cannot do. */
export interface SlackArgumentFlagRefusedError {
  readonly code: "FLAG_REFUSED";
  readonly message: string;
  readonly flag: string;
}

/** Two flags that name two different things were both given; `flags` names them. */
export interface SlackArgumentFlagConflictError {
  readonly code: "FLAG_CONFLICT";
  readonly message: string;
  readonly flags: readonly string[];
}

/** A verb that takes one positional was given `count` of them. */
export interface SlackArgumentPositionalCountError {
  readonly code: "POSITIONAL_COUNT_INVALID";
  readonly message: string;
  readonly verb: string;
  readonly count: number;
}

/** `slack shot` was given an address that is not a message permalink; `reasons` is why, then what it takes. */
export interface SlackArgumentTargetRefusedError {
  readonly code: "TARGET_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A pooled parser found no problem yet could not narrow every part — unreachable by construction. */
export interface SlackArgumentInvocationIncoherentError {
  readonly code: "INVOCATION_INCOHERENT";
  readonly message: string;
  readonly verb: string;
}

/** Every failure argument parsing in this directory authors. */
export type SlackArgumentError =
  | SlackArgumentFlagsInvalidError
  | SlackArgumentArgumentsRefusedError
  | SlackArgumentSubcommandUnknownError
  | SlackArgumentMissingError
  | SlackArgumentInvalidFlagValueError
  | SlackArgumentFlagRefusedError
  | SlackArgumentFlagConflictError
  | SlackArgumentPositionalCountError
  | SlackArgumentTargetRefusedError
  | SlackArgumentInvocationIncoherentError;

/** What an argument parser here answers: the parsed value, or this union's typed refusal. */
export type SlackParsed<T> = Result<T, SlackArgumentError>;

/** A missing argument, named. */
function missing({ name, message }: { name: string; message: string }): SlackArgumentMissingError {
  return { code: "ARGUMENT_MISSING", message, name };
}

/** A refused flag value, named. */
function invalidValue({
  flag,
  got,
  message,
}: {
  flag: string;
  got: string;
  message: string;
}): SlackArgumentInvalidFlagValueError {
  return { code: "INVALID_FLAG_VALUE", flag, got, message };
}

/** A flag refused by name. */
function refused({ flag, message }: { flag: string; message: string }): SlackArgumentFlagRefusedError {
  return { code: "FLAG_REFUSED", flag, message };
}

/** A sub-command the verb does not have. */
function subcommandUnknown({
  verb,
  got,
  message,
}: {
  verb: string;
  got: string | undefined;
  message: string;
}): SlackArgumentSubcommandUnknownError {
  return { code: "SUBCOMMAND_UNKNOWN", got, message, verb };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const SlackArgumentErrors = {
  actorInvalid: ({ got }: { got: string }): SlackArgumentInvalidFlagValueError =>
    invalidValue({ flag: "--as", got, message: `--as must be \`bot\` or \`me\` (got ${JSON.stringify(got)})` }),
  actorMissing: (): SlackArgumentMissingError =>
    missing({
      message: "--as is required: pass `--as bot` (a schema-enforced card) or `--as me` (a freeform drip)",
      name: "--as",
    }),
  argumentsRefused: ({ reasons }: { reasons: readonly string[] }): SlackArgumentArgumentsRefusedError => ({
    code: "ARGUMENTS_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  bodyRefusedOnBot: (): SlackArgumentFlagRefusedError =>
    refused({
      flag: "--body",
      message: "--body is not valid with `--as bot` (or with no --as at all): pass --form instead",
    }),
  canvasSubcommandUnknown: ({
    got,
    known,
  }: {
    got: string | undefined;
    known: readonly string[];
  }): SlackArgumentSubcommandUnknownError =>
    subcommandUnknown({
      got,
      message: `slack canvas takes a sub-command: ${known.join(", ")} (got ${JSON.stringify(got)})`,
      verb: "canvas",
    }),
  channelMissing: (): SlackArgumentMissingError => missing({ message: "--channel is required", name: "--channel" }),
  channelSubcommandUnknown: ({ got }: { got: string | undefined }): SlackArgumentSubcommandUnknownError =>
    subcommandUnknown({
      got,
      message: `slack channel takes a sub-command: create, invite or archive (got ${JSON.stringify(got)})`,
      verb: "channel",
    }),
  dmSubcommandUnknown: ({ got }: { got: string | undefined }): SlackArgumentSubcommandUnknownError =>
    subcommandUnknown({
      got,
      message: `slack dm takes one sub-command: open (got ${JSON.stringify(got)})`,
      verb: "dm",
    }),
  draftIdMissing: ({ subcommand }: { subcommand: string }): SlackArgumentMissingError =>
    missing({
      message: `slack draft ${subcommand} needs the draft's id — list them with \`slopweaver slack draft list\``,
      name: "id",
    }),
  draftNoteMissing: (): SlackArgumentMissingError =>
    missing({
      message: "slack draft drop needs --note <text>: a row resolved with no reason is one nobody can audit",
      name: "--note",
    }),
  draftSubcommandUnknown: ({
    got,
    known,
  }: {
    got: string | undefined;
    known: readonly string[];
  }): SlackArgumentSubcommandUnknownError =>
    subcommandUnknown({
      got,
      message: `slack draft takes a sub-command: ${known.join(", ")} (got ${JSON.stringify(got)})`,
      verb: "draft",
    }),
  flagsInvalid: ({ reasons }: { reasons: readonly string[] }): SlackArgumentFlagsInvalidError => ({
    code: "FLAGS_INVALID",
    message: reasons.join("; "),
    reasons,
  }),
  flagRequired: ({ flag }: { flag: string }): SlackArgumentMissingError =>
    missing({ message: `${flag} is required`, name: flag }),
  formMissing: (): SlackArgumentMissingError =>
    missing({
      message: "--form is required: pass JSON, or `-` to read it from stdin (recommended for prose)",
      name: "--form",
    }),
  invocationIncoherent: ({ verb }: { verb: string }): SlackArgumentInvocationIncoherentError => ({
    code: "INVOCATION_INCOHERENT",
    message: `invalid slack ${verb} invocation`,
    verb,
  }),
  ownerPingFlagRefusedOnMe: (): SlackArgumentFlagRefusedError =>
    refused({
      flag: `--${ALLOW_UNRESOLVED_OWNER_FLAG}`,
      message:
        `--${ALLOW_UNRESOLVED_OWNER_FLAG} is not valid with \`--as me\`: it governs a DIGEST's owner ping, ` +
        "and the as-me lane has no card, no digest form and no owner field.",
    }),
  outputConflict: (): SlackArgumentFlagConflictError => ({
    code: "FLAG_CONFLICT",
    flags: ["--form", "--json"],
    message:
      "pass --form or --json, not both: --form emits the alert-summary form ALONE so it can be piped into " +
      "`slack post --as bot --form -`, while --json emits a document that CONTAINS that form plus how it was " +
      "sourced. Pipe the first; read the second with jq.",
  }),
  probeExhaustInvalid: ({ got }: { got: string }): SlackArgumentInvalidFlagValueError =>
    invalidValue({ flag: "--exhaust", got, message: "--exhaust needs a whole number of pages, at least 1" }),
  probeExpectInvalid: ({ got }: { got: string }): SlackArgumentInvalidFlagValueError =>
    invalidValue({
      flag: "--expect",
      got,
      message: `--expect needs <path>=<value>, e.g. --expect permalink=https://…; got "${got}"`,
    }),
  probeMethodMissing: (): SlackArgumentMissingError =>
    missing({ message: "--method is required: the dotted Web API method to call", name: "--method" }),
  settleNotWhole: ({ got }: { got: string }): SlackArgumentInvalidFlagValueError =>
    invalidValue({ flag: "--settle", got, message: `--settle takes whole milliseconds, got '${got}'` }),
  settleTooLong: ({ got, max }: { got: string; max: number }): SlackArgumentInvalidFlagValueError =>
    invalidValue({ flag: "--settle", got, message: `--settle may be at most ${String(max)}ms, got '${got}'` }),
  shapeInvalid: ({ got }: { got: string }): SlackArgumentInvalidFlagValueError =>
    invalidValue({
      flag: "--shape",
      got,
      message: `--shape must be \`top-level\` or \`thread\` (got ${JSON.stringify(got)})`,
    }),
  shapeMissing: (): SlackArgumentMissingError =>
    missing({
      message:
        "--shape is required with `--as me`: pass `--shape top-level` for N separate messages in the channel, " +
        "or `--shape thread` for a parent plus replies under it. There is deliberately NO default — which " +
        "one reads right depends on the conversation, so the caller decides each time.",
      name: "--shape",
    }),
  shapeRefusedOnReply: (): SlackArgumentFlagRefusedError =>
    refused({
      flag: "--shape",
      message:
        "`slack reply --as me` does not take --shape: every message of a reply drip goes into the thread " +
        "you named with --thread-ts. Use `slack post --as me --shape thread` to start a new one.",
    }),
  savedPositionalCount: ({ count }: { count: number }): SlackArgumentPositionalCountError => ({
    code: "POSITIONAL_COUNT_INVALID",
    count,
    message: `\`slack saved\` takes no positional argument — it reads only your own Later list — got ${String(count)}`,
    verb: "saved",
  }),
  shotPositionalCount: ({ count }: { count: number }): SlackArgumentPositionalCountError => ({
    code: "POSITIONAL_COUNT_INVALID",
    count,
    message: `\`slack shot\` takes ONE permalink, got ${String(count)}`,
    verb: "shot",
  }),
  shotTargetRefused: ({ detail }: { detail: string }): SlackArgumentTargetRefusedError => {
    const reasons = [
      detail,
      "`slack shot` photographs ONE rendered message, so it takes a message permalink and nothing else — " +
        "copy the link from the message's own overflow menu. A channel, search, settings or admin page is " +
        "refused here by name.",
    ];
    return { code: "TARGET_REFUSED", message: reasons.join("; "), reasons };
  },
  slackDraftWithoutCheckStdin: (): SlackArgumentFlagRefusedError =>
    refused({ flag: "--slack-draft", message: "--slack-draft requires --check-stdin: it says what stdin holds" }),
  sourceConflict: (): SlackArgumentFlagConflictError => ({
    code: "FLAG_CONFLICT",
    flags: ["--form", "--body"],
    message:
      "pass --form or --body, not both: --form is the sectioned drip (JSON), --body is the escape hatch " +
      "that sends exactly what you typed as one message",
  }),
  sourceMissing: (): SlackArgumentMissingError =>
    missing({
      message:
        "--form or --body is required with `--as me`: `--form -` reads a sectioned drip as JSON from stdin, " +
        "`--body -` reads a plain message body from stdin and sends it byte-for-byte",
      name: "--form/--body",
    }),
  thanksInsteadInvalid: ({ got, max }: { got: string; max: number }): SlackArgumentInvalidFlagValueError =>
    invalidValue({
      flag: "--thanks-instead",
      got,
      message:
        `--thanks-instead takes ONE non-empty line of at most ${String(max)} characters — thanks for the review, ` +
        "sent in place of a message the re-read found no longer needed",
    }),
  threadMovedClearedInvalid: ({
    got,
    malformed,
  }: {
    got: string;
    malformed: readonly string[];
  }): SlackArgumentInvalidFlagValueError =>
    invalidValue({
      flag: "--thread-moved-cleared",
      got,
      message:
        "--thread-moved-cleared needs the comma-separated ts set the moved-thread refusal printed; not a Slack ts: " +
        malformed.map((ts) => JSON.stringify(ts)).join(", "),
    }),
  threadTsMissing: (): SlackArgumentMissingError =>
    missing({ message: "`slack reply` requires --thread-ts", name: "--thread-ts" }),
  threadTsRefusedOnPost: (): SlackArgumentFlagRefusedError =>
    refused({ flag: "--thread-ts", message: "`slack post` does not take --thread-ts; use `slack reply`" }),
  whenInputMissing: (): SlackArgumentMissingError =>
    missing({ message: "slack when: name at least one Slack ts or permalink", name: "input" }),
} as const;

/**
 * The lines a {@link SlackArgumentError} prints, one per problem. A list-carrying variant gives each entry its
 * own line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display
 * reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function slackArgumentErrorLines({ error }: { error: SlackArgumentError }): readonly string[] {
  if (error.code === "FLAGS_INVALID" || error.code === "ARGUMENTS_REFUSED" || error.code === "TARGET_REFUSED") {
    return error.reasons;
  }
  return [error.message];
}
