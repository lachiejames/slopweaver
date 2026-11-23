/**
 * The door gate that stands between a resolved deactivation batch and a real compliance posture.
 *
 * ## Why this verb needed one at all
 *
 * `write vanta deactivate` stops Vanta monitoring a finding and records the owner's reason against it. That
 * is visible to everyone reading the workspace and it moves a control's own count. Its door request has
 * always said `requiresApproval: false`; until this gate existed, nothing anywhere asked anyone anything, so
 * the label was decoration on the one verb in the program that mutates a compliance provider —
 * `src/admit/approval.ts` carries the whole finding.
 *
 * ## Why it is a `hold`, like `gmail send` and unlike the Slack duplicate gate
 *
 * The door's own contract decides it. A `warn` MUST carry an override token, so it is always waivable by
 * `$SLOPWEAVER_DOOR_OVERRIDE`, and an environment variable an agent can set is not an owner. A double post
 * to Slack is embarrassing and deletable; a finding Vanta has stopped watching is neither, and the reason
 * recorded against it is quoted back to auditors.
 *
 * ## What the digest covers, and what none of this proves
 *
 * The digest is taken over the batch AS IT WOULD BE SENT — every id, every reason, every until-date and
 * every reopen-when-fixable flag, in the order they would go out. So an approval cannot be transplanted:
 * add a finding to the batch, change one word of a reason, or drop an until-date, and the digest stops
 * matching. The id set alone is deliberately not enough, because the reason is the part an auditor reads.
 *
 * **It does not authenticate a human.** The same process that prints the digest can compute it. What it
 * buys is that the write is a SECOND deliberate act taken with the resolved request already on screen,
 * against a batch that cannot have changed underneath it, and that the unapproved attempt is refused AT THE
 * DOOR and recorded rather than silently skipped. Stating that bound is part of the design.
 */
import { createHash } from "node:crypto";

import { type ApprovalGate, approvalGate } from "../../admit/approval.js";
import type { DoorFinding } from "../../admit/types.js";
import type { VantaDeactivateUpdate } from "./vulnerabilityApiSchemas.js";

/** How many hex characters of the approval digest are printed and compared — as `gmail send` uses. */
const DIGEST_WIDTH = 16;

/** The finding code an unapproved or mismatched deactivation fires. */
export const DEACTIVATE_UNAPPROVED_CODE = "vanta.deactivate-unapproved";

/**
 * The digest an approval is bound to: a hash over exactly the batch that would be sent, and nothing else.
 *
 * The clock is not in it, so an approval does not expire while the operator reads the preview; the home,
 * the credentials and the `--json` choice are not in it, because none of them is what the operator checked. The
 * ORDER is significant — a reader who checked a list of findings checked that list.
 *
 * @param updates the batch as it would go to Vanta
 * @returns the leading hex characters of the SHA-256 over the canonical batch
 */
export function vantaDeactivateDigest({ updates }: { updates: readonly VantaDeactivateUpdate[] }): string {
  const canonical = JSON.stringify(
    updates.map((update) => ({
      deactivateReason: update.deactivateReason,
      deactivateUntilDate: update.deactivateUntilDate,
      id: update.id,
      shouldReactivateWhenFixable: update.shouldReactivateWhenFixable,
    })),
  );
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, DIGEST_WIDTH);
}

/**
 * Build the gate for one deactivation batch.
 *
 * Pure, and pure by construction: both digests are computed by the caller before the gate is built, so the
 * gate itself cannot reach Vanta mid-decision. It is marked by
 * {@link ../../admit/approval.approvalGate}, which is what lets this verb's door request declare
 * `requiresApproval` at all — the door refuses that claim when no marked gate is in the list.
 *
 * @param expected the digest of the batch as it stands right now
 * @param supplied what the caller passed to `--approve`, `null` when they passed nothing
 * @returns an `ApprovalGate` that holds unless the two match exactly
 */
export function vantaDeactivateApprovalGate({
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
        ? "this deactivation has not been approved — stopping monitoring on a finding is not an agent's to " +
          "decide alone"
        : `the approval ${supplied} does not match this batch (${expected}) — it was approved, then it changed`;
    return [
      {
        code: DEACTIVATE_UNAPPROVED_CODE,
        correction:
          `run --dry-run to see the exact request, then re-run with --approve ${expected}. ` +
          "That digest covers every id, reason, until-date and reopen flag exactly as shown; changing any " +
          "of them invalidates it. There is no override — this hold is not waivable by " +
          "$SLOPWEAVER_DOOR_OVERRIDE",
        severity: "hold",
        summary,
      },
    ];
  };
  return approvalGate({ gate });
}
