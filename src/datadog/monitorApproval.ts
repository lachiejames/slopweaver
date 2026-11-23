/**
 * The door gate between a previewed monitor change and Datadog — the same shape as
 * `../atlas/vanta/deactivateApproval.ts`, and a `hold` for the same reason: a monitor edit or delete changes
 * what pages the organisation, a delete cannot be undone, and an environment variable an agent can set is not
 * the owner's yes.
 *
 * The gate compares the digest supplied with `--approve` against the digest of the change AS IT STANDS NOW —
 * recomputed at write time from a fresh read of each monitor — so an approval cannot be transplanted onto a
 * change nobody saw, and a monitor edited since the preview (its `modified` moves) invalidates it. What it does
 * not do, stated as `../admit/approval.ts` states it: it does not authenticate a human. It makes the write a
 * second deliberate step against content that cannot have moved underneath it, and records the unapproved
 * attempt in the door ledger.
 */
import { type ApprovalGate, approvalGate } from "../admit/approval.js";
import type { DoorFinding } from "../admit/types.js";

/** The finding code an unapproved or mismatched monitor write fires. */
export const MONITOR_WRITE_UNAPPROVED_CODE = "datadog.monitor-write-unapproved";

/**
 * Build the gate for one monitor write.
 *
 * Pure by construction: both digests are computed by the caller before the gate is built, so the gate cannot
 * reach Datadog mid-decision.
 *
 * @param expected the digest of the change as it stands right now
 * @param supplied what the caller passed to `--approve`
 * @param preview the command that prints the preview and its digest, for the correction line
 * @returns an `ApprovalGate` that holds unless the two match exactly
 */
export function monitorWriteApprovalGate({
  expected,
  supplied,
  preview,
}: {
  expected: string;
  supplied: string;
  preview: string;
}): ApprovalGate {
  const gate = (): readonly DoorFinding[] => {
    if (supplied === expected) {
      return [];
    }
    return [
      {
        code: MONITOR_WRITE_UNAPPROVED_CODE,
        correction:
          `run \`${preview}\` without --approve to see the change as it stands now, then re-run with --approve ` +
          `${expected} once it has been approved. That digest covers each monitor as it was read, its modified ` +
          "time included, and the exact body sent; any drift invalidates it. There is no override — this hold " +
          "is not waivable by $SLOPWEAVER_DOOR_OVERRIDE",
        severity: "hold",
        summary:
          `the approval ${supplied} does not match this change (${expected}) — the monitor or the change moved ` +
          "after the preview it was given for",
      },
    ];
  };
  return approvalGate({ gate });
}
