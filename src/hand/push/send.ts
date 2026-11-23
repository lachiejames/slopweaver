/**
 * Posting one notification — the push lane's single effectful edge.
 *
 * ## The values go as ARGV, never into the script
 *
 * The obvious spelling, `osascript -e 'display notification "…"'`, builds a script out of a headline the
 * register took from whatever posted the step. The program below is a CONSTANT that reads its three lines
 * out of `argv`, so a headline carrying a quote, a backslash or a newline is data to the interpreter rather
 * than syntax. Measured: the whole call returns in 0.26s.
 *
 * ## Stated residue
 *
 * A notification posted this way carries the script runner's own notification identity, so if notifications
 * are switched off for it in System Settings the lane is silent and there is nothing here that can tell.
 * That is a real limit of the surface rather than a bug to find later, and `skills/hand/reference/` says so.
 */
import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type HandStepError, HandStepErrors } from "../errors.js";

import type { PushNotice } from "./notice.js";

/** One command, as argv — nothing here is ever joined into a shell line. */
export interface NotifyCommand {
  readonly file: string;
  readonly args: readonly string[];
}

/** The seam every post runs through, so a test drives the whole lane and posts nothing. */
export type NotifyRun = (command: NotifyCommand) => void;

/**
 * The constant program. It reads `argv[0..2]` and posts one banner.
 *
 * `includeStandardAdditions` is what puts `displayNotification` on the application object; without it the
 * call is not defined and `osascript` exits non-zero, which the caller reports as a surface failure.
 */
const NOTIFY_PROGRAM =
  "function run(argv){" +
  "const app=Application.currentApplication();" +
  "app.includeStandardAdditions=true;" +
  "app.displayNotification(argv[2],{withTitle:argv[0],subtitle:argv[1]});" +
  "return 'sent';}";

/**
 * The command that posts one notice.
 *
 * @param notice the three checked lines
 * @returns the `osascript` invocation, with every value in argv
 */
export function notifyCommand({ notice }: { notice: PushNotice }): NotifyCommand {
  return {
    args: ["-l", "JavaScript", "-e", NOTIFY_PROGRAM, notice.title, notice.subtitle, notice.body],
    file: "osascript",
  };
}

/**
 * Post one notice.
 *
 * @param notice the three checked lines
 * @param run the command seam
 * @returns the command that was run, or the failure
 */
export function sendPushNotice({
  notice,
  run,
}: {
  notice: PushNotice;
  run: NotifyRun;
}): Result<NotifyCommand, HandStepError> {
  const command = notifyCommand({ notice });
  try {
    run(command);
  } catch (cause) {
    return err(HandStepErrors.surfaceFailed({ cause: errorMessage({ error: cause }), surface: "notification" }));
  }
  return ok(command);
}
