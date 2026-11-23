/**
 * The door gate between a planned calendar write and the people it reaches — the same shape as
 * `../gmail/approvalGate.ts`, and a `hold` for the same reason: an invitation, a reschedule or a
 * cancellation lands in other people's diaries and inboxes, and an environment variable an agent can set is
 * not an owner.
 *
 * The gate compares the digest an approval names against the digest of the plan AS IT STANDS NOW — rebuilt at
 * commit time from the stored form against the event Google holds — so an approval cannot be transplanted onto
 * a change nobody read. An approval names its digest one of two ways: `--approve <digest>`, or `--anchor <where
 * the owner said yes>`, which names the digest the PREVIEW printed (the owner steers on the voice
 * and never types a digest). What it does not do, stated as the Gmail gate states it: it does not authenticate a
 * human. It makes the send a second deliberate step against content that cannot have moved underneath it, and
 * records the unapproved attempt.
 */
import { type ApprovalGate, approvalGate } from "../../admit/approval.js";
import type { DoorFinding } from "../../admit/types.js";

/** The finding code an unapproved or mismatched outward calendar write fires. */
export const CALENDAR_WRITE_UNAPPROVED_CODE = "calendar.write-unapproved";

/** The approval a commit carried, with the digest it binds; absent when it carried none. */
export type CalendarWriteApproval =
  | { readonly kind: "digest"; readonly digest: string }
  | { readonly kind: "anchor"; readonly anchor: string; readonly previewDigest: string };

/** The digest an approval binds. */
function boundDigest({ approval }: { approval: CalendarWriteApproval }): string {
  return approval.kind === "digest" ? approval.digest : approval.previewDigest;
}

/** One line saying why the write holds, by what the commit carried. */
function holdSummary({
  approval,
  expected,
}: {
  approval: CalendarWriteApproval | undefined;
  expected: string;
}): string {
  if (approval === undefined) {
    return "this write reaches someone other than the owner and has not been approved — an invitation, a reschedule or a cancellation is not an agent's to send alone";
  }
  if (approval.kind === "anchor") {
    return `the owner's yes at ${approval.anchor} was given over the preview ${approval.previewDigest}, and this write now digests to ${expected} — the event or the form changed since it was shown`;
  }
  return `the approval ${approval.digest} does not match this write (${expected}) — it was approved, then the event or the form changed`;
}

/**
 * Build the gate for one outward write attempt.
 *
 * @param expected the digest of the plan as it stands right now
 * @param approval what the commit carried as the owner's approval, absent when it carried none
 * @param intentId the intent the digest belongs to, for the correction line
 * @returns an `ApprovalGate` that holds unless the approval binds exactly this digest
 */
export function calendarWriteApprovalGate({
  expected,
  approval,
  intentId,
}: {
  expected: string;
  approval: CalendarWriteApproval | undefined;
  intentId: string;
}): ApprovalGate {
  const gate = (): readonly DoorFinding[] => {
    if (approval !== undefined && boundDigest({ approval }) === expected) {
      return [];
    }
    const correction =
      approval === undefined
        ? `tell the owner what the preview above does — on the voice is fine — and once the owner says yes, run: slopweaver calendar commit ${intentId} --anchor <where the owner said yes>. ` +
          "Never ask the owner for a digest, and never pass --approve with a digest you printed yourself. "
        : "re-run the verb for a fresh preview and get the owner's yes on the change as it stands now. ";
    return [
      {
        code: CALENDAR_WRITE_UNAPPROVED_CODE,
        correction:
          correction +
          "The digest covers the event, the exact change and the attendees before and after; any drift " +
          "invalidates it. There is no override — this hold is not waivable by $SLOPWEAVER_DOOR_OVERRIDE",
        severity: "hold",
        summary: holdSummary({ approval, expected }),
      },
    ];
  };
  return approvalGate({ gate });
}
