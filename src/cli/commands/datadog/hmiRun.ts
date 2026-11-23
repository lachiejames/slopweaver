/**
 * `slopweaver datadog hmi --metric NAME[,NAME…] [--enable [--dry-run]] [--home DIR] [--json]` — read, and on
 * `--enable` switch on, Datadog Historical Metrics Ingestion per metric. `historicalIngestion.ts` carries
 * the route and why; this is the shell.
 *
 * Without `--enable` it only reads. With it: read every metric, switch on the ones that are off through the
 * admit door, then READ EVERY ONE BACK — the exit code is the read-back's, never the POST's, because an
 * accepted request that left the setting off is exactly the failure the console toggle hid.
 *
 * ## The exit-code contract
 *
 * | situation                                                                   | code |
 * | --------------------------------------------------------------------------- | ---- |
 * | a bad flag, no `--metric`, or a name that is not a metric name              | `2`  |
 * | credentials unset or malformed, or the door refused the write               | `3`  |
 * | a setting could not be read, Datadog refused an enable, or read-back is off | `1`  |
 * | read (status), planned (`--dry-run`), or enabled and read back on           | `0`  |
 */
import { DEFAULT_GATES } from "../../../admit/door.js";
import { doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import type { DoorRequest } from "../../../admit/types.js";
import { createDatadogClient } from "../../../datadog/client.js";
import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import {
  DatadogHmiErrors,
  enableHmi,
  type HmiApi,
  type HmiState,
  metricsStillOff,
  planHmiEnable,
  readHmiStates,
  sdkHmiApi,
  validateMetricNames,
} from "../../../datadog/historicalIngestion.js";
import { loadDatadogConfig } from "../../../datadog/source.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome, verbTail } from "../../optionParsers.js";
import { datadogArgsErrorLines } from "./errors.js";
import {
  type DatadogHmiOptions,
  HMI_EFFECTIVE_CAVEAT,
  hmiPlanLines,
  hmiStateLines,
  parseDatadogHmiOptions,
} from "./hmiCore.js";

/**
 * Exported so a test can assert this equals the manifest's own copy — the manifest cannot import it
 * directly without eagerly loading this module's Datadog-client dependency for every CLI invocation.
 */
export const DATADOG_HMI_USAGE =
  "usage: slopweaver datadog hmi --metric NAME[,NAME...] [--enable [--dry-run]] [--home DIR] [--json]";

/**
 * The door request one enable makes: `external-write`, because it changes how Datadog ingests these
 * metrics from now on and may add to the organisation's custom-metric bill.
 *
 * @param home the state home whose ledger records this write
 * @param metrics the metrics this run will switch on
 * @returns the request to route through the door
 */
export function hmiDoorRequestFor({ home, metrics }: { home: string; metrics: readonly string[] }): DoorRequest {
  return {
    action: { kind: "verb", noun: "datadog", verb: "hmi" },
    artifact: { metrics: [...metrics] },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}

/**
 * Run the `datadog hmi` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runDatadogHmi(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["hmi"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DATADOG_HMI_USAGE });
    return EXIT_OK;
  }
  const invocation = readInvocation({ rest });
  if (invocation === null) {
    return EXIT_USAGE;
  }
  const { options, metrics } = invocation;

  const config = loadDatadogConfig({ home: resolveHome({ named: options.home }) });
  if (config.isErr()) {
    datadogConfigErrorLines({ error: config.error }).forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_EXPECTED_EMPTY;
  }
  const api = sdkHmiApi({ datadog: createDatadogClient({ config: config.value, logger }) });

  const before = await readHmiStates({ api, metrics });
  if (before.isErr()) {
    logger.error({ msg: before.error.message });
    return EXIT_ERROR;
  }
  if (!options.enable) {
    report({ json: options.json, lines: hmiStateLines({ states: before.value }), states: before.value });
    return EXIT_OK;
  }
  return enableThenReadBack({ api, metrics, options, states: before.value });
}

/** Parse the flags and validate the names, printing every refusal; `null` means the caller exits 2. */
function readInvocation({
  rest,
}: {
  rest: readonly string[];
}): { options: DatadogHmiOptions; metrics: readonly string[] } | null {
  const parsed = parseDatadogHmiOptions({ rest });
  if (parsed.isErr()) {
    for (const line of datadogArgsErrorLines({ error: parsed.error })) {
      logger.error({ msg: line });
    }
    logger.error({ msg: DATADOG_HMI_USAGE });
    return null;
  }
  const metrics = validateMetricNames({ names: parsed.value.metrics });
  if (metrics.isErr()) {
    logger.error({ msg: metrics.error.message });
    return null;
  }
  return { metrics: metrics.value, options: parsed.value };
}

/** Plan from the states already read, switch on what is off through the door, then read every metric back. */
async function enableThenReadBack({
  api,
  metrics,
  options,
  states,
}: {
  api: HmiApi;
  metrics: readonly string[];
  options: DatadogHmiOptions;
  states: readonly HmiState[];
}): Promise<number> {
  const plan = planHmiEnable({ states });
  if (options.dryRun) {
    report({ json: options.json, lines: hmiPlanLines({ plan, verb: "would enable" }), states });
    return EXIT_OK;
  }
  if (plan.toEnable.length > 0) {
    if (!options.json) {
      hmiPlanLines({ plan, verb: "enabling" }).forEach((line) => {
        logger.out({ line });
      });
    }
    const home = resolveHome({ named: options.home });
    const routed = await throughDoor({
      gates: DEFAULT_GATES,
      home,
      ledger: doorLedgerPort(),
      perform: () => enableHmi({ api, metrics: plan.toEnable }),
      request: hmiDoorRequestFor({ home, metrics: plan.toEnable }),
    });
    if (!routed.performed) {
      notPerformedLines({ command: "slopweaver datadog hmi --enable", through: routed }).forEach((line) => {
        logger.error({ msg: line });
      });
      // A recording refusal is the store's failure, not a policy refusal: it exits as an error.
      return routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY;
    }
    if (routed.result.isErr()) {
      logger.error({ msg: routed.result.error.message });
      return EXIT_ERROR;
    }
  }
  return readBack({ api, json: options.json, metrics });
}

/** Read every metric again and answer by what Datadog now says, not by what the enables returned. */
async function readBack({
  api,
  json,
  metrics,
}: {
  api: HmiApi;
  json: boolean;
  metrics: readonly string[];
}): Promise<number> {
  const after = await readHmiStates({ api, metrics });
  if (after.isErr()) {
    logger.error({ msg: after.error.message });
    return EXIT_ERROR;
  }
  report({ json, lines: hmiStateLines({ states: after.value }), states: after.value });
  const stillOff = metricsStillOff({ states: after.value });
  if (stillOff.length > 0) {
    logger.error({ msg: DatadogHmiErrors.notOnAfterEnable({ stillOff }).message });
    return EXIT_ERROR;
  }
  if (!json) {
    logger.out({ line: HMI_EFFECTIVE_CAVEAT });
  }
  return EXIT_OK;
}

/** Print the states on the data channel, as JSON or as lines. */
function report({
  json,
  lines,
  states,
}: {
  json: boolean;
  lines: readonly string[];
  states: readonly HmiState[];
}): void {
  if (json) {
    logger.out({ line: JSON.stringify({ metrics: states }, null, 2) });
    return;
  }
  lines.forEach((line) => {
    logger.out({ line });
  });
}

export const datadogHmiCommand = defineCommand({ run: runDatadogHmi });
