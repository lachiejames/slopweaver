/**
 * The door gate that stands between a composed draft and a person's inbox, for every mail door.
 *
 * ## Why this one is a `hold` when the Slack duplicate gate is a `warn`
 *
 * The door's contract makes the choice for us. A `warn` MUST carry an override token, so it is always
 * waivable by `$SLOPWEAVER_DOOR_OVERRIDE`; a `hold` cannot carry one and cannot be waived. `docs/security/mail-boundary.md`
 * and this repository's standing "AI suggests, owner approves" rule both put mail to another person on the
 * side of the line where an agent may not proceed alone, and an environment variable an agent can set is
 * not an owner. Double-posting to Slack is embarrassing and deletable. Mail is neither.
 *
 * ## What the gate actually checks, and what it does NOT prove
 *
 * It compares the digest supplied with `--approve` against the digest of the draft AS IT IS NOW, recomputed
 * at send time from the message the provider holds. So:
 *
 * - an unapproved send is refused, and the refusal is recorded in the ledger rather than being a silent
 *   `return`;
 * - an approval cannot be transplanted onto different content — edit the draft after it was approved and
 *   the digest stops matching, which is the whole reason the digest covers content rather than the draft id.
 *
 * **It does not authenticate a human, and nothing here should be read as claiming it does.** The same
 * process that prints the digest can compute it, exactly as `slopweaver handover answer` records an
 * authorisation without authenticating one. What it buys is that sending is a SECOND deliberate act taken
 * with the full preview already on screen, against content that cannot have changed underneath it. That is
 * a real property and a bounded one, and stating the bound is the point — a gate believed to do more than
 * it does is worse than one whose limit is written down.
 *
 * Each door keeps its own finding code (`gmail.send-unapproved`, `outlook.send-unapproved`), so a ledger row
 * says which mailbox a refused send was aimed from; the rule itself is this one function.
 */
import { type ApprovalGate, approvalGate } from "../../admit/approval.js";
import type { DoorFinding } from "../../admit/types.js";

/**
 * Build the gate for one send attempt.
 *
 * Pure, and pure by construction: both digests are computed by the caller before the gate is built, so the
 * gate itself cannot reach a mailbox mid-decision.
 *
 * It is marked by {@link ../../admit/approval.approvalGate}, which is what lets a send's door request declare
 * `requiresApproval` at all: the door refuses a request making that claim with no marked gate in its list,
 * so the mark and the claim stand or fall together.
 *
 * @param code the door's own finding code for an unapproved send
 * @param expected the digest of the draft as it stands right now
 * @param supplied what the caller passed to `--approve`, absent when they passed nothing
 * @returns an `ApprovalGate` that holds unless the two match exactly
 */
export function mailSendApprovalGate({
  code,
  expected,
  supplied,
}: {
  code: string;
  expected: string;
  supplied: string | undefined;
}): ApprovalGate {
  const gate = (): readonly DoorFinding[] => {
    if (supplied === expected) {
      return [];
    }
    // The supplied text is never echoed: the summary is journalled to the door ledger, and `--approve` is free
    // text a caller could fill with a message id or an address. Only the digest this code computed is named.
    const summary =
      supplied === undefined
        ? "this send has not been approved — mail to another person is not an agent's to send alone"
        : `the approval supplied does not match this draft (now ${expected}) — it was approved, then it changed`;
    return [
      {
        code,
        correction:
          `review the preview above, then re-run with --approve ${expected}. ` +
          "That digest covers the recipients, subject and body exactly as shown; editing the draft " +
          "invalidates it. There is no override — this hold is not waivable by $SLOPWEAVER_DOOR_OVERRIDE",
        severity: "hold",
        summary,
      },
    ];
  };
  return approvalGate({ gate });
}
