/**
 * `slopweaver witness revise` — a later message showed the bot's own POSTED witness reply was wrong: strike the claim
 * in that reply, put a bold Correction line under it, and journal `revised`, once
 * (`../../../live/witness/revise.ts`). Never a second reply, never a delete.
 *
 * Exit codes: 0 revised (or a dry run that would go through); 2 usage, or the correction runner refusing the words;
 * 3 the witness cannot be revised (unknown, not posted, already revised) or the runner finding a different correction
 * already shown; 4 the witness lock is held;
 * 1 a fault (an unreadable journal, a Slack failure, or a correction that landed but could not be journalled — run
 * the identical command again). A correction runner's own non-zero exit is passed through as it was.
 */
import { logger } from "#lib/logger.js";
import { reviseWitness, type WitnessReviseDeps } from "../../../live/witness/revise.js";
import type { WitnessReviseError } from "../../../live/witness/reviseErrors.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { parseWitnessReviseArgs, VERB_ARG_OFFSET } from "./args.js";
import { productionWitnessReviseDeps } from "./deps.js";
import { WITNESS_REVISE_USAGE } from "./usage.js";

/**
 * The exit code a revise refusal or failure ends in.
 *
 * @param error the refusal
 * @returns 4 for a held lock, 3 for a witness that cannot be revised, the runner's own code for a correction that did
 *   not land, else 1
 */
export function witnessReviseExitCode({ error }: { error: WitnessReviseError }): number {
  switch (error.code) {
    case "REVISE_LOCKED":
      return EXIT_DEFERRED;
    case "WITNESS_UNKNOWN":
    case "ALREADY_REVISED":
    case "WITNESS_NOT_POSTED":
    case "POSTED_TS_MISSING":
      return EXIT_EXPECTED_EMPTY;
    case "CORRECTION_NOT_APPLIED":
      return error.exitCode;
    case "JOURNAL":
    case "REVISION_RECORD_FAILED":
      return EXIT_ERROR;
    default: {
      const unhandled: never = error;
      return unhandled;
    }
  }
}

/**
 * Run `witness revise` over injected seams.
 *
 * @param argv the full process argv
 * @param deps the seams, built for the parsed home
 * @returns the process exit code
 */
export async function runWitnessReviseWith({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: (args: { home: string }) => WitnessReviseDeps;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: WITNESS_REVISE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseWitnessReviseArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: WITNESS_REVISE_USAGE });
    return EXIT_USAGE;
  }
  const { request } = parsed.value;
  const home = resolveHome({ named: parsed.value.home });
  const revised = await reviseWitness({ deps: deps({ home }), request });
  if (revised.isErr()) {
    logger.error({ msg: `witness revise: ${revised.error.code} — ${revised.error.message}` });
    return witnessReviseExitCode({ error: revised.error });
  }
  const { dryRun, event } = revised.value;
  const where = `${event.channel}/${event.postedTs}`;
  if (dryRun) {
    logger.out({ line: `witness revise: dry run — ${where} would be struck and corrected; nothing journalled` });
    return EXIT_OK;
  }
  logger.out({
    line: `witness revise: ${event.witnessId} revised — ${where} struck and corrected, because ${event.because}`,
  });
  return EXIT_OK;
}

/**
 * Run `witness revise`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runWitnessRevise(argv: readonly string[]): Promise<number> {
  return runWitnessReviseWith({ argv, deps: productionWitnessReviseDeps });
}

export const witnessReviseCommand = defineCommand({ run: runWitnessRevise });
