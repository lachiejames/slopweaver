/**
 * The door gate that stands between a resolved group-membership plan and a real change to what people are
 * obliged to do.
 *
 * The shape `deactivateApproval.ts` and `documentApproval.ts` carry, and a `hold` for the same stated
 * reason: a `warn` MUST carry an override token, so it is always waivable by `$SLOPWEAVER_DOOR_OVERRIDE`,
 * and an environment variable an agent can set is not an owner.
 *
 * ## What makes this one worth the friction
 *
 * Group membership is what Vanta hangs policy obligations off. Moving somebody into a group can mint an
 * acceptance task for every policy the group assigns and turn a per-person control test red; moving them out can
 * retire an obligation an auditor was counting on. Both are visible to everyone reading the workspace, and
 * neither is undone by re-running the verb the other way — the tasks and their dates do not come back.
 *
 * ## What the digest covers
 *
 * Both legs AS THEY WOULD BE SENT: the group id, the method and path of each leg, and every person id in
 * the order it would go out. So an approval cannot be transplanted to another group, and adding one person
 * to either side stops it matching. The clock, the home and the `--json` choice are not in it, because none
 * of them is what a reader checked.
 *
 * **It does not authenticate a human.** The same process that prints the digest can compute it. What it
 * buys is that the write is a SECOND deliberate act taken with the resolved requests already on screen,
 * against a plan that cannot have changed underneath it, and that the unapproved attempt is refused AT THE
 * DOOR and recorded rather than silently skipped.
 */
import { createHash } from "node:crypto";

import { type ApprovalGate, approvalGate } from "../../admit/approval.js";
import type { DoorFinding } from "../../admit/types.js";
import type { VantaResolvedWriteRequest } from "./writePreview.js";

/** How many hex characters of the approval digest are printed and compared — as the other Vanta gates use. */
const DIGEST_WIDTH = 16;

/** The finding code an unapproved or mismatched group-membership write fires. */
export const GROUP_MEMBERSHIP_UNAPPROVED_CODE = "vanta.group-membership-unapproved";

/**
 * The digest an approval is bound to: a hash over exactly the requests that would be sent, in order.
 *
 * Taken over the RESOLVED requests rather than the caller's flags, so it covers the method, the path and
 * every byte of each body as `writePreview.ts` renders them — which is what `--dry-run` puts on screen.
 *
 * @param requests every leg this plan would send, in the order it would send them
 * @returns the leading hex characters of the SHA-256 over the canonical plan
 */
export function vantaGroupMembershipDigest({ requests }: { requests: readonly VantaResolvedWriteRequest[] }): string {
  const canonical = JSON.stringify(
    requests.map((request) => ({ body: request.body, method: request.method, path: request.path })),
  );
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, DIGEST_WIDTH);
}

/**
 * Build the gate for one resolved group-membership plan.
 *
 * Pure by construction: both digests are computed by the caller before the gate is built, so the gate
 * itself cannot reach Vanta mid-decision.
 *
 * @param expected the digest of the plan as it stands right now
 * @param supplied what the caller passed to `--approve`, `null` when they passed nothing
 * @returns an `ApprovalGate` that holds unless the two match exactly
 */
export function vantaGroupMembershipApprovalGate({
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
        ? "this group membership change has not been approved — a group is what Vanta hangs a person's " +
          "policy obligations off, and re-running the verb the other way does not undo the tasks it minted"
        : `the approval ${supplied} does not match this plan (${expected}) — it was approved, then it changed`;
    return [
      {
        code: GROUP_MEMBERSHIP_UNAPPROVED_CODE,
        correction:
          `run --dry-run to see the exact requests, then re-run with --approve ${expected}. ` +
          "That digest covers the group, both directions and every person id in the order shown; changing " +
          "any of them invalidates it. There is no override — this hold is not waivable by " +
          "$SLOPWEAVER_DOOR_OVERRIDE",
        severity: "hold",
        summary,
      },
    ];
  };
  return approvalGate({ gate });
}
