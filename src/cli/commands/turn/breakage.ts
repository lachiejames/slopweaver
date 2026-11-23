/**
 * `slopweaver turn breakage` — record one loop breakage that only a session's judgement can name.
 *
 * This replaces the `printf >>` the loop skills used to hand an agent. Two things change, and both are the
 * point. Every row now goes through `../../../live/turn/loopBreakage.ts`, the same writer the code-owned
 * classes use, so the ledger has one writer rather than one writer and a shell append. And `--cause` is
 * REQUIRED: `requireCause` refuses a blank one with exit 2 and nothing written, because hand-written rows
 * carried `cause: null` on every one of them. Which classes code writes, so a session never
 * has to, is declared in `../../../live/turn/breakageClasses.ts`.
 *
 * Runs no model, touches no provider, and writes only under the state home.
 */

import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import { BREAKAGE_CLASSES, breakageClassLines } from "../../../live/turn/breakageClasses.js";
import { recordLoopBreakage, requireCause } from "../../../live/turn/loopBreakage.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { type ParsedFlags, parseFlags } from "../../parseFlags.js";
import { TURN_BREAKAGE_FLAG_SPEC, TURN_BREAKAGE_USAGE } from "./breakageUsage.js";
import { str } from "./core.js";

/** Where this verb's own arguments start in `process.argv`: `[node, cli, turn, breakage, …]`, so FOUR. */
const VERB_ARG_OFFSET = 4;

/**
 * Parse the verb's argv tail. Pure — no filesystem, so a bad flag is refused before any effect.
 *
 * @param rest the argv tail after `turn breakage`
 * @returns the parsed flags, or the rejections
 */
export function parseTurnBreakageArgs({ rest }: { rest: readonly string[] }): Result<ParsedFlags> {
  return parseFlags({
    args: rest,
    spec: { boolean: [...TURN_BREAKAGE_FLAG_SPEC.boolean], string: [...TURN_BREAKAGE_FLAG_SPEC.string] },
  });
}

/**
 * Run the verb over its argv tail, with the clock injected so a test stamps the row with a known instant.
 *
 * @param rest the argv tail after `turn breakage`
 * @param now samples the instant the row is stamped with
 * @returns `0` written, already there or the class table printed, `2` a blank field or a bad flag, `1` the
 *   append itself failed
 */
export function runTurnBreakage({ rest, now }: { rest: readonly string[]; now: () => Date }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TURN_BREAKAGE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTurnBreakageArgs({ rest });
  if (parsed.isErr()) {
    for (const error of parsed.error) {
      logger.error({ msg: error });
    }
    logger.error({ msg: TURN_BREAKAGE_USAGE });
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  if (values["classes"] === true) {
    for (const line of breakageClassLines({ classes: BREAKAGE_CLASSES })) {
      logger.out({ line });
    }
    return EXIT_OK;
  }
  return recordFromFlags({ now, values });
}

/** Check the parsed fields and append the row, answering the verb's exit code. */
function recordFromFlags({ values, now }: { values: ParsedFlags["values"]; now: () => Date }): number {
  const checked = requireCause({
    breakage: {
      atIso: now().toISOString(),
      cause: str({ key: "cause", values }),
      didInstead: str({ key: "did-instead", values }),
      error: str({ key: "error", values }),
      thread: str({ key: "thread", values }),
      what: str({ key: "what", values }),
    },
  });
  if (checked.isErr()) {
    logger.error({ msg: `turn breakage: ${checked.error.message}` });
    logger.error({ msg: TURN_BREAKAGE_USAGE });
    return EXIT_USAGE;
  }
  const named = str({ key: "home", values });
  // A blank `--home` would join to a relative `ledgers/` and write into whatever directory this ran in.
  if (named?.trim().length === 0) {
    logger.error({ msg: "turn breakage: --home was given blank — name the state home, or leave the flag off" });
    logger.error({ msg: TURN_BREAKAGE_USAGE });
    return EXIT_USAGE;
  }
  const home = resolveHome({ named });
  const written = recordLoopBreakage({ breakage: checked.value, home });
  if (written.written) {
    logger.out({ line: `turn breakage: recorded ${checked.value.thread} — ${checked.value.what}` });
    return EXIT_OK;
  }
  if (written.kind === "duplicate") {
    logger.out({ line: `turn breakage: ${written.why}` });
    return EXIT_OK;
  }
  logger.error({ msg: `turn breakage: nothing recorded — ${written.why}` });
  return written.kind === "refused" ? EXIT_USAGE : EXIT_ERROR;
}

export const turnBreakageCommand = defineCommand({
  run: (argv) => runTurnBreakage({ now: () => new Date(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
