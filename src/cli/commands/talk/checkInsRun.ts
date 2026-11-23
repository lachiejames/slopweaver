/**
 * `slopweaver talk check-ins` — their check-ins as the console voice reads them, a page at a time, fresh off the
 * autonomy ledger.
 *
 * The context pack carries the first page; this is what the voice reads past it, and what it re-reads after a
 * ruling so it never reads them a card their word already settled. It does not compose the board — that is the
 * fifteen-second read the pack exists to keep off a call (`./packRun.ts`) — so an entry names its row but not
 * the row's tags. The entry shape and why it is theirs is `src/talk/packCheckIns.ts`.
 */
import { type AutonomyLedgerPort, autonomyLedgerPort } from "../../../autonomy/port.js";
import { foldAutonomy } from "../../../autonomy/query.js";
import { logger } from "../../../lib/logger.js";
import { CHECK_IN_PAGE_BYTES, checkInLines, packCheckInsOf } from "../../../talk/packCheckIns.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseCheckInsArgs, talkHomeOf } from "./args.js";
import { TALK_CHECK_INS_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "check-ins", ...]`. */
const VERB_ARG_OFFSET = 4;

/**
 * Run the `talk check-ins` verb against the production autonomy ledger.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTalkCheckIns(argv: readonly string[]): Promise<number> {
  return runTalkCheckInsOver({ argv, ledger: autonomyLedgerPort() });
}

/**
 * Run the `talk check-ins` verb over a given autonomy ledger — the seam a unit test hands its in-memory port.
 *
 * @param argv the full process argv
 * @param ledger the autonomy ledger the check-ins fold from
 * @returns the process exit code
 */
export async function runTalkCheckInsOver({
  argv,
  ledger,
}: {
  argv: readonly string[];
  ledger: AutonomyLedgerPort;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_CHECK_INS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCheckInsArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_CHECK_INS_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = talkHomeOf({ home: args.home });
  // Whole, never tolerant: the port refuses the read on one unreadable row, because a check-in missing for that
  // reason would read as one they have no card for.
  const records = await ledger.readRecords({ home });
  const actions = records.andThen((held) => foldAutonomy({ records: held }));
  if (actions.isErr()) {
    logger.error({ msg: `talk check-ins: ${actions.error.message}` });
    return EXIT_ERROR;
  }
  const checkIns = packCheckInsOf({ actions: actions.value, tagsOf: () => undefined });
  const lines = checkInLines({ budget: CHECK_IN_PAGE_BYTES, checkIns, skip: args.skip });
  if (args.json) {
    logger.out({
      line: JSON.stringify({
        cards: checkIns.reduce((sum, entry) => sum + entry.cards, 0),
        page: lines.join("\n"),
        rules: checkIns.length,
        skip: args.skip,
      }),
    });
    return EXIT_OK;
  }
  lines.forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

export const talkCheckInsCommand = defineCommand({ run: runTalkCheckIns });
