/**
 * `slopweaver witness dispatch` — boot one VISIBLE worker to check one witnessed claim.
 *
 * The loop runs this on a listener `witness` line it judged worth checking; the other ending is
 * `witness settle --as nothing-checkable`. The worker it boots is handed exactly
 * `slopweaver witness resume <id>` and nothing else. Never a headless model (rule 2): the order, and why each
 * refusal sits where it does, is `../../../live/witness/session.ts`'s header.
 */
import { logger } from "#lib/logger.js";
import { dispatchWitness } from "../../../live/witness/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseWitnessDispatchArgs, VERB_ARG_OFFSET } from "./args.js";
import { productionWitnessDispatchDeps } from "./deps.js";
import { WITNESS_DISPATCH_USAGE } from "./usage.js";

/**
 * Run `witness dispatch`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runWitnessDispatch(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: WITNESS_DISPATCH_USAGE });
    return EXIT_OK;
  }
  const parsed = parseWitnessDispatchArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: WITNESS_DISPATCH_USAGE });
    return EXIT_USAGE;
  }
  const { home, json, key, model, text } = parsed.value;
  const outcome = await dispatchWitness({
    deps: productionWitnessDispatchDeps({ home }),
    env: process.env,
    request: { key, model, text },
  });
  if (outcome.isErr()) {
    logger.error({ msg: `witness dispatch: ${outcome.error.message}` });
    return EXIT_ERROR;
  }
  const { delivery, record, witnessId } = outcome.value;
  if (delivery.kind === "unwitnessed") {
    logger.error({
      msg:
        `witness dispatch: nothing witnessed the pickup line arriving in ${record.workspaceRef}; the dispatch ` +
        "stays live — do not resend the line by hand, a second one would be a duplicate",
    });
  }
  if (json) {
    logger.out({ line: JSON.stringify({ delivery: delivery.kind, record, witnessId }) });
    return EXIT_OK;
  }
  logger.out({ line: `witness ${witnessId} dispatched to ${record.workspaceRef} (${record.model}, ${record.host})` });
  return EXIT_OK;
}

export const witnessDispatchCommand = defineCommand({ run: runWitnessDispatch });
