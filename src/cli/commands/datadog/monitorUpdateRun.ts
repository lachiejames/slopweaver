/**
 * `slopweaver datadog monitor update <id> ...` — read the live monitor, refuse what may not be written, ask
 * Datadog's validator, print the exact before/after with an approval digest, and only on a matching
 * `--approve` send the PUT and read the answer back.
 *
 * ## What is refused, and in what order
 *
 * 1. A change that would break the alert-only rule — a `{{#is_recovery}}` block added, a non-zero renotify
 *    interval set. No override: the owner's rule is that monitors here are alert-only.
 * 2. A monitor carrying one of the install's infrastructure-as-code ownership tags (`profile.json`
 *    `datadog.iacManagedTags`, empty by default), unless `--iac-override` names why; the reason rides the ledger.
 * 3. A change Datadog's own validator would refuse, so a digest is only printed for a PUT Datadog would take.
 *
 * The exit code is the read-back's, never the PUT's: a field that reads otherwise afterwards is a write that
 * did not take, whatever the status said.
 */
import { readFileSync } from "node:fs";

import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import type { DoorAcknowledgement } from "../../../admit/types.js";
import { applyUpdate, type MonitorApi, readMonitor, validateUpdate } from "../../../datadog/monitorApi.js";
import {
  alertOnlyViolations,
  type MonitorPatch,
  type MonitorUpdatePlan,
  monitorUpdateDigest,
  parseMonitorPatch,
  planMonitorUpdate,
  readBackMismatches,
} from "../../../datadog/monitorWrite.js";
import { type DatadogMonitorWriteError, DatadogMonitorWriteErrors } from "../../../datadog/monitorWriteErrors.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { type DatadogMonitorOptions, iacGuard, type MonitorChangeSource } from "./monitorCore.js";
import { approvedMonitorWrite, previewTokens, printMonitorLines, reportMonitorError } from "./monitorDoor.js";
import { approvalLines, monitorCommandLine, monitorDiffLines, monitorHeadline } from "./monitorLines.js";

/** One validated `datadog monitor update` invocation. */
type UpdateOptions = Extract<DatadogMonitorOptions, { mode: "update" }>;

/** An update that passed every refusal and Datadog's validator: what to show, and what to send. */
interface PreparedUpdate {
  readonly plan: MonitorUpdatePlan;
  readonly digest: string;
  readonly acknowledgements: readonly DoorAcknowledgement[];
}

/** The change as a patch: the flags' object, or the `--patch` document read from a file or stdin. */
function readPatch({ change }: { change: MonitorChangeSource }): Result<MonitorPatch, DatadogMonitorWriteError> {
  if (change.kind === "flags") {
    return parseMonitorPatch({ value: change.value });
  }
  let text: string;
  try {
    text = readFileSync(change.path === "-" ? 0 : change.path, "utf8");
  } catch (cause: unknown) {
    return err(
      DatadogMonitorWriteErrors.patchInvalid({
        detail: `could not read ${change.path}: ${errorMessage({ error: cause })}`,
      }),
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause: unknown) {
    return err(
      DatadogMonitorWriteErrors.patchInvalid({
        detail: `${change.path} is not JSON: ${errorMessage({ error: cause })}`,
      }),
    );
  }
  return parseMonitorPatch({ value });
}

/** Read, plan, refuse and validate — everything an update does before it prints a digest. */
async function prepareUpdate({
  api,
  options,
  iacManagedTags,
}: {
  api: MonitorApi;
  options: UpdateOptions;
  iacManagedTags: readonly string[];
}): Promise<Result<PreparedUpdate, DatadogMonitorWriteError>> {
  const patch = readPatch({ change: options.change });
  if (patch.isErr()) {
    return err(patch.error);
  }
  const live = await readMonitor({ api, id: options.id });
  if (live.isErr()) {
    return err(live.error);
  }
  const plan = planMonitorUpdate({ live: live.value, patch: patch.value });
  if (plan.isErr()) {
    return err(plan.error);
  }
  const violations = alertOnlyViolations({ plan: plan.value });
  if (violations.length > 0) {
    return err(DatadogMonitorWriteErrors.alertOnlyRefused({ id: options.id, violations }));
  }
  const guard = iacGuard({ iacManagedTags, iacOverride: options.iacOverride, monitors: [live.value] });
  if (guard.isErr()) {
    return err(guard.error);
  }
  const validated = await validateUpdate({ api, plan: plan.value });
  if (validated.isErr()) {
    return err(validated.error);
  }
  return ok({ acknowledgements: guard.value, digest: monitorUpdateDigest({ plan: plan.value }), plan: plan.value });
}

/** Print the before/after and, when nothing is approved yet, the digest and the exact re-run line. */
function printPreview({
  prepared,
  options,
  rest,
}: {
  prepared: PreparedUpdate;
  options: UpdateOptions;
  rest: readonly string[];
}): void {
  const { plan, digest } = prepared;
  if (options.json) {
    if (options.approve === undefined) {
      const preview = { approve: digest, changes: plan.changes, monitor: options.id, sent: false };
      printMonitorLines({ lines: [JSON.stringify(preview, null, 2)] });
    }
    return;
  }
  printMonitorLines({
    lines: [monitorHeadline({ monitor: plan.before }), ...monitorDiffLines({ changes: plan.changes })],
  });
  if (options.approve === undefined) {
    printMonitorLines({
      lines: approvalLines({ command: monitorCommandLine({ tokens: previewTokens({ rest }) }), digest }),
    });
  }
}

/**
 * Run `datadog monitor update` against a bound seam.
 *
 * @param api the seam
 * @param options the parsed invocation
 * @param rest the argv tail after `monitor`, for the re-run line
 * @param home the resolved state home whose door ledger records the write
 * @param iacManagedTags the ownership tags the selected home's profile configured; empty leaves the guard inert
 * @param ledger the door ledger the approved write's decision is recorded through
 * @returns the exit code
 */
export async function runMonitorUpdate({
  api,
  options,
  rest,
  home,
  iacManagedTags,
  ledger,
}: {
  api: MonitorApi;
  options: UpdateOptions;
  rest: readonly string[];
  home: string;
  iacManagedTags: readonly string[];
  ledger: DoorLedgerPort;
}): Promise<number> {
  const prepared = await prepareUpdate({ api, iacManagedTags, options });
  if (prepared.isErr()) {
    return reportMonitorError({ error: prepared.error });
  }
  printPreview({ options, prepared: prepared.value, rest });
  if (options.approve === undefined) {
    return EXIT_OK;
  }
  const { plan, digest, acknowledgements } = prepared.value;
  const written = await approvedMonitorWrite({
    write: {
      acknowledgements,
      artifact: { fields: plan.changes.map((change) => change.field), monitor: options.id },
      expected: digest,
      home,
      ledger,
      perform: () => applyUpdate({ api, plan }),
      supplied: options.approve,
      verb: "update",
    },
  });
  if (written.isErr()) {
    return written.error;
  }
  const mismatched = readBackMismatches({ after: written.value, plan });
  if (mismatched.length > 0) {
    logger.error({
      msg: `Datadog accepted the update, but monitor ${String(options.id)} reads otherwise for: ${mismatched.join(", ")}`,
    });
    return EXIT_ERROR;
  }
  printMonitorLines({
    lines: [
      options.json
        ? JSON.stringify({ monitor: written.value, sent: true }, null, 2)
        : `updated, and read back as sent: ${monitorHeadline({ monitor: written.value })}`,
    ],
  });
  return EXIT_OK;
}
