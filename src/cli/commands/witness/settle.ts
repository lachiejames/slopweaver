/**
 * `slopweaver witness settle` — the one terminal a witness gets, then the close of its worker's workspace.
 *
 * Two callers. The LOOP settles a line it judged not worth checking by coordinates, `--as nothing-checkable`,
 * with no worker and zero Slack calls. A WORKER settles itself by id — `posted` with the ts its witness form
 * landed at, or `nothing-material`/`failed` with a `--why`.
 *
 * The terminal is appended and this verb's result is PRINTED before the workspace is closed: a worker settles
 * from inside the very workspace the close ends, so anything printed after the close would never be seen. A
 * close that fails is reported, and exits non-zero, with the terminal already durable.
 */
import { logger } from "#lib/logger.js";
import { closeSettledWitness, recordWitnessSettlement } from "../../../live/witness/settle.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseWitnessSettleArgs, VERB_ARG_OFFSET } from "./args.js";
import { productionWitnessJournalDeps } from "./deps.js";
import { WITNESS_SETTLE_USAGE } from "./usage.js";

/**
 * Run `witness settle`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runWitnessSettle(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: WITNESS_SETTLE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseWitnessSettleArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: WITNESS_SETTLE_USAGE });
    return EXIT_USAGE;
  }
  const { home, json, outcome, postedTs, selector, why } = parsed.value;
  const deps = productionWitnessJournalDeps({ home });
  const recorded = recordWitnessSettlement({ deps, request: { outcome, postedTs, selector, why } });
  if (recorded.isErr()) {
    logger.error({ msg: `witness settle: ${recorded.error.message}` });
    return EXIT_ERROR;
  }
  const { dispatched, event } = recorded.value;
  if (json) {
    logger.out({ line: JSON.stringify({ closing: dispatched?.workspaceRef, event }) });
  } else {
    const closing = dispatched === undefined ? "" : ` — closing ${dispatched.workspaceRef}`;
    logger.out({ line: `witness ${event.witnessId} settled ${event.outcome}${closing}` });
  }
  const closed = await closeSettledWitness({ deps, dispatched });
  if (closed.isErr()) {
    logger.error({ msg: `witness settle: ${closed.error.message}` });
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

export const witnessSettleCommand = defineCommand({ run: runWitnessSettle });
