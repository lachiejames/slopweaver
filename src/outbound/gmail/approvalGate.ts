/**
 * The Gmail door's send gate: the shared mail approval gate (`../mail/approvalGate.ts`, which carries the
 * reasoning and the bound) under Gmail's own finding code.
 */
import type { ApprovalGate } from "../../admit/approval.js";
import { mailSendApprovalGate } from "../mail/approvalGate.js";

/** The finding code an unapproved or mismatched send fires. */
export const SEND_UNAPPROVED_CODE = "gmail.send-unapproved";

/**
 * Build the gate for one `gmail send` attempt.
 *
 * @param expected the digest of the draft as it stands right now
 * @param supplied what the caller passed to `--approve`, absent when they passed nothing
 * @returns an `ApprovalGate` that holds unless the two match exactly
 */
export function gmailSendApprovalGate({
  expected,
  supplied,
}: {
  expected: string;
  supplied: string | undefined;
}): ApprovalGate {
  return mailSendApprovalGate({ code: SEND_UNAPPROVED_CODE, expected, supplied });
}
