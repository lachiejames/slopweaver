/**
 * Every `talk wake-chair` invocation, parsed — and the one refused before anything is read: a `--home` that would
 * type a wake for another home's calls into this machine's real chair.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { CONSOLE_ORIGIN_FLAGS, type ConsoleOriginArgs, consoleOriginOf } from "./consoleOriginArgs.js";
import { flagNames, stringOf } from "./flagValues.js";

/** The flags `talk wake-chair` accepts. */
const WAKE_CHAIR_FLAGS = {
  boolean: ["json", "dry-run"],
  string: ["home", "now", ...CONSOLE_ORIGIN_FLAGS],
} satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_WAKE_CHAIR_FLAG_NAMES: readonly string[] = flagNames({ spec: WAKE_CHAIR_FLAGS });

/** A flag the tokenizer refused — unknown, or missing its value; the messages are the tokenizer's own. */
interface WakeChairFlagsInvalidError {
  readonly code: "WAKE_CHAIR_FLAGS_INVALID";
  readonly message: string;
}

/** `--now` that is not an instant. */
interface WakeChairNowInvalidError {
  readonly code: "WAKE_CHAIR_NOW_INVALID";
  readonly message: string;
  readonly now: string;
}

/** `--home` or `--now` on a run that would type: the chair is this machine's, so its wake reads this home, now. */
interface WakeChairRealOnlyError {
  readonly code: "WAKE_CHAIR_REAL_ONLY";
  readonly message: string;
  readonly flag: string;
}

/** Every way a `talk wake-chair` invocation is refused. */
export type WakeChairArgsError = WakeChairFlagsInvalidError | WakeChairNowInvalidError | WakeChairRealOnlyError;

/** The factories every `talk wake-chair` usage refusal is constructed through. */
const WakeChairArgsErrors = {
  flagsInvalid: ({ messages }: { messages: readonly string[] }): WakeChairFlagsInvalidError => ({
    code: "WAKE_CHAIR_FLAGS_INVALID",
    message: messages.join("; "),
  }),
  nowInvalid: ({ now }: { now: string }): WakeChairNowInvalidError => ({
    code: "WAKE_CHAIR_NOW_INVALID",
    message: `talk wake-chair --now ${now} is not an ISO instant`,
    now,
  }),
  realOnly: ({ flag }: { flag: string }): WakeChairRealOnlyError => ({
    code: "WAKE_CHAIR_REAL_ONLY",
    flag,
    message: `talk wake-chair ${flag} only goes with --dry-run: a wake types into this machine's pinned chair, so it reads this machine's calls, now`,
  }),
} as const;

/** A parsed `talk wake-chair` invocation. */
export interface WakeChairArgs {
  /** Where the console asking for the wake serves from, when a console runs it: one that is not their types nothing. */
  readonly consoleOrigin: ConsoleOriginArgs | undefined;
  readonly dryRun: boolean;
  readonly home: string | undefined;
  readonly json: boolean;
  readonly now: string | undefined;
}

/**
 * Parse a `talk wake-chair` invocation.
 *
 * @param rest the argv after the verb
 * @returns the parsed arguments, or the first usage problem found
 */
export function parseWakeChairArgs({ rest }: { rest: readonly string[] }): Result<WakeChairArgs, WakeChairArgsError> {
  const parsed = parseFlags({ args: rest, spec: WAKE_CHAIR_FLAGS });
  if (parsed.isErr()) {
    return err(WakeChairArgsErrors.flagsInvalid({ messages: parsed.error }));
  }
  const { values } = parsed.value;
  const problems: string[] = [];
  const consoleOrigin = consoleOriginOf({ problems, values });
  if (problems.length > 0) {
    return err(WakeChairArgsErrors.flagsInvalid({ messages: problems }));
  }
  const now = stringOf({ value: values["now"] });
  if (now !== undefined && Number.isNaN(Date.parse(now))) {
    return err(WakeChairArgsErrors.nowInvalid({ now }));
  }
  const home = stringOf({ value: values["home"] });
  const dryRun = values["dry-run"] === true;
  if (!dryRun && home !== undefined) {
    return err(WakeChairArgsErrors.realOnly({ flag: "--home" }));
  }
  if (!dryRun && now !== undefined) {
    return err(WakeChairArgsErrors.realOnly({ flag: "--now" }));
  }
  return ok({ consoleOrigin, dryRun, home, json: values["json"] === true, now });
}
