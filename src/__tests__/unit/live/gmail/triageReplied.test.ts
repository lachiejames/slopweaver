/**
 * "The last reply is the owner's" — judged on a thread's newest message alone, and never guessed when the thread
 * cannot say.
 */
import { describe, expect, it } from "vitest";

import type { GmailMessage } from "../../../../live/gmail/parse.js";
import { lastMessageIsOwners } from "../../../../live/gmail/triageReplied.js";

/** One message of a thread: its own instant as Gmail's `internalDate`, and the owner's own when it carries SENT. */
function at({
  id,
  internalDate,
  sent,
  labelIds,
  subject = "Re: the contract",
}: {
  id: string;
  internalDate: string | undefined;
  sent: boolean;
  labelIds?: readonly string[];
  subject?: string;
}): GmailMessage {
  let labels: string[] = sent ? ["SENT"] : ["INBOX"];
  if (labelIds !== undefined) {
    labels = [...labelIds];
  }
  return {
    id,
    ...(internalDate === undefined ? {} : { internalDate }),
    labelIds: labels,
    payload: { headers: [{ name: "Subject", value: subject }] },
    threadId: "t",
  };
}

describe("lastMessageIsOwners", () => {
  it("is true when the owner's reply is the newest message, whatever order the thread arrives in", () => {
    const thread = [
      at({ id: "owner", internalDate: "2000", sent: true }),
      at({ id: "theirs", internalDate: "1000", sent: false }),
    ];
    expect(lastMessageIsOwners({ thread })).toBe(true);
  });

  it("is false once someone answers after the owner", () => {
    const thread = [
      at({ id: "owner", internalDate: "1000", sent: true }),
      at({ id: "theirs", internalDate: "2000", sent: false }),
    ];
    expect(lastMessageIsOwners({ thread })).toBe(false);
  });

  it("is false for an empty thread", () => {
    expect(lastMessageIsOwners({ thread: [] })).toBe(false);
  });

  it("is false when any message's instant is missing, unparseable or zero, rather than guessing the order", () => {
    const ownerReply = at({ id: "owner", internalDate: "2000", sent: true });
    expect(
      [undefined, "not-a-number", "0"].map((internalDate) =>
        lastMessageIsOwners({ thread: [ownerReply, at({ id: "theirs", internalDate, sent: false })] }),
      ),
    ).toEqual([false, false, false]);
  });

  it("is false when the owner's newest message forwards the thread on, whatever the client's spelling", () => {
    const theirs = at({ id: "theirs", internalDate: "1000", sent: false });
    expect(
      ["Fwd: the contract", "FW: the contract", " fw : the contract"].map((subject) =>
        lastMessageIsOwners({ thread: [theirs, at({ id: "owner", internalDate: "2000", sent: true, subject })] }),
      ),
    ).toEqual([false, false, false]);
  });

  it("is false when the owner's newest message also sits in their inbox, a note they sent themselves", () => {
    const thread = [
      at({ id: "theirs", internalDate: "1000", sent: false }),
      at({ id: "note", internalDate: "2000", labelIds: ["SENT", "INBOX"], sent: true }),
    ];
    expect(lastMessageIsOwners({ thread })).toBe(false);
  });

  it("is false when two messages tie for newest, even if one is the owner's", () => {
    const thread = [
      at({ id: "owner", internalDate: "2000", sent: true }),
      at({ id: "theirs", internalDate: "2000", sent: false }),
    ];
    expect(lastMessageIsOwners({ thread })).toBe(false);
  });
});
