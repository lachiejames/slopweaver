/**
 * What `slopweaver talk transcript`, `talk calls`, `talk thread` and `talk unread` ACCEPT — their flag specs and pure parsers. A file of their own
 * for the reason `./knowArgs.ts` gives: `./args.ts` already holds six verbs' worth.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { THREAD_TURNS_DEFAULT, THREAD_TURNS_MAX } from "../../../talk/chatThread.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import {
  CONSOLE_INSTANCE_FLAG,
  CONSOLE_ORIGIN_FLAGS,
  type ConsoleOriginArgs,
  consoleOriginWithInstanceOf,
} from "./consoleOriginArgs.js";
import { flagNames, numberOf, stringOf } from "./flagValues.js";
import { type UnreadArgsError, UnreadArgsErrors } from "./unreadArgsErrors.js";

/** The flags `talk transcript` accepts. */
const TRANSCRIPT_FLAGS = {
  boolean: ["json"],
  string: ["call", "dir", "entries-file", "handoff", "home", ...CONSOLE_ORIGIN_FLAGS, CONSOLE_INSTANCE_FLAG],
} satisfies FlagSpec;

/** The flags `talk calls` accepts. */
const CALLS_FLAGS = { boolean: ["json"], string: ["limit", "home"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_TRANSCRIPT_FLAG_NAMES: readonly string[] = flagNames({ spec: TRANSCRIPT_FLAGS });

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_CALLS_FLAG_NAMES: readonly string[] = flagNames({ spec: CALLS_FLAGS });

/** How many calls `talk calls` reads by default — the last few earlier calls. */
const DEFAULT_CALLS = 5;

/** The most calls one `talk calls` read may ask for. */
const MAX_CALLS = 50;

/** A parsed `talk transcript` invocation. */
export interface TranscriptArgs {
  readonly call: string;
  readonly entriesFile: string;
  /**
   * Where the console server that ran it is serving from, marked when the desktop test instance posted the batch;
   * `undefined` for a hand run (`./consoleOrigin.ts`).
   */
  readonly consoleOrigin: ConsoleOriginArgs | undefined;
  /** The board directory a landing registers its row in; the home's own when absent. */
  readonly dir: string | undefined;
  /**
   * The route's handoff intent this run was spawned under (`site/lib/writerIntent.ts`): the run writes nothing once it
   * has lapsed (`src/talk/writerRunIntent.ts`). Absent on a hand run.
   */
  readonly handoff: string | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** A parsed `talk calls` invocation. */
export interface CallsArgs {
  readonly limit: number;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk transcript` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseTranscriptArgs({ rest }: { rest: readonly string[] }): Result<TranscriptArgs> {
  const parsed = parseFlags({ args: rest, spec: TRANSCRIPT_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const call = stringOf({ value: values["call"] });
  const entriesFile = stringOf({ value: values["entries-file"] });
  const problems: string[] = [];
  if (call === undefined) {
    problems.push("talk transcript needs --call <uuid>, the call the console minted");
  }
  if (entriesFile === undefined) {
    problems.push("talk transcript needs --entries-file <jsonl>, the batch of lines to append");
  }
  const consoleOrigin = consoleOriginWithInstanceOf({ problems, values });
  if (call === undefined || entriesFile === undefined || problems.length > 0) {
    return err(problems);
  }
  return ok({
    call,
    consoleOrigin,
    dir: stringOf({ value: values["dir"] }),
    entriesFile,
    handoff: stringOf({ value: values["handoff"] }),
    home: stringOf({ value: values["home"] }),
    json: values["json"] === true,
  });
}

/**
 * Parse a `talk calls` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseCallsArgs({ rest }: { rest: readonly string[] }): Result<CallsArgs> {
  const parsed = parseFlags({ args: rest, spec: CALLS_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const limit = numberOf({ fallback: DEFAULT_CALLS, name: "--limit", problems, value: values["limit"] });
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CALLS) {
    problems.push(`talk calls --limit is a whole number from 1 to ${String(MAX_CALLS)}`);
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({ home: stringOf({ value: values["home"] }), json: values["json"] === true, limit });
}

/** The flags `talk thread` accepts. */
const THREAD_FLAGS = { boolean: ["json"], string: ["turns", "home"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_THREAD_FLAG_NAMES: readonly string[] = flagNames({ spec: THREAD_FLAGS });

/** A parsed `talk thread` invocation. */
export interface ThreadArgs {
  readonly turns: number;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk thread` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseThreadArgs({ rest }: { rest: readonly string[] }): Result<ThreadArgs> {
  const parsed = parseFlags({ args: rest, spec: THREAD_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const turns = numberOf({ fallback: THREAD_TURNS_DEFAULT, name: "--turns", problems, value: values["turns"] });
  if (!Number.isInteger(turns) || turns < 1 || turns > THREAD_TURNS_MAX) {
    problems.push(`talk thread --turns is a whole number from 1 to ${String(THREAD_TURNS_MAX)}`);
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({ home: stringOf({ value: values["home"] }), json: values["json"] === true, turns });
}

/** The flags `talk cut-ins` accepts. */
const CUT_INS_FLAGS = { boolean: ["json"], string: ["since", "home"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_CUT_INS_FLAG_NAMES: readonly string[] = flagNames({ spec: CUT_INS_FLAGS });

/** A parsed `talk cut-ins` invocation. */
export interface CutInsArgs {
  /** An instant or a span back from now (`56d`, `12h`); the verb's own window when absent. */
  readonly since: string | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk cut-ins` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseCutInsArgs({ rest }: { rest: readonly string[] }): Result<CutInsArgs> {
  const parsed = parseFlags({ args: rest, spec: CUT_INS_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  return ok({
    home: stringOf({ value: values["home"] }),
    json: values["json"] === true,
    since: stringOf({ value: values["since"] }),
  });
}

/** The flags `talk fidelity` accepts. */
const FIDELITY_FLAGS = {
  boolean: ["json", "words"],
  string: ["call", "since", "until", "limit", "home"],
} satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_FIDELITY_FLAG_NAMES: readonly string[] = flagNames({ spec: FIDELITY_FLAGS });

/** How many divergent pairs `talk fidelity` prints by default, newest first. */
const DEFAULT_FIDELITY_PAIRS = 10;

/** The most pairs one `talk fidelity` read may print. */
const MAX_FIDELITY_PAIRS = 200;

/** A parsed `talk fidelity` invocation. */
export interface FidelityArgs {
  /** One call, read whole; never with `since` or `until`. */
  readonly call: string | undefined;
  /** An instant or a span back from now (`14d`, `12h`); the verb's own window when absent. */
  readonly since: string | undefined;
  readonly until: string | undefined;
  /** How many divergent pairs to print, newest first. */
  readonly limit: number;
  readonly home: string | undefined;
  readonly json: boolean;
  /** The content-word reading of the voice hop alone, in place of the claim reading of both hops. */
  readonly words: boolean;
}

/**
 * Parse a `talk fidelity` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseFidelityArgs({ rest }: { rest: readonly string[] }): Result<FidelityArgs> {
  const parsed = parseFlags({ args: rest, spec: FIDELITY_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const call = stringOf({ value: values["call"] });
  const since = stringOf({ value: values["since"] });
  const until = stringOf({ value: values["until"] });
  if (call !== undefined && (since !== undefined || until !== undefined)) {
    problems.push("talk fidelity takes --call <uuid> or a --since/--until window, never both");
  }
  const limit = numberOf({ fallback: DEFAULT_FIDELITY_PAIRS, name: "--limit", problems, value: values["limit"] });
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_FIDELITY_PAIRS) {
    problems.push(`talk fidelity --limit is a whole number from 1 to ${String(MAX_FIDELITY_PAIRS)}`);
  }
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    call,
    home: stringOf({ value: values["home"] }),
    json: values["json"] === true,
    limit,
    since,
    until,
    words: values["words"] === true,
  });
}

/** The flags `talk unread` accepts. */
const UNREAD_FLAGS = {
  boolean: ["json", "mark", "all", "adopt"],
  string: ["cursor", "now", "home"],
} satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_UNREAD_FLAG_NAMES: readonly string[] = flagNames({ spec: UNREAD_FLAGS });

/** A parsed `talk unread` invocation. */
export interface UnreadArgs {
  /** The reader whose place is read and, with `mark`, moved — `supervisor` unless named. */
  readonly cursor: string;
  /** Whether to record everything this read prints as read. */
  readonly mark: boolean;
  /** With no cursor yet, print every word on every call rather than the last 24 hours. */
  readonly all: boolean;
  /** With no cursor yet, let a first mark take the words the 24-hour window left out as read, unprinted. */
  readonly adopt: boolean;
  /** The instant a first read's 24-hour window is measured back from; the clock when absent. */
  readonly now: string | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `talk unread` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or every usage problem found
 */
export function parseUnreadArgs({ rest }: { rest: readonly string[] }): Result<UnreadArgs, UnreadArgsError> {
  const parsed = parseFlags({ args: rest, spec: UNREAD_FLAGS });
  if (parsed.isErr()) {
    return err(UnreadArgsErrors.flagsInvalid({ messages: parsed.error }));
  }
  const { values } = parsed.value;
  const now = stringOf({ value: values["now"] });
  if (now !== undefined && Number.isNaN(Date.parse(now))) {
    return err(UnreadArgsErrors.nowInvalid({ now }));
  }
  if (values["adopt"] === true && values["mark"] !== true) {
    return err(UnreadArgsErrors.adoptWithoutMark());
  }
  let cursor = "supervisor";
  const named = stringOf({ value: values["cursor"] });
  if (named !== undefined) {
    cursor = named;
  }
  return ok({
    adopt: values["adopt"] === true,
    all: values["all"] === true,
    cursor,
    home: stringOf({ value: values["home"] }),
    json: values["json"] === true,
    mark: values["mark"] === true,
    now,
  });
}
