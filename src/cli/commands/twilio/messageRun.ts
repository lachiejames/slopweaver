/**
 * `slopweaver twilio message --sid <SM…>` — one message's delivery facts, re-read live.
 *
 * A status moves after the list was read (`sent` becomes `delivered` or `undelivered` when the carrier answers),
 * so the follow-up read of one SID is what settles a delivery claim. Same view as the list: no body, numbers
 * masked.
 */
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { renderTwilioMessage } from "../../../live/twilio/projection.js";
import { readTwilioMessage } from "../../../live/twilio/reads.js";
import { openTwilioSession } from "../../../live/twilio/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parseTwilioMessageOptions } from "./core.js";
import {
  askedForHelp,
  exitForTwilioError,
  printRefusal,
  sessionOrExit,
  type TwilioSessionOpener,
  type TwilioSink,
} from "./shell.js";
import { TWILIO_MESSAGE_USAGE } from "./usage.js";

/**
 * Run `twilio message` over injected seams.
 *
 * @param argv the full process argv
 * @param open how the session is opened
 * @param sink where the answer and refusals are written
 * @returns the process exit code
 */
export async function runTwilioMessageWith({
  argv,
  open,
  sink,
}: {
  argv: readonly string[];
  open: TwilioSessionOpener;
  sink: TwilioSink;
}): Promise<number> {
  const rest = verbTail({ argv, verbs: ["message"] });
  if (askedForHelp({ rest, sink, usage: TWILIO_MESSAGE_USAGE })) {
    return EXIT_OK;
  }
  const parsed = parseTwilioMessageOptions({ rest });
  if (parsed.isErr()) {
    printRefusal({ reasons: parsed.error, sink, usage: TWILIO_MESSAGE_USAGE });
    return EXIT_USAGE;
  }
  const opened = sessionOrExit({ home: parsed.value.home, open, sink });
  if ("exit" in opened) {
    return opened.exit;
  }
  const read = await readTwilioMessage({
    accountSid: opened.session.accountSid,
    get: opened.session.get,
    sid: parsed.value.sid,
  });
  if (read.isErr()) {
    return exitForTwilioError({ error: read.error, sink });
  }
  if (parsed.value.json) {
    sink.out({ line: safeJsonStringify({ label: "twilio message", value: read.value }) });
    return EXIT_OK;
  }
  renderTwilioMessage({ view: read.value }).forEach((line) => {
    sink.out({ line });
  });
  return EXIT_OK;
}

/**
 * Run the `twilio message` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTwilioMessage(argv: readonly string[]): Promise<number> {
  return runTwilioMessageWith({ argv, open: openTwilioSession, sink: logger });
}

export const twilioMessageCommand = defineCommand({ run: runTwilioMessage });
