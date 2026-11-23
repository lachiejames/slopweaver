/**
 * One draft verb's read, check and append, run under the register's write lock. `approve`, `hold`, `drop` and the park
 * and drops of `record --supersedes` each decide off a read; without the lock an approve could land between a drop's
 * check and its append, and the drop is terminal. The lock is taken only around the
 * register work, never across a Slack read, so a verb waiting on it waits on file I/O alone.
 */
import { logger } from "../../../lib/logger.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import type { SlackDraftDeps } from "./draftRun.js";

/**
 * Run the register work under the lock and release it however the work ends — or record nothing when the lock is not
 * taken.
 *
 * @param deps the injected world, for the lock
 * @param home the state home the register lives under
 * @param run the read, check and append, returning the verb's exit code
 * @returns the work's exit code, or `EXIT_ERROR` when the lock was not taken
 */
export function underRegisterLock({
  deps,
  home,
  run,
}: {
  deps: Pick<SlackDraftDeps, "lockRegister">;
  home: string;
  run: () => number;
}): number {
  const held = deps.lockRegister({ home });
  if (held.isErr()) {
    logger.error({ msg: `${held.error.message} — nothing was recorded; the register is as it was.` });
    return EXIT_ERROR;
  }
  try {
    return run();
  } finally {
    held.value();
  }
}
