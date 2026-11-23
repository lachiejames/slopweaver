/**
 * `slopweaver session-start lock-in` — record ONE thing the owner said while walking the list.
 *
 * The walk itself is a conversation in a visible session: state a row in a sentence, propose one concrete
 * action, take one word back. This verb is the only write in it, and it exists so the word the owner gave is a fact
 * on disk rather than something a session remembers until it is compacted away.
 *
 * **It writes one append and nothing else.** No Linear transition, no Slack post, no GitHub call. Every
 * action a resolution implies is a separate verb the owner chooses, taken through the existing door with its
 * existing gates — the same rail `session-start` itself keeps.
 */

import { slopweaverHome } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { recordLockIn } from "../../../sessionStart/lockIn.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { stringFlagOr } from "../../parseFlags.js";
import { sessionStartErrorLines } from "./errors.js";
import { LOCK_IN_VERB_NAMES, lockInOptions, parseLockInArgs } from "./lockInCore.js";
import { LOCK_IN_USAGE } from "./lockInUsage.js";

/**
 * Run the verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runSessionStartLockIn(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: LOCK_IN_VERB_NAMES });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: LOCK_IN_USAGE });
    return EXIT_OK;
  }
  const parsed = parseLockInArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: LOCK_IN_USAGE });
    return EXIT_USAGE;
  }
  // `--now` pins the instant a lock-in is judged at; not given, it is the moment the word is recorded.
  const nowIso = stringFlagOr({ fallback: new Date().toISOString(), name: "now", parsed: parsed.value });
  const options = lockInOptions({ nowIso, parsed: parsed.value });
  if (options.isErr()) {
    sessionStartErrorLines({ error: options.error }).forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: LOCK_IN_USAGE });
    return EXIT_USAGE;
  }

  const { row, home, json } = options.value;
  const written = recordLockIn({ row, ...(home === undefined ? { home: slopweaverHome() } : { home }) });
  if (written.isErr()) {
    written.error.forEach((error) => {
      logger.error({ msg: `session-start lock-in: ${error}` });
    });
    return EXIT_ERROR;
  }

  if (json) {
    logger.out({ line: JSON.stringify({ path: written.value, row }, null, 2) });
    return EXIT_OK;
  }
  logger.info({ msg: `recorded ${row.verb} on ${row.identity} as ${row.outcome}` });
  logger.info({ msg: `it governs that item until it moves past ${row.againstWhenIso}` });
  logger.info({ msg: written.value });
  return EXIT_OK;
}

/** The registered verb. */
export const sessionStartLockInCommand = defineCommand({ run: runSessionStartLockIn });
