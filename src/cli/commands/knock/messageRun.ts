/**
 * `slopweaver knock message --id <id>`, `knock message-events --id <id>` and `knock delivery-logs --id <id>` —
 * one message, what happened to it, and the provider calls Knock made for it.
 *
 * One module for the three per-message reads because they share one id, one parser and one exit contract. The
 * delivery log is where "Knock sent it" becomes "Twilio answered 201" or "Twilio answered 400": its service and
 * status are printed, never the request or response body or headers, which carry the number and the text.
 */
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { renderKnockMessage } from "../../../live/knock/projection.js";
import { listKnockDeliveryLogs, listKnockMessageEvents, readKnockMessage } from "../../../live/knock/reads.js";
import { openKnockSession } from "../../../live/knock/session.js";
import type { KnockGet } from "../../../live/knock/transport.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { type KnockMessageOptions, parseKnockMessageOptions } from "./core.js";
import {
  askedForHelp,
  exitForKnockError,
  type KnockSessionOpener,
  type KnockSink,
  printKnockList,
  printRefusal,
  sessionOrExit,
} from "./shell.js";
import { KNOCK_DELIVERY_LOGS_USAGE, KNOCK_MESSAGE_EVENTS_USAGE, KNOCK_MESSAGE_USAGE } from "./usage.js";

/** Which per-message read. */
export type KnockMessageRead = "message" | "message-events" | "delivery-logs";

/** Each read's usage line. */
const USAGE: Readonly<Record<KnockMessageRead, string>> = {
  "delivery-logs": KNOCK_DELIVERY_LOGS_USAGE,
  message: KNOCK_MESSAGE_USAGE,
  "message-events": KNOCK_MESSAGE_EVENTS_USAGE,
};

/**
 * Run one per-message verb over injected seams.
 *
 * @param argv the full process argv
 * @param read which of the three verbs
 * @param open how the session is opened
 * @param sink where the answer and refusals are written
 * @returns the process exit code
 */
export async function runKnockMessageWith({
  argv,
  read,
  open,
  sink,
}: {
  argv: readonly string[];
  read: KnockMessageRead;
  open: KnockSessionOpener;
  sink: KnockSink;
}): Promise<number> {
  const usage = USAGE[read];
  const rest = verbTail({ argv, verbs: [read] });
  if (askedForHelp({ rest, sink, usage })) {
    return EXIT_OK;
  }
  const parsed = parseKnockMessageOptions({ rest, withLimit: read !== "message" });
  if (parsed.isErr()) {
    printRefusal({ reasons: parsed.error, sink, usage });
    return EXIT_USAGE;
  }
  const opened = sessionOrExit({ home: parsed.value.home, open, sink });
  if ("exit" in opened) {
    return opened.exit;
  }
  return answerRead({ get: opened.session.get, options: parsed.value, read, sink });
}

/**
 * Run one per-message read over an open session and print its answer.
 *
 * @param get the session's read seam
 * @param options the parsed id, limit and `--json`
 * @param read which of the three verbs
 * @param sink where the answer and failures are written
 * @returns the process exit code
 */
async function answerRead({
  get,
  options,
  read,
  sink,
}: {
  get: KnockGet;
  options: KnockMessageOptions;
  read: KnockMessageRead;
  sink: KnockSink;
}): Promise<number> {
  const { json, limit, messageId } = options;
  if (read === "message-events") {
    return printKnockList({
      json,
      label: { document: "knock message-events", noun: "event(s)" },
      limit,
      list: await listKnockMessageEvents({ get, limit, messageId }),
      render: (event) => [`${event.insertedAt}  ${event.type}  ${event.id}`],
      sink,
    });
  }
  if (read === "delivery-logs") {
    return printKnockList({
      json,
      label: { document: "knock delivery-logs", noun: "delivery log(s)" },
      limit,
      list: await listKnockDeliveryLogs({ get, limit, messageId }),
      render: (log) => [
        `${log.insertedAt}  ${log.serviceName}  ${log.responseStatus === null ? "no response status" : `answered ${String(log.responseStatus)}`}  ${log.id}`,
      ],
      sink,
    });
  }
  const message = await readKnockMessage({ get, messageId });
  if (message.isErr()) {
    return exitForKnockError({ error: message.error, sink });
  }
  if (json) {
    sink.out({ line: safeJsonStringify({ label: "knock message", value: message.value }) });
    return EXIT_OK;
  }
  renderKnockMessage({ view: message.value }).forEach((line) => {
    sink.out({ line });
  });
  return EXIT_OK;
}

/**
 * Run the `knock message` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnockMessage(argv: readonly string[]): Promise<number> {
  return runKnockMessageWith({ argv, open: openKnockSession, read: "message", sink: logger });
}

/**
 * Run the `knock message-events` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnockMessageEvents(argv: readonly string[]): Promise<number> {
  return runKnockMessageWith({ argv, open: openKnockSession, read: "message-events", sink: logger });
}

/**
 * Run the `knock delivery-logs` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnockDeliveryLogs(argv: readonly string[]): Promise<number> {
  return runKnockMessageWith({ argv, open: openKnockSession, read: "delivery-logs", sink: logger });
}

export const knockMessageCommand = defineCommand({ run: runKnockMessage });

export const knockMessageEventsCommand = defineCommand({ run: runKnockMessageEvents });

export const knockDeliveryLogsCommand = defineCommand({ run: runKnockDeliveryLogs });
