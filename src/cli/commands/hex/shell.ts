/**
 * The eight `hex` verbs' shared shell: help, the credential resolve, and the one place a typed
 * {@link HexReadError} becomes an exit code.
 *
 * The mapping is the contract `core.ts`'s header states, and it lives here so no verb can grade a missing
 * token as a failed read: `TOKEN_MISSING` is exit 3 with the mint line, and everything else is exit 1 with
 * the error's own message, which already says what a reader should conclude.
 */
import type { HexClient } from "../../../hex/client.js";
import type { HexReadError } from "../../../hex/errors.js";
import { openHexClient } from "../../../hex/session.js";
import { type Logger, logger } from "../../../lib/logger.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";

/**
 * Whether the tail asks for help, and print the usage when it does.
 *
 * @param rest the verb's own argv tail
 * @param usage the verb's usage line
 * @param sink where the usage is written; stdout through the process logger by default
 * @returns true when help was printed and the verb should return {@link EXIT_OK}
 */
export function askedForHelp({
  rest,
  usage,
  sink = logger,
}: {
  rest: readonly string[];
  usage: string;
  sink?: Pick<Logger, "out">;
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
 * @param sink where the lines are written; stderr through the process logger by default
 */
export function printRefusal({
  reasons,
  usage,
  sink = logger,
}: {
  reasons: readonly string[];
  usage: string;
  sink?: Pick<Logger, "error">;
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
 * @param sink where the failure's message is written; stderr through the process logger by default
 * @returns `3` when this install holds no token, else `1`
 */
export function exitForHexError({
  error,
  sink = logger,
}: {
  error: HexReadError;
  sink?: Pick<Logger, "error">;
}): number {
  sink.error({ msg: error.message });
  return error.code === "TOKEN_MISSING" ? EXIT_EXPECTED_EMPTY : EXIT_ERROR;
}

/**
 * Open a client or print why there is none.
 *
 * @returns the client, or the exit code the caller should return
 */
export function clientOrExit(): { client: HexClient } | { exit: number } {
  const opened = openHexClient();
  if (opened.isErr()) {
    return { exit: exitForHexError({ error: opened.error }) };
  }
  return { client: opened.value };
}
