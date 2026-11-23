/**
 * What both WRITE legs of `slopweaver datadog monitor` share: printing a failure, the re-run line a preview
 * ends on, and the one door request every approved write goes through.
 *
 * ## Why a preview returns BEFORE the door
 *
 * Without `--approve` nothing is sent and nothing is recorded: routing a preview would write a ledger line
 * for a change that never happened, the reason `../vanta/deactivateRun.ts` gives for its `--dry-run`. With
 * `--approve` each leg reads every monitor AGAIN and recomputes the digest from that fresh read, so the gate
 * here compares the approval against the change as it stands at write time — a monitor edited since the
 * preview, or a change worded differently, holds.
 */
import type { DoorLedgerPort } from "../../../admit/doorLedgerPort.js";
import { notPerformedLines } from "../../../admit/doorRefusal.js";
import { throughDoor } from "../../../admit/effects.js";
import type { DoorAcknowledgement, DoorArtifact } from "../../../admit/types.js";
import { monitorWriteApprovalGate } from "../../../datadog/monitorApproval.js";
import type { DatadogMonitorWriteError } from "../../../datadog/monitorWriteErrors.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { monitorErrorExit } from "./monitorCore.js";

/**
 * Print one failure and answer with its exit code. The IaC refusal prints its four register lines; every
 * other failure prints its message.
 *
 * @param error the failure
 * @returns the exit code
 */
export function reportMonitorError({ error }: { error: DatadogMonitorWriteError }): number {
  const lines = error.code === "IAC_MANAGED_REFUSED" ? error.lines : [error.message];
  lines.forEach((line) => {
    logger.error({ msg: line });
  });
  return monitorErrorExit({ error });
}

/**
 * Print lines on the data channel.
 *
 * @param lines the lines, in order
 */
export function printMonitorLines({ lines }: { lines: readonly string[] }): void {
  lines.forEach((line) => {
    logger.out({ line });
  });
}

/**
 * The invocation's tokens with `--approve` and its value removed — the preview that prints the digest again.
 *
 * @param rest the argv tail after `monitor`
 * @returns the tokens to re-run
 */
export function previewTokens({ rest }: { rest: readonly string[] }): readonly string[] {
  const kept: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--approve") {
      index += 1;
    } else if (token !== undefined && !token.startsWith("--approve=")) {
      kept.push(token);
    }
  }
  return kept;
}

/** One approved write as the door sees it. */
export interface ApprovedMonitorWrite<T> {
  /** `update` or `delete`. */
  readonly verb: "update" | "delete";
  /** The state home whose ledger records the decision, as named by `--home`. */
  readonly home: string | undefined;
  /** The door ledger the decision is recorded through. */
  readonly ledger: DoorLedgerPort;
  /** What the ledger records about the write: ids and field names, never the values. */
  readonly artifact: DoorArtifact;
  /** The digest of the change as it stands now. */
  readonly expected: string;
  /** What `--approve` carried. */
  readonly supplied: string;
  /** The `--iac-override` reason, when a managed monitor is in scope. */
  readonly acknowledgements: readonly DoorAcknowledgement[];
  /** The write itself, run only when the door admits it. */
  readonly perform: () => Promise<Result<T, DatadogMonitorWriteError>>;
}

/**
 * Route one approved write through the door. `requiresApproval: true` with the digest gate, so a missing or
 * stale approval HOLDS, is recorded, and nothing reaches Datadog.
 *
 * @returns what the write returned, or the exit code to stop on, its reason already printed
 */
export async function approvedMonitorWrite<T>({
  write,
}: {
  write: ApprovedMonitorWrite<T>;
}): Promise<Result<T, number>> {
  const home = resolveHome({ named: write.home });
  const preview = `slopweaver datadog monitor ${write.verb}`;
  const routed = await throughDoor({
    gates: [monitorWriteApprovalGate({ expected: write.expected, preview, supplied: write.supplied })],
    home,
    ledger: write.ledger,
    perform: write.perform,
    request: {
      action: { kind: "verb", noun: "datadog", verb: `monitor ${write.verb}` },
      artifact: write.artifact,
      meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: true },
      ...(write.acknowledgements.length > 0 ? { acknowledgements: write.acknowledgements } : {}),
    },
  });
  if (!routed.performed) {
    notPerformedLines({ command: preview, through: routed }).forEach((line) => {
      logger.error({ msg: line });
    });
    // A recording refusal is the store's failure, not a policy hold: it exits as an error, not as expected-empty.
    return err(routed.kind === "recording-refused" ? EXIT_ERROR : EXIT_EXPECTED_EMPTY);
  }
  return routed.result.isErr() ? err(reportMonitorError({ error: routed.result.error })) : ok(routed.result.value);
}
