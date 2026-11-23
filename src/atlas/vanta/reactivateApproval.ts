/**
 * The door gate that stands between a resolved reactivation batch and a real compliance posture.
 *
 * The shape `deactivateApproval.ts` and `groupMembershipApproval.ts` carry, and a `hold` for the same stated
 * reason: a `warn` MUST carry an override token, so it is always waivable by `$SLOPWEAVER_DOOR_OVERRIDE`,
 * and an environment variable an agent can set is not an owner.
 *
 * ## Why the reverse of an ignore needs the same friction
 *
 * Reactivating a finding puts it back in front of every control that counts it. A control that was passing
 * can turn red the moment the batch lands, and the deactivation it undoes — the reason, who gave it, the
 * until-date — is not restored by deactivating again: a fresh deactivation is a new record with a new author
 * and a new date. So the write is the owner's call, previewed first, exactly like the one it reverses.
 *
 * ## What the digest covers
 *
 * The request AS IT WOULD BE SENT: the method, the path and every byte of the body as `writePreview.ts`
 * resolves it through the client's own serializer, so every id in the order it would go out. Adding a
 * finding, dropping one or reordering the batch stops it matching. The clock, the home and the `--json`
 * choice are not in it, because none of them is what a reader checked.
 *
 * **It does not authenticate a human.** The same process that prints the digest can compute it. What it
 * buys is that the write is a SECOND deliberate act taken with the resolved request already on screen,
 * against a batch that cannot have changed underneath it, and that the unapproved attempt is refused AT THE
 * DOOR and recorded rather than silently skipped.
 */
import { createHash } from "node:crypto";

import { type ApprovalGate, approvalGate } from "../../admit/approval.js";
import type { DoorFinding } from "../../admit/types.js";
import type { VantaResolvedWriteRequest } from "./writePreview.js";

/** How many hex characters of the approval digest are printed and compared — as the other Vanta gates use. */
const DIGEST_WIDTH = 16;

/** The finding code an unapproved or mismatched reactivation fires. */
export const REACTIVATE_UNAPPROVED_CODE = "vanta.reactivate-unapproved";

/**
 * The digest an approval is bound to: a hash over exactly the request that would be sent, and nothing else.
 *
 * @param request the reactivation request as `writePreview.ts` resolves it — what `--dry-run` prints
 * @returns the leading hex characters of the SHA-256 over the canonical request
 */
export function vantaReactivateDigest({ request }: { request: VantaResolvedWriteRequest }): string {
  const canonical = JSON.stringify({ body: request.body, method: request.method, path: request.path });
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, DIGEST_WIDTH);
}

/**
 * Build the gate for one reactivation batch.
 *
 * Pure by construction: both digests are computed by the caller before the gate is built, so the gate
 * itself cannot reach Vanta mid-decision.
 *
 * @param expected the digest of the batch as it stands right now
 * @param supplied what the caller passed to `--approve`, `null` when they passed nothing
 * @returns an `ApprovalGate` that holds unless the two match exactly
 */
export function vantaReactivateApprovalGate({
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
        ? "this reactivation has not been approved — putting a finding back in front of its controls is not " +
          "an agent's to decide alone, and deactivating it again does not restore the record it replaces"
        : `the approval ${supplied} does not match this batch (${expected}) — it was approved, then it changed`;
    return [
      {
        code: REACTIVATE_UNAPPROVED_CODE,
        correction:
          `run --dry-run to see the exact request, then re-run with --approve ${expected}. ` +
          "That digest covers the route and every id in the order shown; adding, dropping or reordering any " +
          "of them invalidates it. There is no override — this hold is not waivable by " +
          "$SLOPWEAVER_DOOR_OVERRIDE",
        severity: "hold",
        summary,
      },
    ];
  };
  return approvalGate({ gate });
}
