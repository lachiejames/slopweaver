/**
 * `slopweaver reflect telemetry [--from 24h] [--to now] [--limit N] [--json]` — which tool calls failed,
 * read from Claude Code's own OTLP export rather than guessed from a transcript.
 *
 * The reflection loop's telemetry leg (phase 2 of the self-improvement loop). All of the reasoning about
 * WHY the logs track and not the span tree, and what this deliberately does not read, is in
 * `src/reflect/telemetry.ts`'s header; this file is the thin shell that resolves credentials, resolves the
 * window once against a single `now`, reads the retention horizon and prints.
 *
 * ## The exit-code contract, which is the point of the verb
 *
 * The failure it exists to make impossible is **an unreadable window reported as a quiet one**. So the
 * two are separate codes, and a caller never has to parse prose to tell them apart:
 *
 * | situation | code | why |
 * | --- | --- | --- |
 * | a bad flag | `2` | refused before anything is read |
 * | credentials unset or malformed | `3` | a prerequisite is absent |
 * | the window aged out, or an empty result came back over an unreadable horizon | `3` | no measurement was possible over it |
 * | an empty result while matched events went unread (the wire shape moved under the reader) | `3` | the zero is the reader's, not the window's |
 * | the window was readable — including when zero calls failed and nothing went unread | `0` | a real measurement, good news included |
 * | Datadog was never reached or answered unreadably | `1` | a genuine fault |
 *
 * A live window with zero failures is a `0`, unlike `datadog probe`'s empty result: there, zero means the
 * query found nothing to describe; here it means nothing failed in that window, which is an answer.
 */
import { type DdConsoleHost } from "../../../datadog/config.js";
import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import { ddConsoleLink } from "../../../datadog/ddLink.js";
import { datadogDomainErrorLines } from "../../../datadog/domainErrors.js";
import { createRawRequester, type RawRequester } from "../../../datadog/rawRequest.js";
import { loadDatadogConfig } from "../../../datadog/source.js";
import { type AbsoluteWindow, resolveWindow } from "../../../datadog/window.js";
import { logger } from "../../../lib/logger.js";
import {
  type RetentionHorizon,
  readToolExecutionErrors,
  type ToolExecutionErrorReading,
} from "../../../reflect/telemetry.js";
import { createTelemetryPageFetcher, readRetentionHorizon } from "../../../reflect/telemetrySource.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { isMeasurement, parseReflectTelemetryOptions, REFLECT_TELEMETRY_DEFAULT_LIMIT, renderReading } from "./core.js";
import { REFLECT_TELEMETRY_USAGE } from "./usage.js";

/**
 * Read the retention horizon, treating a failure as an unknown horizon rather than as a dead run.
 *
 * A window's errors are still worth reporting when the horizon cannot be read — what is lost is only the
 * right to say whether an EMPTY result meant anything, and `coverage: "unknown"` says exactly that.
 *
 * @param requester the shared Datadog raw path
 * @returns the horizon, or `null` once every reason it could not be read has been printed
 */
async function resolveRetention({ requester }: { requester: RawRequester }): Promise<RetentionHorizon | null> {
  const horizon = await readRetentionHorizon({ requester });
  if (horizon.isOk()) {
    return horizon.value;
  }
  horizon.error.forEach((error) => {
    logger.error({ msg: error });
  });
  return null;
}

/**
 * Print a reading, as JSON or as lines, with the console link that reproduces it.
 *
 * @param consoleHost the site's console host, from the resolved config
 * @param json whether `--json` was passed
 * @param reading the reading to print
 * @param retention the horizon it was classified against, carried into JSON so a reader can re-derive coverage
 * @param window the absolute window, so the link and the claim describe the same instant
 * @returns nothing
 */
function emitReading({
  consoleHost,
  json,
  reading,
  retention,
  window,
}: {
  consoleHost: DdConsoleHost;
  json: boolean;
  reading: ToolExecutionErrorReading;
  retention: RetentionHorizon | null;
  window: AbsoluteWindow;
}): void {
  const link = ddConsoleLink({ consoleHost, domain: "logs", query: reading.query, window });
  if (json) {
    logger.out({ line: JSON.stringify({ ...reading, link, retention }, null, 2) });
    return;
  }
  renderReading({ link, reading }).forEach((line) => {
    logger.out({ line });
  });
}

/**
 * Run the `reflect telemetry` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runReflectTelemetry(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["telemetry"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: REFLECT_TELEMETRY_USAGE });
    return EXIT_OK;
  }
  const parsed = parseReflectTelemetryOptions({ defaultLimit: REFLECT_TELEMETRY_DEFAULT_LIMIT, rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: REFLECT_TELEMETRY_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;

  const config = loadDatadogConfig({});
  if (config.isErr()) {
    datadogConfigErrorLines({ error: config.error }).forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_EXPECTED_EMPTY;
  }

  const nowMs = Date.now();
  const window = resolveWindow({ from: options.from, nowMs, to: options.to });
  if (window.isErr()) {
    datadogDomainErrorLines({ error: window.error }).forEach((error) => {
      logger.error({ msg: error });
    });
    return EXIT_USAGE;
  }

  const requester = createRawRequester({ config: config.value, logger });
  const retention = await resolveRetention({ requester });

  const reading = await readToolExecutionErrors({
    cap: options.limit,
    fetchPage: createTelemetryPageFetcher({ requester }),
    fromMs: window.value.fromMs,
    nowMs,
    retention,
    toMs: window.value.toMs,
  });
  if (reading.isErr()) {
    logger.error({ msg: reading.error.message });
    return reading.error.code === "CREDENTIALS_UNSET" ? EXIT_EXPECTED_EMPTY : EXIT_ERROR;
  }

  emitReading({
    consoleHost: config.value.consoleHost,
    json: options.json,
    reading: reading.value,
    retention,
    window: window.value,
  });
  // A window nothing could be read over is not a quiet window. See the exit-code table in the header.
  return isMeasurement({ reading: reading.value }) ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

export const reflectTelemetryCommand = defineCommand({ run: runReflectTelemetry });
