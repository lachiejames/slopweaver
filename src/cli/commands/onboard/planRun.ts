/** `slopweaver onboard plan` — print the executable per-source refresh plan. */
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { onboardErrorLines } from "./errors.js";
import { onboardPlanOptions, parseOnboardPlanArgs, renderOnboardPlan, renderOnboardPlanJson } from "./planCore.js";
import { ONBOARD_PLAN_USAGE } from "./usage.js";

const VERB_ARG_OFFSET = 4;

/**
 * Run the plan verb over the full process argv.
 *
 * @param argv the full process argument vector
 * @returns the process exit code
 */
export function runOnboardPlan(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: ONBOARD_PLAN_USAGE });
    return EXIT_OK;
  }
  const parsed = parseOnboardPlanArgs({ rest });
  if (parsed.isErr()) {
    for (const error of [...parsed.error, ONBOARD_PLAN_USAGE]) {
      logger.error({ msg: error });
    }
    return EXIT_USAGE;
  }
  const options = onboardPlanOptions({ parsed: parsed.value });
  if (options.isErr()) {
    for (const error of [...onboardErrorLines({ error: options.error }), ONBOARD_PLAN_USAGE]) {
      logger.error({ msg: error });
    }
    return EXIT_USAGE;
  }
  const lines = options.value.json
    ? [renderOnboardPlanJson({ options: options.value })]
    : renderOnboardPlan({ options: options.value });
  for (const line of lines) {
    logger.out({ line });
  }
  return EXIT_OK;
}

export const onboardPlanCommand = defineCommand({ run: runOnboardPlan });
