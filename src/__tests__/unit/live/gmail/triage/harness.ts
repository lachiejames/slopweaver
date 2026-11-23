/*
 * What the `gmail triage` test files share: the instant a reading is taken at, and one synthetic inbox message.
 * Every message here is synthetic: mail content never enters a fixture. It moved here when the triage suite was
 * split by behaviour.
 */
import type { GmailMessage } from "../../../../../live/gmail/parse.js";
import type { GmailTriagePolicy } from "../../../../../live/gmail/triageRules.js";

/** The instant every reading in these files is taken at. */
export const READ_AT: string = "2026-09-30T08:00:00.000Z";

/** The anchor a synthetic `last-reply` rule carries. */
export const LAST_REPLY_ANCHOR = "knowledge:l-0000000000000101";

/** The anchor a synthetic `passed-invite` rule carries. */
export const PASSED_INVITE_ANCHOR = "knowledge:l-0000000000000102";

/**
 * A synthetic install that switched every lane on and declared no sender row: what a test of a lane's MECHANISM
 * reads under, since the code ships none of them on.
 */
export const EVERY_LANE_POLICY: GmailTriagePolicy = {
  delegates: [
    { anchor: "knowledge:l-0000000000000103", kind: "fathom-clear-inbox", why: "its verb ingests and archives it" },
    {
      anchor: "knowledge:l-0000000000000104",
      kind: "gmail-clear-meeting-notes",
      why: "its verb proves the transcript and archives it",
    },
  ],
  gatedRules: [],
  rules: [],
  structuralRules: [
    { anchor: LAST_REPLY_ANCHOR, kind: "last-reply", why: "nobody is waiting on the owner" },
    { anchor: PASSED_INVITE_ANCHOR, kind: "passed-invite", why: "the meeting already happened" },
  ],
};

/**
 * One synthetic inbox message; `atIso` becomes Gmail's `internalDate`.
 *
 * @returns an inbox message on its own `t-<id>` thread, unread when asked, carrying any `extra` headers
 */
export function message({
  id,
  from,
  atIso,
  subject = "a subject",
  unread = false,
  extra = [],
}: {
  id: string;
  from: string | undefined;
  atIso: string | undefined;
  subject?: string;
  unread?: boolean;
  extra?: readonly { name: string; value: string }[];
}): GmailMessage {
  const headers = [...(from === undefined ? [] : [{ name: "From", value: from }]), { name: "Subject", value: subject }];
  return {
    id,
    ...(atIso === undefined ? {} : { internalDate: String(Date.parse(atIso)) }),
    labelIds: unread ? ["INBOX", "UNREAD"] : ["INBOX"],
    payload: { headers: [...headers, ...extra] },
    threadId: `t-${id}`,
  };
}
