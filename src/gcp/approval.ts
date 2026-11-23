/**
 * The door gate between a previewed GCP write and Google — the same shape as `../datadog/monitorApproval.ts`,
 * and a `hold` for the same reason: a create, a grant or a deploy changes what exists in a cloud project, and an
 * environment variable an agent can set is not the owner's yes.
 *
 * The gate compares the digest supplied with `--approve` against the digest of the plan AS IT STANDS NOW —
 * rebuilt at write time from a fresh read of every resource the plan touches — so an approval cannot be
 * transplanted onto a write nobody saw, and a resource that moved since the preview invalidates it. What it
 * does not do, stated as `../admit/approval.ts` states it: it does not authenticate a human. It makes the write
 * a second deliberate step against state that cannot have moved underneath it, and records an unapproved
 * attempt in the door ledger.
 */
import { type ApprovalGate, approvalGate } from "../admit/approval.js";
import type { DoorFinding } from "../admit/types.js";

/** The finding code an unapproved or mismatched GCP write fires. */
const GCP_WRITE_UNAPPROVED_CODE = "gcp.write-unapproved";

/**
 * Build the gate for one GCP write step.
 *
 * Pure by construction: both digests are computed by the caller before the gate is built.
 *
 * @param expected the digest of the plan as it stands right now
 * @param supplied what the caller passed to `--approve`
 * @param preview the command that prints the preview and its digest, for the correction line
 * @returns an `ApprovalGate` that holds unless the two match exactly
 */
export function gcpWriteApprovalGate({
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
        code: GCP_WRITE_UNAPPROVED_CODE,
        correction:
          `run \`${preview}\` without --approve to see the write as it stands now, then re-run with --approve ` +
          `${expected} once it has been approved. That digest covers every resource as it was read, its etag ` +
          "included, and every request sent, an IAM grant as the one binding it adds; any drift invalidates it. " +
          "There is no override — this hold is not " +
          "waivable by $SLOPWEAVER_DOOR_OVERRIDE",
        severity: "hold",
        summary:
          `the approval ${supplied} does not match this write (${expected}) — a resource or the write moved after ` +
          "the preview it was given for",
      },
    ];
  };
  return approvalGate({ gate });
}
