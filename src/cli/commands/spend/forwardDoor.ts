/**
 * The door request one stored `spend forward` draft makes. Split from `./forwardRun.ts`, which routes it.
 */
import type { throughDoor } from "../../../admit/effects.js";
import type { applyGmailForwardDraft } from "../../../live/gmail/forward.js";

/**
 * The door request one stored forward makes: counts and sizes only, never the receipt's content.
 *
 * @param home the state home the decision is journalled into
 * @param plan the planned forward draft
 * @param receiptId the receipt message being forwarded
 * @returns the request the door judges
 */
export function forwardDoorRequest({
  home,
  plan,
  receiptId,
}: {
  home: string;
  plan: Parameters<typeof applyGmailForwardDraft>[0]["plan"];
  receiptId: string;
}): Parameters<typeof throughDoor>[0]["request"] {
  const attachmentBytes = plan.attachments.reduce((total, file) => total + file.bytes.byteLength, 0);
  return {
    action: { kind: "verb", noun: "spend", verb: "forward" },
    artifact: { attachmentBytes, attachments: plan.attachments.length, receiptId, to: plan.to.length },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}
