/**
 * `slopweaver datadog errors` — list Error Tracking issues over a window, the list the console calls
 * "For Review", with how old each state's issues are since first seen.
 *
 * The read half of the error-tracking fix batch (`skills/automation/reference/error-tracking-batch.md`):
 * `--order count` is the blast-radius pick, `--order newest` the regression-from-a-release pick.
 *
 * ## The exit-code contract
 *
 * | situation                                            | code |
 * | ---------------------------------------------------- | ---- |
 * | a bad flag, or an unparseable window                 | `2`  |
 * | credentials unset, malformed, or rejected by Datadog | `3`  |
 * | Datadog answered, and no issue matched               | `3`  |
 * | Datadog answered with at least one issue             | `0`  |
 * | Datadog was never reached, or answered unreadably    | `1`  |
 */
import { createDatadogClient } from "../../../datadog/client.js";
import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import {
  errorTrackingIssueLink,
  searchErrorTrackingIssues,
  summariseIssuesByState,
} from "../../../datadog/errorTracking.js";
import { verifyCredentials } from "../../../datadog/verifyCredentials.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { type ErrorsReport, parseDatadogErrorsOptions, renderErrorsText } from "./errorsCore.js";
import { resolveDatadogPreflight } from "./shell.js";
import { DATADOG_ERRORS_USAGE } from "./usage.js";

/** Log every reason in a rejection, one line each. */
function reportErrors({ errors }: { errors: readonly string[] }): void {
  errors.forEach((error) => {
    logger.error({ msg: error });
  });
}

/**
 * Run the `datadog errors` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runDatadogErrors(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["errors"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DATADOG_ERRORS_USAGE });
    return EXIT_OK;
  }
  const preflight = resolveDatadogPreflight({
    parseFlags: parseDatadogErrorsOptions,
    rest,
    usage: DATADOG_ERRORS_USAGE,
  });
  if (preflight.isErr()) {
    reportErrors({ errors: preflight.error.errors });
    return preflight.error.code;
  }
  const { flags, config, window } = preflight.value;

  const client = createDatadogClient({ config, logger });
  const verified = await verifyCredentials({ client });
  if (verified.isErr()) {
    reportErrors({ errors: datadogConfigErrorLines({ error: verified.error }) });
    return EXIT_EXPECTED_EMPTY;
  }

  const searched = await searchErrorTrackingIssues({
    client,
    order: flags.order,
    query: flags.query,
    states: flags.states,
    track: flags.track,
    window,
  });
  if (searched.isErr()) {
    reportErrors({ errors: searched.error });
    return EXIT_ERROR;
  }

  const report: ErrorsReport = {
    byState: summariseIssuesByState({ nowMs: window.toMs, rows: searched.value }),
    fromMs: window.fromMs,
    issues: searched.value.map((row) => ({
      ...row,
      link: errorTrackingIssueLink({ consoleHost: config.consoleHost, id: row.id }),
    })),
    nowMs: window.toMs,
    order: flags.order,
    query: flags.query,
    site: config.site,
    states: flags.states,
    toMs: window.toMs,
    track: flags.track,
  };
  logger.out({
    line: flags.json ? JSON.stringify(report, null, 2) : renderErrorsText({ limit: flags.limit, report }),
  });
  return report.issues.length > 0 ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

export const datadogErrorsCommand = defineCommand({ run: runDatadogErrors });
