/**
 * Which inbox mail `gmail triage` holds out of its groups, because the install hands it to another verb: Fathom's mail
 * to `fathom clear-inbox`, Google's meeting-notes mail to `gmail clear-meeting-notes`. A card about either sender would
 * ask the owner to rule on mail a verb already ingests and archives. Both are delegates an install switches on
 * (`./triageRules.ts`); with neither declared, that mail groups and is carded like any other.
 */
import { isFathomMailSender } from "../../corpus/fathom/mail.js";
import { isMeetingNotesSender } from "../../corpus/gmail/geminiNotes.js";
import { delegateEnabled, type GmailTriagePolicy } from "./triageRules.js";

/** A held-out lane, named for the document field its ids are kept in. */
export type HeldOutLane = "fathom" | "meetingNotes";

/**
 * The lanes an install's policy switches on. Pure.
 *
 * @param policy the install's policy
 * @returns each lane whose delegate the install declared
 */
export function heldOutLanesOf({ policy }: { policy: GmailTriagePolicy }): ReadonlySet<HeldOutLane> {
  const lanes = new Set<HeldOutLane>();
  if (delegateEnabled({ kind: "fathom-clear-inbox", policy })) {
    lanes.add("fathom");
  }
  if (delegateEnabled({ kind: "gmail-clear-meeting-notes", policy })) {
    lanes.add("meetingNotes");
  }
  return lanes;
}

/**
 * The lane a sender's mail is held out of triage in, or `undefined` when triage groups it. Pure.
 *
 * @param address the sender address, lower-cased
 * @param lanes the lanes the install switched on; a sender whose lane is off is grouped
 * @returns the lane, or `undefined`
 */
export function heldOutLane({
  address,
  lanes,
}: {
  address: string;
  lanes: ReadonlySet<HeldOutLane>;
}): HeldOutLane | undefined {
  if (lanes.has("fathom") && isFathomMailSender({ address })) {
    return "fathom";
  }
  if (lanes.has("meetingNotes") && isMeetingNotesSender({ address })) {
    return "meetingNotes";
  }
  return undefined;
}
