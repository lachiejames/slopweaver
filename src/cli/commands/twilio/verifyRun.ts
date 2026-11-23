/**
 * `slopweaver twilio verify` — does the stored key read Messages on the stored account, fetching no message.
 *
 * The read is one page of size one bounded before any message could exist (`verifyTwilioAccess`), so a working
 * key answers an empty page and the proof touches no customer record. It cannot prove the key is RESTRICTED to
 * reads: Twilio answers no scope introspection, so the GET-only transport is what bounds this door either way.
 */
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { verifyTwilioAccess } from "../../../live/twilio/reads.js";
import { openTwilioSession } from "../../../live/twilio/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parseTwilioVerifyOptions } from "./core.js";
import {
  askedForHelp,
  exitForTwilioError,
  printRefusal,
  sessionOrExit,
  type TwilioSessionOpener,
  type TwilioSink,
} from "./shell.js";
import { TWILIO_VERIFY_USAGE } from "./usage.js";

/**
 * Run `twilio verify` over injected seams.
 *
 * @param argv the full process argv
 * @param open how the session is opened
 * @param sink where the answer and refusals are written
 * @returns the process exit code
 */
export async function runTwilioVerifyWith({
  argv,
  open,
  sink,
}: {
  argv: readonly string[];
  open: TwilioSessionOpener;
  sink: TwilioSink;
}): Promise<number> {
  const rest = verbTail({ argv, verbs: ["verify"] });
  if (askedForHelp({ rest, sink, usage: TWILIO_VERIFY_USAGE })) {
    return EXIT_OK;
  }
  const parsed = parseTwilioVerifyOptions({ rest });
  if (parsed.isErr()) {
    printRefusal({ reasons: parsed.error, sink, usage: TWILIO_VERIFY_USAGE });
    return EXIT_USAGE;
  }
  const opened = sessionOrExit({ home: parsed.value.home, open, sink });
  if ("exit" in opened) {
    return opened.exit;
  }
  const verified = await verifyTwilioAccess({ accountSid: opened.session.accountSid, get: opened.session.get });
  if (verified.isErr()) {
    return exitForTwilioError({ error: verified.error, sink });
  }
  if (parsed.value.json) {
    sink.out({
      line: safeJsonStringify({
        label: "twilio verify",
        value: { accountSid: opened.session.accountSid, readsMessages: true },
      }),
    });
    return EXIT_OK;
  }
  sink.out({ line: `the stored Twilio key reads Messages on ${opened.session.accountSid}` });
  return EXIT_OK;
}

/**
 * Run the `twilio verify` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTwilioVerify(argv: readonly string[]): Promise<number> {
  return runTwilioVerifyWith({ argv, open: openTwilioSession, sink: logger });
}

export const twilioVerifyCommand = defineCommand({ run: runTwilioVerify });
