/**
 * The PURE core of `slopweaver datadog monitor`: flag parsing, the IaC guard and the exit code each failure
 * earns. No fs, no clock, no network — `monitorRun.ts` does every read, every call and every door request, and
 * `monitorLines.ts` owns what is printed.
 */
import type { DoorAcknowledgement } from "../../../admit/types.js";
import { isIacManaged, type MonitorSnapshot } from "../../../datadog/monitorWrite.js";
import { type DatadogMonitorWriteError, DatadogMonitorWriteErrors } from "../../../datadog/monitorWriteErrors.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlags } from "../../parseFlags.js";
import { type DatadogArgsError, DatadogArgsErrors } from "./errors.js";

/** The fields a change flag sets, each the value the field ends as. */
const CHANGE_FLAGS = ["query", "name", "message", "tags"] as const;

/**
 * Every flag `datadog monitor` accepts across its three sub-verbs, as the parser reads them.
 *
 * @internal the spec stays in this file; {@link DATADOG_MONITOR_FLAG_NAMES} is what the help ratchet reads.
 */
export const DATADOG_MONITOR_FLAG_SPEC = {
  boolean: ["json"],
  string: ["approve", "home", "iac-override", "message", "name", "patch", "query", "tags"],
} as const;

/** {@link DATADOG_MONITOR_FLAG_SPEC}'s names in `--flag` form, for the help ratchet. */
export const DATADOG_MONITOR_FLAG_NAMES: readonly string[] = [
  ...DATADOG_MONITOR_FLAG_SPEC.string.map((name) => `--${name}`),
  ...DATADOG_MONITOR_FLAG_SPEC.boolean.map((name) => `--${name}`),
];

/** How the change was spelled: assembled from the flags, or a `--patch` document still to be read. */
export type MonitorChangeSource =
  | { readonly kind: "flags"; readonly value: Readonly<Record<string, unknown>> }
  | { readonly kind: "patch"; readonly path: string };

