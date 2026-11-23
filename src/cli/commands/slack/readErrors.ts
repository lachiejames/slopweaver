/**
 * The typed failures the `slack` read verbs author: `read-thread`, `read-file` and `channel-view`'s argument checks, a Web API
 * call `slack probe` could not make, the three reads a wall-run count depends on, and a `--markdown` source a
 * canvas could not read.
 *
 * A union of its own per `.claude/rules/error-handling.md`, scoped to reading in this directory; argument
 * parsing for the write verbs is `./argumentErrors.ts`'s. A flag tail the tokeniser refused rides as `reasons`,
 * and {@link slackReadErrorLines} prints it one line each, as the `readonly string[]` it replaced did.
 */
import type { Result } from "../../../lib/result.js";

/** The flag tokeniser refused the tail; `reasons` is its own list. */
export interface SlackReadFlagsInvalidError {
  readonly code: "FLAGS_INVALID";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** A required argument or flag value was not given; `name` is the flag or positional it names. */
export interface SlackReadArgumentMissingError {
  readonly code: "ARGUMENT_MISSING";
  readonly message: string;
  readonly name: string;
}

/** A verb that reads one reference was given `count` of them; `kind` names what it reads. */
export interface SlackReadPositionalCountError {
  readonly code: "POSITIONAL_COUNT_INVALID";
  readonly message: string;
  readonly kind: string;
  readonly count: number;
}

/** A flag was given a value it does not accept; `flag` names it and `got` is what arrived. */
export interface SlackReadInvalidFlagValueError {
  readonly code: "INVALID_FLAG_VALUE";
  readonly message: string;
  readonly flag: string;
  readonly got: string;
}

/** Two flags that ask for two different reads were both given; `flags` names them. */
export interface SlackReadFlagConflictError {
  readonly code: "FLAG_CONFLICT";
  readonly message: string;
  readonly flags: readonly string[];
}

/** `slack probe` could not call `method` at all — a transport failure, not a Slack error body. */
export interface SlackReadProbeCallFailedError {
  readonly code: "PROBE_CALL_FAILED";
  readonly message: string;
  readonly method: string;
  readonly reason: string;
}

/** One of the reads a wall-run count needs failed; `step` names which, `reason` what it said, if anything. */
export interface SlackReadWallRunUncountedError {
  readonly code: "WALL_RUN_UNCOUNTED";
  readonly message: string;
  readonly step: "identity" | "thread" | "workspace-url";
  readonly reason: string | undefined;
}

/** A `--markdown` source could not be read; `source` is the path as given. */
export interface SlackReadMarkdownUnreadableError {
  readonly code: "MARKDOWN_UNREADABLE";
  readonly message: string;
  readonly source: string;
  readonly reason: string;
}

/** Every failure reading in this directory authors. */
export type SlackReadError =
  | SlackReadFlagsInvalidError
  | SlackReadArgumentMissingError
  | SlackReadPositionalCountError
  | SlackReadInvalidFlagValueError
  | SlackReadFlagConflictError
  | SlackReadProbeCallFailedError
  | SlackReadWallRunUncountedError
  | SlackReadMarkdownUnreadableError;

/** What a read here answers: the value, or this union's typed refusal. */
export type SlackRead<T> = Result<T, SlackReadError>;

/** A missing argument, named. */
function missing({ name, message }: { name: string; message: string }): SlackReadArgumentMissingError {
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
}): SlackReadInvalidFlagValueError {
  return { code: "INVALID_FLAG_VALUE", flag, got, message };
}

