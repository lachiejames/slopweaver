/**
 * `slopweaver datadog raw --path P [--method GET|POST] [--body JSON] [--json]` — an authenticated,
 * rate-limit-aware GET (or allow-listed read-only POST) against a Datadog endpoint the typed SDK does not
 * cover, e.g. `/api/v1/logs-analytics/list?type=logs`.
 *
 * A thin shell over `datadog/rawTransport.ts`: read-only is enforced by the type (`RawMethod` admits `GET`
 * and `POST` only) and, for a POST, by `READ_ONLY_POST_ROUTES` — a mutating call or an unlisted POST route
 * is refused before anything is sent. The answer is printed as TEXT, never parsed: this verb names no endpoint
 * it could declare a strict boundary for, and calling an accept-anything schema a boundary would be a lie. So
 * `--json` emits `{ "status", "bodyText" }`, the provider's text as one string, and a consumer decodes it.
 *
 * ## The exit-code contract
 *
 * | situation                                              | code |
 * | -------------------------------------------------------- | ---- |
 * | a bad flag (missing `--path`, an unsupported `--method`, malformed `--body`) | `2`  |
 * | credentials unset or malformed                          | `3`  |
 * | the request was refused, never reached Datadog, or answered a non-2xx | `1`  |
 * | Datadog answered a 2xx, whatever its text               | `0`  |
 */
import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import { createRawTransport } from "../../../datadog/rawTransport.js";
import { loadDatadogConfig } from "../../../datadog/source.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { datadogArgsErrorLines } from "./errors.js";
import { datadogRawOutputLines, parseDatadogRawOptions } from "./rawCore.js";

/**
 * Exported so a test can assert this equals the manifest's own copy — the manifest cannot import it
 * directly without eagerly loading this module's Datadog-client dependency for every CLI invocation, not
 * just this verb's.
 */
export const DATADOG_RAW_USAGE = "usage: slopweaver datadog raw --path P [--method GET|POST] [--body JSON] [--json]";

/**
 * Run the `datadog raw` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runDatadogRaw(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["raw"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DATADOG_RAW_USAGE });
    return EXIT_OK;
  }
  const parsed = parseDatadogRawOptions({ rest });
  if (parsed.isErr()) {
    for (const line of datadogArgsErrorLines({ error: parsed.error })) {
      logger.error({ msg: line });
    }
    logger.error({ msg: DATADOG_RAW_USAGE });
    return EXIT_USAGE;
  }
  const { method, path, body, json } = parsed.value;

  const config = loadDatadogConfig({});
  if (config.isErr()) {
    datadogConfigErrorLines({ error: config.error }).forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_EXPECTED_EMPTY;
  }

  const transport = createRawTransport({ config: config.value, logger });
  const response = await transport.requestRawText({ body, method, path });
  if (response.isErr()) {
    response.error.forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_ERROR;
  }

  const { bodyText, status } = response.value;
  for (const line of datadogRawOutputLines({ bodyText, json, method, path, status })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

export const datadogRawCommand = defineCommand({ run: runDatadogRaw });
