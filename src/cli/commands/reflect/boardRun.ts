/**
 * `slopweaver reflect board [--now <iso>] [--json]` — the standing grooming leg: report the orchestration
 * board's own hygiene, the way `reflect brief` reports friction elsewhere.
 *
 * The thin shell. Every decision is in `src/reflect/board.ts`; this resolves `now`, builds the real
 * filesystem and mtime seams, and prints. It writes nothing — see that module's header for why report-only
 * is the deliberate autonomy ceiling here, matching `reflect brief`'s own T0 start.
 */
import { statSync } from "node:fs";

import { logger } from "../../../lib/logger.js";
import { readBoardHygiene, renderBoardHygieneLines } from "../../../reflect/board.js";
import { createFsReader } from "../../../reflect/substrate.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parseReflectBoardOptions, type ReflectBoardOptions } from "./boardCore.js";
import { REFLECT_BOARD_USAGE } from "./usage.js";

/** A doc's last-modified instant, or `undefined` when the file could not be stat'd. */
function mtimeIso({ path }: { path: string }): string | undefined {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return undefined;
  }
}

/** The instant every doc is aged against: `--now` when pinned, else the real clock. */
function boardNowIso({ options }: { options: ReflectBoardOptions }): string {
  const pinned = options.nowIso;
  if (pinned === undefined) {
    return new Date().toISOString();
  }
  return pinned;
}

/**
 * Run the `reflect board` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export function runReflectBoard(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: ["board"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: REFLECT_BOARD_USAGE });
    return EXIT_OK;
  }
  const parsed = parseReflectBoardOptions({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: REFLECT_BOARD_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  if (options.nowIso !== undefined && Number.isNaN(Date.parse(options.nowIso))) {
    logger.error({ msg: `--now must be a parseable instant, got \`${options.nowIso}\`` });
    return EXIT_USAGE;
  }
  const paths = stateHomePaths();
  const report = readBoardHygiene({
    handoverDir: paths.handovers,
    mtimeIso,
    nowIso: boardNowIso({ options }),
    reader: createFsReader(),
    runsDir: paths.runs,
  });

  if (options.json) {
    logger.out({ line: JSON.stringify(report, null, 2) });
  } else {
    renderBoardHygieneLines({ report }).forEach((line) => {
      logger.out({ line });
    });
  }
  return EXIT_OK;
}

export const reflectBoardCommand = defineCommand({ run: runReflectBoard });
