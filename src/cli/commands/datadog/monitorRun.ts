/**
 * `slopweaver datadog monitor <show|update|delete>` — read one Datadog monitor, or change or delete exact ones
 * behind a previewed digest. This is the shell: it parses, binds the seam and dispatches; the write legs live
 * in `monitorUpdateRun.ts` and `monitorDeleteRun.ts`, and `../../../datadog/monitorWrite.ts` carries the rules.
 *
 * ## The exit-code contract
 *
 * | situation                                                                          | code |
 * | ---------------------------------------------------------------------------------- | ---- |
 * | a bad flag or id, or a change that is not one                                      | `2`  |
 * | credentials unset; nothing to change; a refusal (alert-only, IaC, `can_delete`); the door held | `3` |
 * | a write's `--home` profile is there but corrupt — read before any Datadog call     | `1`  |
 * | a monitor could not be read, Datadog refused the change, or the read-back differs  | `1`  |
 *
 * `--home` selects ONE home for everything a write reads and records: the profile's IaC ownership tags
 * (`datadog.iacManagedTags`), the Datadog credentials, and the door ledger.
 * | shown; previewed (no `--approve`); or written and read back                        | `0`  |
 */
import { type DoorLedgerPort, doorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { createDatadogClient } from "../../../datadog/client.js";
import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import { type MonitorApi, readMonitor, sdkMonitorApi } from "../../../datadog/monitorApi.js";
import { loadDatadogConfig } from "../../../datadog/source.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { Profile } from "../../../profile.js";
import { type ProfileReadError, readProfile } from "../../../profileStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome, verbTail } from "../../optionParsers.js";
import { datadogArgsErrorLines } from "./errors.js";
import { parseDatadogMonitorOptions } from "./monitorCore.js";
import { runMonitorDelete } from "./monitorDeleteRun.js";
import { printMonitorLines, reportMonitorError } from "./monitorDoor.js";
import { monitorShowLines } from "./monitorLines.js";
import { runMonitorUpdate } from "./monitorUpdateRun.js";
import { DATADOG_MONITOR_USAGE } from "./monitorUsage.js";

/**
 * The one seam this verb injects: how the monitor API is bound.
 *
 * It exists so the approval can be proved at the REAL command boundary — a test hands in an in-memory monitor
 * set, runs the verb without `--approve`, and asserts nothing was written. A mock would prove only that a
 * different function was not called, and this repo's testing rule bans one.
 *
 * @internal
 */
export interface DatadogMonitorDeps {
  /** Resolve the selected home's credentials and bind the API, or every line saying why it could not be bound. */
  readonly createApi: (input: { readonly home: string }) => Result<MonitorApi>;
  /** Read the selected home's profile, for the IaC ownership tags a write is guarded by. */
  readonly readProfile: (input: { readonly home: string }) => Result<Profile | null, ProfileReadError>;
  /** The door ledger an approved write's decision is recorded through. */
  readonly doorLedger: DoorLedgerPort;
}

/** The production seam: the selected home's Datadog credentials, the shared client, the SDK's monitors API. */
const PRODUCTION_DEPS: DatadogMonitorDeps = {
  createApi: ({ home }) => {
    const config = loadDatadogConfig({ home });
    if (config.isErr()) {
      return err(datadogConfigErrorLines({ error: config.error }));
    }
    return ok(sdkMonitorApi({ datadog: createDatadogClient({ config: config.value, logger }) }));
  },
  doorLedger: doorLedgerPort(),
  readProfile,
};

/**
 * The IaC ownership tags a write is guarded by. A home with no profile configured none, so the guard is inert;
 * a profile that is there but corrupt is refused, never read as "no tags", because that would disarm the guard.
 */
function iacManagedTagsFor({
  deps,
  home,
}: {
  deps: DatadogMonitorDeps;
  home: string;
}): Result<readonly string[], ProfileReadError> {
  const profile = deps.readProfile({ home });
  if (profile.isErr()) {
    return err(profile.error);
  }
  if (profile.value === null) {
    return ok([]);
  }
  return ok(profile.value.datadog.iacManagedTags);
}

/** `show`: read one monitor and print it, as lines or as its wire JSON. */
async function runMonitorShow({ api, id, json }: { api: MonitorApi; id: number; json: boolean }): Promise<number> {
  const monitor = await readMonitor({ api, id });
  if (monitor.isErr()) {
    return reportMonitorError({ error: monitor.error });
  }
  printMonitorLines({
    lines: json ? [JSON.stringify(monitor.value, null, 2)] : monitorShowLines({ monitor: monitor.value }),
  });
  return EXIT_OK;
}

/**
 * Run the `datadog monitor` verb against an injected seam.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @param deps how the monitor API is bound and the selected home's profile is read
 * @returns the process exit code
 * @internal
 */
export async function runDatadogMonitorWith({
  argv,
  deps,
}: {
  argv: readonly string[];
  deps: DatadogMonitorDeps;
}): Promise<number> {
  const rest = verbTail({ argv, verbs: ["monitor"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DATADOG_MONITOR_USAGE });
    return EXIT_OK;
  }
  const parsed = parseDatadogMonitorOptions({ rest });
  if (parsed.isErr()) {
    for (const line of datadogArgsErrorLines({ error: parsed.error })) {
      logger.error({ msg: line });
    }
    logger.error({ msg: DATADOG_MONITOR_USAGE });
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const home = resolveHome({ named: options.mode === "show" ? undefined : options.home });
  const iacManagedTags = options.mode === "show" ? ok([]) : iacManagedTagsFor({ deps, home });
  if (iacManagedTags.isErr()) {
    logger.error({ msg: iacManagedTags.error.message });
    return EXIT_ERROR;
  }
  const api = deps.createApi({ home });
  if (api.isErr()) {
    api.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_EXPECTED_EMPTY;
  }
  const write = { api: api.value, home, iacManagedTags: iacManagedTags.value, ledger: deps.doorLedger, rest };
  switch (options.mode) {
    case "show":
      return runMonitorShow({ api: api.value, id: options.id, json: options.json });
    case "update":
      return runMonitorUpdate({ ...write, options });
    case "delete":
      return runMonitorDelete({ ...write, options });
    default: {
      const unreachable: never = options;
      return unreachable;
    }
  }
}

/**
 * Run the `datadog monitor` verb against Datadog.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runDatadogMonitor(argv: readonly string[]): Promise<number> {
  return runDatadogMonitorWith({ argv, deps: PRODUCTION_DEPS });
}

export const datadogMonitorCommand = defineCommand({ run: runDatadogMonitor });
