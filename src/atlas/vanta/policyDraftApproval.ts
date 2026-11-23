/**
 * The door gate that stands between a resolved policy-draft substitution and a real compliance document.
 *
 * The same shape `deactivateApproval.ts` holds, and for the same reason: a policy is what an auditor reads,
 * and a change to one is not an agent's to make alone. It is a `hold` rather than a `warn` because a `warn`
 * must carry an override token, and an environment variable an agent can set is not an owner.
 *
 * **What it does not do.** It does not authenticate a human — the same process that prints the digest can
 * compute it. What it buys is that the write is a SECOND deliberate act taken with the diff already on
 * screen, against a substitution and a draft that cannot have changed underneath it, and that the
 * unapproved attempt is refused AT THE DOOR and recorded rather than silently skipped.
 */
import { type ApprovalGate, approvalGate } from "../../admit/approval.js";
import type { DoorFinding } from "../../admit/types.js";

/** The finding code an unapproved or mismatched policy-draft edit fires. */
export const EDIT_POLICY_DRAFT_UNAPPROVED_CODE = "vanta.edit-policy-draft-unapproved";

/**
 * Build the gate for one substitution.
 *
 * Pure, and pure by construction: both digests are computed by the caller before the gate is built, so the
 * gate itself cannot reach a browser mid-decision.
 *
 * @param expected the digest of the substitution as it stands against the draft that was just read
 * @param supplied what the caller passed to `--approve`, `null` when they passed nothing
 * @returns an `ApprovalGate` that holds unless the two match exactly
 */
export function vantaEditPolicyDraftApprovalGate({
  expected,
  supplied,
}: {
  expected: string;
  supplied: string | null;
}): ApprovalGate {
  const gate = (): readonly DoorFinding[] => {
    if (supplied === expected) {
      return [];
    }
    const summary =
      supplied === null
        ? "this policy edit has not been approved — changing a policy an auditor reads is not an agent's to " +
          "decide alone"
        : `the approval ${supplied} does not match this substitution against this draft (${expected}) — ` +
          "it was approved, then either the change or the draft moved";
    return [
      {
        code: EDIT_POLICY_DRAFT_UNAPPROVED_CODE,
        correction:
          `run --dry-run to see the diff, then re-run with --approve ${expected}. That digest covers the ` +
          "editor address, both strings and the whole text the substitution would produce, so a draft that " +
          "has moved since invalidates it. There is no override — this hold is not waivable by " +
          "$SLOPWEAVER_DOOR_OVERRIDE",
        severity: "hold",
        summary,
      },
    ];
  };
  return approvalGate({ gate });
}