/** What a write sub-verb shares: the approval, the IaC override, the home and the output shape. */
interface MonitorWriteFlags {
  readonly approve: string | undefined;
  readonly iacOverride: string | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/** One validated `datadog monitor` invocation. */
export type DatadogMonitorOptions =
  | { readonly mode: "show"; readonly id: number; readonly json: boolean }
  | ({ readonly mode: "update"; readonly id: number; readonly change: MonitorChangeSource } & MonitorWriteFlags)
  | ({ readonly mode: "delete"; readonly ids: readonly number[] } & MonitorWriteFlags);

/** A monitor id as Datadog numbers them: a positive whole number. */
function monitorId({ written }: { written: string }): Result<number, DatadogArgsError> {
  const id = Number(written);
  return Number.isSafeInteger(id) && id > 0 && String(id) === written
    ? ok(id)
    : err(DatadogArgsErrors.notAWholeNumber({ flag: "<id>", got: written }));
}

/** Every id in a comma-separated list, repeats dropped and order kept. */
function monitorIds({ written }: { written: readonly string[] }): Result<readonly number[], DatadogArgsError> {
  const ids: number[] = [];
  for (const token of written.flatMap((value) => value.split(",")).map((value) => value.trim())) {
    const id = monitorId({ written: token });
    if (id.isErr()) {
      return err(id.error);
    }
    if (!ids.includes(id.value)) {
      ids.push(id.value);
    }
  }
  return ok(ids);
}

/** The change an `update` names: the flags, or one `--patch` document, never both and never neither. */
function changeSource({
  values,
}: {
  values: Readonly<Record<string, string>>;
}): Result<MonitorChangeSource, DatadogArgsError> {
  const fromFlags: Record<string, unknown> = {};
  for (const flag of CHANGE_FLAGS) {
    const value = values[flag];
    if (value !== undefined) {
      fromFlags[flag] =
        flag === "tags"
          ? value
              .split(",")
              .map((tag) => tag.trim())
              .filter((tag) => tag !== "")
          : value;
    }
  }
  const patch = values["patch"];
  const flagCount = Object.keys(fromFlags).length;
  if (patch !== undefined && flagCount > 0) {
    return err(
      DatadogArgsErrors.optionsRefused({
        reasons: ["--patch carries the whole change; drop the change flags beside it"],
      }),
    );
  }
  if (patch !== undefined) {
    return ok({ kind: "patch", path: patch });
  }
  if (flagCount === 0) {
    return err(
      DatadogArgsErrors.optionsRefused({
        reasons: ["update needs a change: --query, --name, --message, --tags or --patch"],
      }),
    );
  }
  return ok({ kind: "flags", value: fromFlags });
}

/** Refuse a write-only flag on `show`, and a change flag on `delete` — each would be silently ignored otherwise. */
function strayFlags({ mode, values }: { mode: string; values: Readonly<Record<string, string>> }): readonly string[] {
  const writeOnly = new Set(["approve", "home", "iac-override"]);
  const changeOnly = new Set<string>([...CHANGE_FLAGS, "patch"]);
  const stray = Object.keys(values).filter(
    (name) =>
      (mode === "show" && (writeOnly.has(name) || changeOnly.has(name))) || (mode === "delete" && changeOnly.has(name)),
  );
  return stray.map((name) => `--${name} means nothing to datadog monitor ${mode}`);
}

/**
 * Parse `datadog monitor`'s sub-verb, ids and flags.
 *
 * @param rest the argv tail after `monitor`
 * @returns the validated invocation, or the rejection
 */
export function parseDatadogMonitorOptions({
  rest,
}: {
  rest: readonly string[];
}): Result<DatadogMonitorOptions, DatadogArgsError> {
  const [mode, ...tail] = rest;
  if (mode === undefined) {
    return err(DatadogArgsErrors.monitorSubVerbMissing());
  }
  if (mode !== "show" && mode !== "update" && mode !== "delete") {
    return err(DatadogArgsErrors.monitorSubVerbUnknown({ got: mode }));
  }
  const parsed = parseFlags({ allowPositionals: true, args: tail, spec: DATADOG_MONITOR_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(DatadogArgsErrors.flagsInvalid({ reasons: parsed.error }));
  }
  const values = stringValues({ parsed: parsed.value.values });
  const json = parsed.value.values["json"] === true;
  const stray = strayFlags({ mode, values });
  if (stray.length > 0) {
    return err(DatadogArgsErrors.optionsRefused({ reasons: stray }));
  }
  const { positionals } = parsed.value;
  if (mode === "show") {
    const id = singleId({ mode, positionals });
    return id.isErr() ? err(id.error) : ok({ id: id.value, json, mode });
  }
  const shared = writeFlags({ json, values });
  if (shared.isErr()) {
    return err(shared.error);
  }
  return mode === "delete"
    ? deleteOptions({ positionals, shared: shared.value })
    : updateOptions({ positionals, shared: shared.value, values });
}

/** The string-valued flags the tokeniser read, keyed by name; the boolean ones are read on their own. */
function stringValues({ parsed }: { parsed: Readonly<Record<string, unknown>> }): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") {
      values[key] = value;
    }
  }
  return values;
}

/** A `delete`: the exact ids, at least one. */
function deleteOptions({
  positionals,
  shared,
}: {
  positionals: readonly string[];
  shared: MonitorWriteFlags;
}): Result<DatadogMonitorOptions, DatadogArgsError> {
  const ids = monitorIds({ written: positionals });
  if (ids.isErr()) {
    return err(ids.error);
  }
  if (ids.value.length === 0) {
    return err(DatadogArgsErrors.optionsRefused({ reasons: ["delete needs the exact monitor ids, comma-separated"] }));
  }
  return ok({ ...shared, ids: ids.value, mode: "delete" });
}

