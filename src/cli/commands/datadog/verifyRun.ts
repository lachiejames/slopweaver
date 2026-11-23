/**
 * `slopweaver datadog verify [--json]` — prove `DD_API_KEY`/`DD_APP_KEY`/`DD_SITE` actually work, without
 * spending a query against a tight rate-limit budget.
 *
 * ## The exit-code contract
 *
 * | situation                                              | code |
 * | -------------------------------------------------------- | ---- |
 * | a bad flag                                              | `2`  |
 * | `DD_SITE`/`DD_API_KEY`/`DD_APP_KEY` unset, malformed, rejected by Datadog, or unreachable | `3`  |
 * | both credentials verified                                | `0`  |
 *
 * A dead network and a rejected key share code `3` rather than splitting into a separate fault code: both
 * mean "there is no usable credential right now", which is exactly what `EXIT_EXPECTED_EMPTY` signals.
 */
import { createDatadogClient } from "../../../datadog/client.js";
import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import { loadDatadogConfig } from "../../../datadog/source.js";
import { verifyCredentials } from "../../../datadog/verifyCredentials.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { parseDatadogJsonOnlyOptions } from "./core.js";

/**
 * Exported so a test can assert this equals the manifest's own copy — the manifest cannot import it
 * directly without eagerly loading this module's Datadog-client dependency for every CLI invocation, not
 * just this verb's.
 */
export const DATADOG_VERIFY_USAGE = "usage: slopweaver datadog verify [--json]";

/**
 * Run the `datadog verify` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runDatadogVerify(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["verify"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DATADOG_VERIFY_USAGE });
    return EXIT_OK;
  }
  const parsed = parseDatadogJsonOnlyOptions({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: DATADOG_VERIFY_USAGE });
    return EXIT_USAGE;
  }
  const { json } = parsed.value;

  const config = loadDatadogConfig({});
  if (config.isErr()) {
    datadogConfigErrorLines({ error: config.error }).forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_EXPECTED_EMPTY;
  }

  const client = createDatadogClient({ config: config.value, logger });
  const verified = await verifyCredentials({ client });
  if (verified.isErr()) {
    datadogConfigErrorLines({ error: verified.error }).forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_EXPECTED_EMPTY;
  }

  if (json) {
    logger.out({ line: JSON.stringify(verified.value, null, 2) });
  } else {
    logger.out({ line: `datadog verify: both DD_API_KEY and DD_APP_KEY are valid for ${verified.value.site}` });
  }
  return EXIT_OK;
}

export const datadogVerifyCommand = defineCommand({ run: runDatadogVerify });
