/**
 * `slopweaver knock messages` and `slopweaver knock user-messages --user-id <id>` — which notifications Knock
 * sent, environment-wide or to one user, and what became of each.
 *
 * One module for both because they are one read over two routes: the same filters, the same response, the same
 * view. The user route is where an investigation that starts from one user begins, since Knock's environment list
 * has no recipient filter. The user id is sent and never printed; neither is any recipient, body or payload.
 */
import { logger } from "../../../lib/logger.js";
import { renderKnockMessage } from "../../../live/knock/projection.js";
import { listKnockMessages, listKnockUserMessages } from "../../../live/knock/reads.js";
import { openKnockSession } from "../../../live/knock/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parseKnockMessagesOptions } from "./core.js";
import {
  askedForHelp,
  type KnockSessionOpener,
  type KnockSink,
  printKnockList,
  printRefusal,
  sessionOrExit,
} from "./shell.js";
import { KNOCK_MESSAGES_USAGE, KNOCK_USER_MESSAGES_USAGE } from "./usage.js";

/**
 * Run `knock messages` (or `knock user-messages` when `withUser`) over injected seams.
 *
 * @param argv the full process argv
 * @param withUser whether this is the user-scoped verb
 * @param open how the session is opened
 * @param sink where the answer and refusals are written
 * @returns the process exit code
 */
export async function runKnockMessagesWith({
  argv,
  withUser,
  open,
  sink,
}: {
  argv: readonly string[];
  withUser: boolean;
  open: KnockSessionOpener;
  sink: KnockSink;
}): Promise<number> {
  const usage = withUser ? KNOCK_USER_MESSAGES_USAGE : KNOCK_MESSAGES_USAGE;
  const rest = verbTail({ argv, verbs: [withUser ? "user-messages" : "messages"] });
  if (askedForHelp({ rest, sink, usage })) {
    return EXIT_OK;
  }
  const parsed = parseKnockMessagesOptions({ rest, withUser });
  if (parsed.isErr()) {
    printRefusal({ reasons: parsed.error, sink, usage });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const opened = sessionOrExit({ home: options.home, open, sink });
  if ("exit" in opened) {
    return opened.exit;
  }
  const get = opened.session.get;
  const list =
    options.userId === null
      ? await listKnockMessages({ filter: options.filter, get, limit: options.limit })
      : await listKnockUserMessages({ filter: options.filter, get, limit: options.limit, userId: options.userId });
  return printKnockList({
    json: options.json,
    label: { document: withUser ? "knock user-messages" : "knock messages", noun: "message(s)" },
    limit: options.limit,
    list,
    render: (view) => renderKnockMessage({ view }),
    sink,
  });
}

/**
 * Run the `knock messages` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnockMessages(argv: readonly string[]): Promise<number> {
  return runKnockMessagesWith({ argv, open: openKnockSession, sink: logger, withUser: false });
}

/**
 * Run the `knock user-messages` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runKnockUserMessages(argv: readonly string[]): Promise<number> {
  return runKnockMessagesWith({ argv, open: openKnockSession, sink: logger, withUser: true });
}

export const knockMessagesCommand = defineCommand({ run: runKnockMessages });

export const knockUserMessagesCommand = defineCommand({ run: runKnockUserMessages });
