/**
 * `slopweaver datadog monitor delete <id[,id...]>` — read every monitor, refuse an IaC-managed one, run
 * Datadog's own `can_delete` check over the whole list, print each monitor with one approval digest, and only
 * on a matching `--approve` delete them in the order given.
 *
 * The list is all or nothing up to the point of writing: one unreadable, managed or still-referenced monitor
 * refuses the whole list before anything is deleted, because a partly-applied cleanup is a list nobody
 * approved. A delete Datadog refuses mid-run stops there and names the ids already gone, because those stand.
 */
import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { checkDeletable, deleteMonitors, type MonitorApi, readMonitors } from "../../../datadog/monitorApi.js";
import { type MonitorSnapshot, monitorDeleteDigest } from "../../../datadog/monitorWrite.js";
import { EXIT_OK } from "../../exitCodes.js";
import { type DatadogMonitorOptions, iacGuard } from "./monitorCore.js";
import { approvedMonitorWrite, previewTokens, printMonitorLines, reportMonitorError } from "./monitorDoor.js";
import { approvalLines, monitorCommandLine, monitorHeadline } from "./monitorLines.js";

/** One validated `datadog monitor delete` invocation. */
type DeleteOptions = Extract<DatadogMonitorOptions, { mode: "delete" }>;

/**
 * Print what a delete would remove: the unsent document under `--json` with no `--approve`, else (outside `--json`)
 * one line per monitor; an approved `--json` run prints only its result.
 *
 * @param digest the approval digest the preview carries
 * @param monitors the monitors the list names, as read
 * @param options the parsed invocation
 */
function printDeletePreview({
  digest,
  monitors,
  options,
}: {
  digest: string;
  monitors: readonly MonitorSnapshot[];
  options: DeleteOptions;
}): void {
  if (options.json && options.approve === undefined) {
    printMonitorLines({ lines: [JSON.stringify({ approve: digest, monitors, sent: false }, null, 2)] });
  } else if (!options.json) {
    printMonitorLines({ lines: monitors.map((monitor) => `delete ${monitorHeadline({ monitor })}`) });
  }
}

/**
 * Run `datadog monitor delete` against a bound seam.
 *
 * @param api the seam
 * @param options the parsed invocation
 * @param rest the argv tail after `monitor`, for the re-run line
 * @param home the resolved state home whose door ledger records the write
 * @param iacManagedTags the ownership tags the selected home's profile configured; empty leaves the guard inert
 * @param ledger the door ledger the approved write's decision is recorded through
 * @returns the exit code
 */
export async function runMonitorDelete({
  api,
  options,
  rest,
  home,
  iacManagedTags,
  ledger,
}: {
  api: MonitorApi;
  options: DeleteOptions;
  rest: readonly string[];
  home: string;
  iacManagedTags: readonly string[];
  ledger: DoorLedgerPort;
}): Promise<number> {
  const monitors = await readMonitors({ api, ids: options.ids });
  if (monitors.isErr()) {
    return reportMonitorError({ error: monitors.error });
  }
  const guard = iacGuard({ iacManagedTags, iacOverride: options.iacOverride, monitors: monitors.value });
  if (guard.isErr()) {
    return reportMonitorError({ error: guard.error });
  }
  const deletable = await checkDeletable({ api, ids: options.ids });
  if (deletable.isErr()) {
    return reportMonitorError({ error: deletable.error });
  }
  const digest = monitorDeleteDigest({ monitors: monitors.value });
  printDeletePreview({ digest, monitors: monitors.value, options });
  if (options.approve === undefined) {
    if (!options.json) {
      printMonitorLines({
        lines: approvalLines({ command: monitorCommandLine({ tokens: previewTokens({ rest }) }), digest }),
      });
    }
    return EXIT_OK;
  }
  const deleted = await approvedMonitorWrite({
    write: {
      acknowledgements: guard.value,
      artifact: { monitors: [...options.ids] },
      expected: digest,
      home,
      ledger,
      perform: () => deleteMonitors({ api, ids: options.ids }),
      supplied: options.approve,
      verb: "delete",
    },
  });
  if (deleted.isErr()) {
    return deleted.error;
  }
  printDeleted({ deleted: deleted.value, json: options.json });
  return EXIT_OK;
}

/** Print what an approved delete removed: the result document under `--json`, else one summary line. */
function printDeleted({ deleted, json }: { deleted: readonly number[]; json: boolean }): void {
  printMonitorLines({
    lines: [
      json
        ? JSON.stringify({ deleted, sent: true }, null, 2)
        : `deleted ${String(deleted.length)} monitor(s): ${deleted.map(String).join(", ")}`,
    ],
  });
}
