/**
 * `slopweaver knock verify` — does the stored key read messages, and can this door still read one.
 *
 * Two pages of size one (`verifyKnockAccess`): a far-future window designed to fetch nothing, which proves the key,
 * then the first message an unfiltered list returns, parsed through the strict boundary and dropped. The second
 * read DOES load one user-linked record into memory; nothing of it is printed, stored or returned here — only
 * whether a shape was exercised. It cannot prove the key is read-only: Knock mints no such key, so the GET-only
 * transport is what bounds this door.
 */
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { type KnockAccessVerification, verifyKnockAccess } from "../../../live/knock/reads.js";
import { openKnockSession } from "../../../live/knock/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parseKnockVerifyOptions } from "./core.js";
import {
  askedForHelp,
  exitForKnockError,
  type KnockSessionOpener,
  type KnockSink,
  printRefusal,
  sessionOrExit,
} from "./shell.js";
import { KNOCK_VERIFY_USAGE } from "./usage.js";

/** The one line `knock verify` prints, by whether a message's shape was exercised. */
const KNOCK_VERIFY_LINES: Readonly<Record<KnockAccessVerification["messageShape"], string>> = {
  exercised: "the stored Knock key reads messages in its environment, and the first message returned read cleanly",
  unexercised:
    "the stored Knock key reads messages in its environment; it returned no message, so no message shape was tested",
};

/**
 * Run `knock verify` over injected seams.
 *
 * @param argv the full process argv
 * @param open how the session is opened
 * @param sink where the answer and refusals are written
 * @returns the process exit code
 */
export async function runKnockVerifyWith({
  argv,
  open,
  sink,
}: {
  argv: readonly string[];
  open: KnockSessionOpener;
  sink: KnockSink;
}): Promise<number> {
  const rest = verbTail({ argv, verbs: ["verify"] });
  if (askedForHelp({ rest, sink, usage: KNOCK_VERIFY_USAGE })) {
    return EXIT_OK;
  }
  const parsed = parseKnockVerifyOptions({ rest });
  if (parsed.isErr()) {
    printRefusal({ reasons: parsed.error, sink, usage: KNOCK_VERIFY_USAGE });
    return EXIT_USAGE;
  }
  const opened = sessionOrExit({ home: parsed.value.home, open, sink });
  if ("exit" in opened) {
    return opened.exit;
  }
  const verified = await verifyKnockAccess({ get: opened.session.get });
  if (verified.isErr()) {
    return exitForKnockError({ error: verified.error, sink });
  }
  const { messageShape } = verified.value;
  if (parsed.value.json) {
    sink.out({ line: safeJsonStringify({ label: "knock verify", value: { messageShape, readsMessages: true } }) });
    return EXIT_OK;
  }
  sink.out({ line: KNOCK_VERIFY_LINES[messageShape] });
  return EXIT_OK;
}

/**
 * Run the `knock verify` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnockVerify(argv: readonly string[]): Promise<number> {
  return runKnockVerifyWith({ argv, open: openKnockSession, sink: logger });
}

export const knockVerifyCommand = defineCommand({ run: runKnockVerify });
