/**
 * `slopweaver talk log` — the relay receipts, and the one surface that says what a Talk conversation left
 * behind on this machine.
 *
 * It never claims the supervisor acted on anything. A receipt names the board row a relay created and what
 * became of the line typed into the supervisor's chat. A `--turn --json` read adds what the chair itself
 * received — the relay's line in one of its turns, or its words read through `talk unread` — because the
 * delivery grade alone called relays the chair held "board-only" (`./logDocument.ts`).
 */
import { logger } from "../../../lib/logger.js";
import { readChairReceipt } from "../../../talk/chairReceiptRead.js";
import { readRelayTurns, readTurn, type TurnRecord } from "../../../talk/relayStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { talkHomeOf } from "./args.js";
import { parseLogArgs } from "./logArgs.js";
import { type TalkLogDocument, talkLogListDocument, talkLogTurnDocument } from "./logDocument.js";
import { deliveryHead } from "./relayReport.js";
import { TALK_LOG_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "log", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Run the `talk log` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkLog(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_LOG_USAGE });
    return EXIT_OK;
  }
  const parsed = parseLogArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_LOG_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = talkHomeOf({ home: args.home });
  let keep: { readonly limit: number } | { readonly aboutPrefix: string } = { limit: args.limit };
  if (args.aboutPrefix !== undefined) {
    keep = { aboutPrefix: args.aboutPrefix };
  }
  const receipts =
    args.turn === undefined
      ? readRelayTurns({ home, keep })
      : readTurn({ home, turnId: args.turn }).map((row) => [row]);
  if (receipts.isErr()) {
    logger.error({ msg: `talk log: ${receipts.error.message}` });
    return EXIT_ERROR;
  }
  const rows = receipts.value;
  if (args.json) {
    logger.out({ line: JSON.stringify(jsonDocument({ home, rows, turnRead: args.turn !== undefined })) });
    return EXIT_OK;
  }
  if (rows.length === 0) {
    logger.out({ line: "talk log: nothing has been relayed from the console on this install" });
    return EXIT_OK;
  }
  rows.forEach((row) => {
    logger.out({ line: `${String(row.registeredAtIso)}  ${row.slug}` });
    if (row.typed) {
      logger.out({ line: `  typed on the console: ${row.heard.replaceAll("\n", " / ")}` });
    } else {
      logger.out({ line: `  ${row.words}` });
    }
    if (row.delivery !== null) {
      logger.out({ line: `  supervisor chat: ${deliveryHead({ delivery: row.delivery })} — ${row.delivery.detail}` });
    }
  });
  logger.out({
    line: `-- ${String(rows.length)} relay(ed) row(s) on the board; this does not mean the supervisor saw them`,
  });
  return EXIT_OK;
}

/**
 * The document `--json` prints: a turn read reads the chair's receipt for it, a listing reads none.
 */
function jsonDocument({
  home,
  rows,
  turnRead,
}: {
  home: string;
  rows: readonly TurnRecord[];
  turnRead: boolean;
}): TalkLogDocument {
  const [row] = rows;
  if (!turnRead || row === undefined) {
    return talkLogListDocument({ home, rows });
  }
  const receipt = readChairReceipt({ home, stagedAtIso: row.stagedAtIso, turnId: row.turnId });
  return talkLogTurnDocument({ home, receipt, row });
}

export const talkLogCommand = defineCommand({ run: runTalkLog });
