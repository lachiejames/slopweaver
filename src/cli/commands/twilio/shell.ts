/**
 * The three `twilio` verbs' shared shell: help, refusal printing, the session open, and the one place a typed
 * {@link TwilioReadError} becomes an exit code.
 *
 * The mapping is the contract `core.ts`'s header states, and it lives here so no verb can grade a missing key as
 * a failed read: `TOKEN_MISSING` is exit 3 with the mint step, and everything else is exit 1 with the error's own
 * message, which already says what a reader should conclude.
 *
 * Every verb runs through a `*With` function taking the session opener and the sink as seams, so a test drives
 * the real verb over canned bodies with no key and no network.
 */
import { slopweaverHome } from "../../../homeDir.js";
import type { Logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import type { TwilioReadError } from "../../../live/twilio/errors.js";
import type { TwilioSession } from "../../../live/twilio/session.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";

/** Where a verb writes: `out` for its answer, `error` for refusals. */
export type TwilioSink = Pick<Logger, "error" | "out">;

/** How a verb gets its read seam — `openTwilioSession` in production, a canned session in a test. */
export type TwilioSessionOpener = (request: { home: string }) => Result<TwilioSession, TwilioReadError>;

/**
 * Whether the tail asks for help, printing the usage when it does.
 *
 * @param rest the verb's own argv tail
 * @param usage the verb's usage line
 * @param sink where the usage is written
 * @returns true when help was printed and the verb should exit 0
 */
export function askedForHelp({
  rest,
  usage,
  sink,
}: {
  rest: readonly string[];
  usage: string;
  sink: TwilioSink;
}): boolean {
  if (rest.includes("--help") || rest.includes("-h")) {
    sink.out({ line: usage });
    return true;
  }
  return false;
}

/**
 * Print every rejection, then the usage.
 *
 * @param reasons every reason the invocation was refused
 * @param usage the verb's usage line
 * @param sink where the lines are written
 */
export function printRefusal({
  reasons,
  usage,
  sink,
}: {
  reasons: readonly string[];
  usage: string;
  sink: TwilioSink;
}): void {
  reasons.forEach((msg) => {
    sink.error({ msg });
  });
  sink.error({ msg: usage });
}

/**
 * Print one typed read failure and give the exit code it earns.
 *
 * @param error the typed failure
 * @param sink where the failure's message is written
 * @returns `3` when this install holds no key, else `1`
 */
export function exitForTwilioError({ error, sink }: { error: TwilioReadError; sink: TwilioSink }): number {
  sink.error({ msg: error.message });
  if (error.code === "TOKEN_MISSING") {
    return EXIT_EXPECTED_EMPTY;
  }
  return EXIT_ERROR;
}

/**
 * Open a session against `--home` (or this install's home), or print why there is none.
 *
 * @param home the parsed `--home`, `null` for this install's own state home
 * @param open the session opener seam
 * @param sink where a failure is written
 * @returns the session, or the exit code the verb should return
 */
export function sessionOrExit({
  home,
  open,
  sink,
}: {
  home: string | null;
  open: TwilioSessionOpener;
  sink: TwilioSink;
}): { session: TwilioSession } | { exit: number } {
  const opened = open({ home: home === null ? slopweaverHome() : resolveHome({ named: home }) });
  if (opened.isErr()) {
    return { exit: exitForTwilioError({ error: opened.error, sink }) };
  }
  return { session: opened.value };
}
