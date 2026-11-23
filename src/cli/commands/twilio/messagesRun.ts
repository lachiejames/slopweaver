/**
 * `slopweaver twilio messages` — which messages went to or from a number in a window, and what became of each.
 *
 * The SMS-delivery question an investigation asks ("did the reminder reach this customer?") is a status
 * and an error code per message, so that is what prints: the delivery facts, the numbers masked to their last
 * three digits, and never a body. A limit reached with more remaining says so on its own line, because a cut
 * list read as a complete one is the wrong answer to "was it delivered".
 */
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { renderTwilioMessage } from "../../../live/twilio/projection.js";
import { listTwilioMessages } from "../../../live/twilio/reads.js";
import { openTwilioSession } from "../../../live/twilio/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parseTwilioMessagesOptions } from "./core.js";
import {
  askedForHelp,
  exitForTwilioError,
  printRefusal,
  sessionOrExit,
  type TwilioSessionOpener,
  type TwilioSink,
} from "./shell.js";
import { TWILIO_MESSAGES_USAGE } from "./usage.js";

/**
 * Run `twilio messages` over injected seams.
 *
 * @param argv the full process argv
 * @param open how the session is opened
 * @param sink where the answer and refusals are written
 * @returns the process exit code
 */
export async function runTwilioMessagesWith({
  argv,
  open,
  sink,
}: {
  argv: readonly string[];
  open: TwilioSessionOpener;
  sink: TwilioSink;
}): Promise<number> {
  const rest = verbTail({ argv, verbs: ["messages"] });
  if (askedForHelp({ rest, sink, usage: TWILIO_MESSAGES_USAGE })) {
    return EXIT_OK;
  }
  const parsed = parseTwilioMessagesOptions({ rest });
  if (parsed.isErr()) {
    printRefusal({ reasons: parsed.error, sink, usage: TWILIO_MESSAGES_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const opened = sessionOrExit({ home: options.home, open, sink });
  if ("exit" in opened) {
    return opened.exit;
  }
  const listed = await listTwilioMessages({
    accountSid: opened.session.accountSid,
    filter: options.filter,
    get: opened.session.get,
    limit: options.limit,
  });
  if (listed.isErr()) {
    return exitForTwilioError({ error: listed.error, sink });
  }
  if (options.json) {
    sink.out({ line: safeJsonStringify({ label: "twilio messages", value: listed.value }) });
    return EXIT_OK;
  }
  sink.out({ line: `${String(listed.value.messages.length)} message(s), newest first` });
  listed.value.messages.forEach((view) => {
    renderTwilioMessage({ view }).forEach((line) => {
      sink.out({ line });
    });
  });
  if (listed.value.moreRemain) {
    sink.out({ line: `more messages match than --limit ${String(options.limit)} — raise it or narrow the window` });
  }
  return EXIT_OK;
}

/**
 * Run the `twilio messages` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTwilioMessages(argv: readonly string[]): Promise<number> {
  return runTwilioMessagesWith({ argv, open: openTwilioSession, sink: logger });
}

export const twilioMessagesCommand = defineCommand({ run: runTwilioMessages });
