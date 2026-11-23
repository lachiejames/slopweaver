/**
 * `slopweaver handover alignment-board` — the board's placement fields, for the console's Alignment count.
 *
 * A caller-only read of `$SLOPWEAVER_HOME/alignment-board.json` (`../../../handover/alignmentBoardProjection.ts`),
 * never a replacement for `handover list`: it carries no summary, question, reason or card field, only what places
 * an autonomy act.
 *
 * - The file reads whole: print it with `servedFrom: "cache"` — a cache the console marks stale until its own full
 *   board answers.
 * - It is missing, unreadable or invalid: compose the board exactly as `handover list` does (`./boardComposition.ts`,
 *   default deadline, no `command:` probes), write it, and print it with `servedFrom: "live"`. A composition that
 *   is not whole — a doc or journal that would not read, a probe left unresolved — is not printed at all.
 * - The scan itself fails, or the rebuild is not whole: exit non-zero, naming both the cache problem and the
 *   rebuild's. Never an empty or partial document.
 *
 * A normal finite process: no model, no browser, no background refresh.
 */

import {
  type AlignmentBoardProjection,
  type AlignmentBoardServedFrom,
  renderAlignmentBoardDocument,
} from "../../../handover/alignmentBoardProjection.js";
import { readAlignmentBoardProjection } from "../../../handover/alignmentBoardProjectionStore.js";
import { EMPTY_TAG_FILTER } from "../../../handover/tagFilter.js";
import { logger } from "../../../lib/logger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { refreshAlignmentBoard } from "./alignmentBoardRefresh.js";
import { composedBoard, DEFAULT_DEADLINE_SECONDS, scannedBoard } from "./boardComposition.js";
import { boolFlag, flagNamesOf, stringFlag, VERB_ARG_OFFSET } from "./commandSupport.js";
import { deadlineIn } from "./probeSweep.js";

/** The name every progress line and warning this verb writes to stderr carries. */
const VERB = "handover alignment-board";

/** The flags `handover alignment-board` accepts, names without the leading `--`. */
const ALIGNMENT_BOARD_FLAGS: FlagSpec = { boolean: ["json"], string: ["home"] };

/** `--`-prefixed, so the help-truth ratchet can compare the usage string against the parser both ways. */
export const HANDOVER_ALIGNMENT_BOARD_FLAG_NAMES: readonly string[] = flagNamesOf({ spec: ALIGNMENT_BOARD_FLAGS });

const ALIGNMENT_BOARD_USAGE =
  "usage: slopweaver handover alignment-board [--home <dir>] [--json]\n" +
  "\n" +
  "Every board row's placement fields — section, run, workspace, tags, pull-request links, action — from\n" +
  "$SLOPWEAVER_HOME/alignment-board.json, the projection a whole default `handover list` refreshes. When that\n" +
  "file is missing or will not read, the board is composed now, the file rewritten, and the rows served live —\n" +
  "or, when a doc or journal will not read, nothing is printed and the verb exits non-zero.\n" +
  "It is the console's Alignment count's board read, never a replacement for `handover list`.\n" +
  "\n" +
  '--json  the projection as one document, with servedFrom "cache" or "live" and the builtAtIso its rows were\n' +
  "        composed at.";

/**
 * Parse `handover alignment-board` flags. Exported so the help-truth ratchet probes the real parser.
 *
 * @param rest the verb's argument tail
 * @returns the parsed flags, or the errors
 */
export function parseHandoverAlignmentBoardArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: ALIGNMENT_BOARD_FLAGS });
}

/**
 * Compose the board now, because the projection would not read.
 *
 * @param home the state home whose board and journals are read
 * @param cacheProblem why the file did not serve, named again if the rebuild fails too
 * @returns the composed projection, or `undefined` once both failures are logged
 */
function rebuiltProjection({
  home,
  cacheProblem,
}: {
  home: string;
  cacheProblem: string;
}): AlignmentBoardProjection | undefined {
  logger.info({ msg: `${VERB}: ${cacheProblem}; composing the board…` });
  const handoverDir = stateHomePaths({ home }).handovers;
  const scanStartedIso = new Date().toISOString();
  const scanned = scannedBoard({ handoverDir, home, verb: VERB });
  if (scanned.kind === "failed") {
    logger.error({ msg: `${VERB}: ${cacheProblem}, and the board would not scan to rebuild it: ${scanned.why}` });
    return undefined;
  }
  const composition = {
    ...scanned.board,
    base: undefined,
    deadline: deadlineIn({ seconds: DEFAULT_DEADLINE_SECONDS }),
    filter: EMPTY_TAG_FILTER,
    handoverDir,
    home,
    runCommands: false,
    verb: VERB,
  };
  const { models, sweep } = composedBoard(composition);
  const refreshed = refreshAlignmentBoard({ ...composition, models, scanStartedIso, sweep });
  // A rebuild missing a doc it could not read is not the board, so serving it "live" would let the console print a
  // measured count, a zero among them, off rows that are not all there. Failing leaves
  // the count not measured until the full board answers.
  if (refreshed.refused !== undefined) {
    logger.error({ msg: `${VERB}: ${cacheProblem}, and the rebuild is not the whole board: ${refreshed.refused}` });
    return undefined;
  }
  if (refreshed.notWritten !== undefined) {
    logger.warn({ msg: `${VERB}: served live and not cached, because ${refreshed.notWritten}` });
  }
  return refreshed.projection;
}

/**
 * Print the projection.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runHandoverAlignmentBoard(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: ALIGNMENT_BOARD_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverAlignmentBoardArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: ALIGNMENT_BOARD_USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named: stringFlag({ name: "home", parsed: parsed.value }) });
  const cached = readAlignmentBoardProjection({ path: stateHomePaths({ home }).alignmentBoardJson });
  let projection: AlignmentBoardProjection;
  let servedFrom: AlignmentBoardServedFrom;
  if (cached.isOk()) {
    projection = cached.value;
    servedFrom = "cache";
  } else {
    const rebuilt = rebuiltProjection({ cacheProblem: cached.error.message, home });
    if (rebuilt === undefined) {
      return EXIT_ERROR;
    }
    projection = rebuilt;
    servedFrom = "live";
  }
  if (boolFlag({ name: "json", parsed: parsed.value })) {
    logger.out({ line: renderAlignmentBoardDocument({ projection, servedFrom }) });
    return EXIT_OK;
  }
  logger.out({
    line: `${String(projection.rows.length)} board row(s), composed ${projection.builtAtIso}, served from ${servedFrom}`,
  });
  return EXIT_OK;
}

export const handoverAlignmentBoardCommand = defineCommand({ run: runHandoverAlignmentBoard });