/** An `update`: one id and the change it names. */
function updateOptions({
  positionals,
  shared,
  values,
}: {
  positionals: readonly string[];
  shared: MonitorWriteFlags;
  values: Readonly<Record<string, string>>;
}): Result<DatadogMonitorOptions, DatadogArgsError> {
  const id = singleId({ mode: "update", positionals });
  if (id.isErr()) {
    return err(id.error);
  }
  const change = changeSource({ values });
  return change.isErr() ? err(change.error) : ok({ ...shared, change: change.value, id: id.value, mode: "update" });
}

/** The one monitor id `show` and `update` take. */
function singleId({
  mode,
  positionals,
}: {
  mode: string;
  positionals: readonly string[];
}): Result<number, DatadogArgsError> {
  const [written, ...extra] = positionals;
  if (written === undefined || extra.length > 0) {
    return err(
      DatadogArgsErrors.optionsRefused({
        reasons: [`${mode} takes exactly one monitor id, got ${String(positionals.length)}`],
      }),
    );
  }
  return monitorId({ written });
}

/** The flags a write sub-verb shares. A blank `--iac-override` names no reason, so it is refused, never read as absent. */
function writeFlags({
  json,
  values,
}: {
  json: boolean;
  values: Readonly<Record<string, string>>;
}): Result<MonitorWriteFlags, DatadogArgsError> {
  const reason = values["iac-override"];
  if (reason?.trim() === "") {
    return err(
      DatadogArgsErrors.optionsRefused({ reasons: ["--iac-override needs the reason this edit is an exception"] }),
    );
  }
  return ok({ approve: values["approve"], home: values["home"], iacOverride: reason?.trim(), json });
}

/**
 * Refuse a write touching an IaC-managed monitor unless `--iac-override` named why, and turn a given reason
 * into the acknowledgement the door ledger records. The acknowledgement is attached ONLY when a managed
 * monitor is actually in scope — a waiver for a refusal that never fired would read in the ledger exactly
 * like a real one (`../../../admit/types.ts` § AcknowledgeableSubject).
 *
 * @param monitors the monitors the write touches, as read
 * @param iacManagedTags the ownership tags `profile.json` `datadog.iacManagedTags` configured; empty is inert
 * @param iacOverride the reason given, if any
 * @returns the acknowledgements to attach, empty when none is needed, or the four-line refusal
 */
export function iacGuard({
  monitors,
  iacManagedTags,
  iacOverride,
}: {
  monitors: readonly MonitorSnapshot[];
  iacManagedTags: readonly string[];
  iacOverride: string | undefined;
}): Result<readonly DoorAcknowledgement[], DatadogMonitorWriteError> {
  const managed = monitors.filter((monitor) => isIacManaged({ iacManagedTags, monitor })).map((monitor) => monitor.id);
  if (managed.length === 0) {
    return ok([]);
  }
  if (iacOverride === undefined) {
    const lines = hatchRefusalLines({
      detail: `monitor ${managed.map(String).join(", ")}`,
      hatch: hatchFor({ id: "datadog-monitor-iac-managed" }),
    });
    return err(DatadogMonitorWriteErrors.iacManagedRefused({ ids: managed, lines }));
  }
  return ok([{ reason: iacOverride, subject: "datadog-iac-managed" }]);
}

/**
 * The exit code one failure earns: `2` for a change that is not one, `3` for a refusal or nothing to do (the
 * verb worked; the answer is no), `1` for a Datadog read or write that failed.
 *
 * @param error the failure
 * @returns the exit code
 */
export function monitorErrorExit({ error }: { error: DatadogMonitorWriteError }): number {
  switch (error.code) {
    case "PATCH_INVALID":
      return EXIT_USAGE;
    case "NO_CHANGE":
    case "ALERT_ONLY_REFUSED":
    case "IAC_MANAGED_REFUSED":
    case "CANNOT_DELETE":
      return EXIT_EXPECTED_EMPTY;
    case "DELETE_CHECK_FAILED":
    case "READ_FAILED":
    case "VALIDATE_REJECTED":
    case "WRITE_REJECTED":
      return EXIT_ERROR;
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}