/** A wall-run read that failed. */
function uncounted({
  step,
  reason,
  message,
}: {
  step: SlackReadWallRunUncountedError["step"];
  reason: string | undefined;
  message: string;
}): SlackReadWallRunUncountedError {
  return { code: "WALL_RUN_UNCOUNTED", message, reason, step };
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const SlackReadErrors = {
  channelCount: ({ channels }: { channels: readonly string[] }): SlackReadPositionalCountError => ({
    code: "POSITIONAL_COUNT_INVALID",
    count: channels.length,
    kind: "channel id",
    message: `expected one channel id, got ${String(channels.length)}: ${channels.join(" ")}`,
  }),
  channelInvalid: ({ got }: { got: string }): SlackReadInvalidFlagValueError =>
    invalidValue({
      flag: "<channel-id>",
      got,
      message: `a channel id looks like C0SYN123ABCD (or G…/D…), got ${got}`,
    }),
  channelMissing: (): SlackReadArgumentMissingError =>
    missing({ message: "a Slack channel id is required", name: "channel-id" }),
  contextRadiusInvalid: ({ flag, got }: { flag: string; got: string }): SlackReadInvalidFlagValueError =>
    invalidValue({ flag, got, message: `${flag} must be a non-negative integer, got ${got}` }),
  fileReferenceCount: ({ references }: { references: readonly string[] }): SlackReadPositionalCountError => ({
    code: "POSITIONAL_COUNT_INVALID",
    count: references.length,
    kind: "file reference",
    message: `expected one file reference, got ${String(references.length)}: ${references.join(" ")}`,
  }),
  fileReferenceMissing: (): SlackReadArgumentMissingError =>
    missing({ message: "a Slack file id or file link is required", name: "file" }),
  flagsInvalid: ({ reasons }: { reasons: readonly string[] }): SlackReadFlagsInvalidError => ({
    code: "FLAGS_INVALID",
    message: reasons.join("; "),
    reasons,
  }),
  markdownUnreadable: ({ source, reason }: { source: string; reason: string }): SlackReadMarkdownUnreadableError => ({
    code: "MARKDOWN_UNREADABLE",
    message: `cannot read --markdown ${JSON.stringify(source)}: ${reason}`,
    reason,
    source,
  }),
  maxFileMbInvalid: ({ got }: { got: string }): SlackReadInvalidFlagValueError =>
    invalidValue({ flag: "--max-file-mb", got, message: `--max-file-mb must be a positive number, got ${got}` }),
  permalinkCount: ({ permalinks }: { permalinks: readonly string[] }): SlackReadPositionalCountError => ({
    code: "POSITIONAL_COUNT_INVALID",
    count: permalinks.length,
    kind: "permalink",
    message: `expected one permalink, got ${String(permalinks.length)}: ${permalinks.join(" ")}`,
  }),
  permalinkMissing: (): SlackReadArgumentMissingError =>
    missing({ message: "a Slack permalink is required", name: "permalink" }),
  probeCallFailed: ({ method, reason }: { method: string; reason: string }): SlackReadProbeCallFailedError => ({
    code: "PROBE_CALL_FAILED",
    message: `${method}: ${reason}`,
    method,
    reason,
  }),
  sinceContextConflict: (): SlackReadFlagConflictError => ({
    code: "FLAG_CONFLICT",
    flags: ["--since", "--around", "--channel-around"],
    message: "--since cannot be combined with --around or --channel-around",
  }),
  sinceInvalid: ({ got }: { got: string }): SlackReadInvalidFlagValueError =>
    invalidValue({
      flag: "--since",
      got,
      message:
        `--since must be a Slack timestamp like 1785114398.557099, got ${got}. ` +
        "Every read prints each message's ts — copy one of those",
    }),
  valueMissing: ({ flag }: { flag: string }): SlackReadArgumentMissingError =>
    missing({ message: `${flag} requires a value`, name: flag }),
  wallIdentityUnread: ({ reason }: { reason: string }): SlackReadWallRunUncountedError =>
    uncounted({
      message: `could not establish our own identity to count the wall run: ${reason}`,
      reason,
      step: "identity",
    }),
  wallThreadUnread: ({ channel, reason }: { channel: string; reason: string }): SlackReadWallRunUncountedError =>
    uncounted({
      message: `could not read ${channel}'s thread to count the wall run: ${reason}`,
      reason,
      step: "thread",
    }),
  wallWorkspaceUrlUnresolved: (): SlackReadWallRunUncountedError =>
    uncounted({
      message: "could not resolve the workspace url to count the wall run",
      reason: undefined,
      step: "workspace-url",
    }),
  workspaceInvalid: ({ got }: { got: string }): SlackReadInvalidFlagValueError =>
    invalidValue({
      flag: "--workspace",
      got,
      message: `--workspace is a Slack host such as acme.slack.com, got ${got}`,
    }),
} as const;

/**
 * The lines a {@link SlackReadError} prints, one per problem. The flag tokeniser's list gives each entry its own
 * line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function slackReadErrorLines({ error }: { error: SlackReadError }): readonly string[] {
  if (error.code === "FLAGS_INVALID") {
    return error.reasons;
  }
  return [error.message];
}
