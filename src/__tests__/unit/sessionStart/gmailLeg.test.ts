import { describe, expect, it } from "vitest";

import type { MailMessage, MailThread } from "../../../sessionStart/gmailLeg.js";
import {
  AGE_DAYS_CAP,
  gmailLeg,
  mailBackground,
  mailEvidence,
  mailItem,
  mailPermalink,
  mailReadings,
  mailRuleZero,
  outstandingThreads,
  senderName,
} from "../../../sessionStart/gmailLeg.js";

const NOW = "2026-08-31T00:00:00.000Z";

type MessageOverride = Partial<Omit<MailMessage, "sentAtIso" | "from" | "subject" | "snippet">> & {
  sentAtIso?: string | undefined;
  from?: string | undefined;
  subject?: string | undefined;
  snippet?: string | undefined;
};

const message = (over: MessageOverride = {}): MailMessage => ({
  from: "A Colleague <colleague@example.com>",
  labelIds: ["INBOX"],
  sentAtIso: "2026-08-30T00:00:00.000Z",
  snippet: "a reply with no question in it",
  subject: "Re: a subject",
  threadId: "thread-one",
  ...over,
});

const thread = (over: Partial<MailThread> = {}): MailThread => ({
  ownerLastIso: "2026-08-29T00:00:00.000Z",
  inbound: message(),
  inboundIso: "2026-08-30T00:00:00.000Z",
  threadId: "thread-one",
  ...over,
});

describe("senderName", () => {
  it("takes the display name when the header carries one", () => {
    expect(senderName({ from: "Ada Lovelace <ada@example.com>" })).toBe("Ada Lovelace");
  });

  it("strips the quotes a display name is sometimes wrapped in", () => {
    expect(senderName({ from: '"Ada Lovelace (via Docs)" <noreply@example.com>' })).toBe("Ada Lovelace (via Docs)");
  });

  it("falls back to the address when there is no display name", () => {
    expect(senderName({ from: "<ada@example.com>" })).toBe("ada@example.com");
  });

  it("takes a bare address with no angle brackets at all", () => {
    expect(senderName({ from: "ada@example.com" })).toBe("ada@example.com");
  });

  it("returns undefined for an absent header", () => {
    expect(senderName({ from: undefined })).toBeUndefined();
  });

  it("returns undefined for a header that is only whitespace", () => {
    expect(senderName({ from: "   " })).toBeUndefined();
  });
});

describe("outstandingThreads", () => {
  it("keeps a thread whose inbound message is later than the owner's last word", () => {
    const found = outstandingThreads({
      inbound: [message({ sentAtIso: "2026-08-30T00:00:00.000Z" })],
      sent: [message({ from: "the owner", sentAtIso: "2026-08-29T00:00:00.000Z" })],
    });
    expect(found).toHaveLength(1);
    expect(found[0]!.ownerLastIso).toBe("2026-08-29T00:00:00.000Z");
  });

  it("drops a thread the owner answered after the inbound message, which is the defect a live run caught", () => {
    const found = outstandingThreads({
      inbound: [message({ sentAtIso: "2026-08-24T05:24:40.000Z" })],
      sent: [message({ from: "the owner", sentAtIso: "2026-08-29T08:45:58.000Z" })],
    });
    expect(found).toStrictEqual([]);
  });

  it("drops a thread the owner never wrote in at all, which is how a copied-in thread is excluded", () => {
    expect(outstandingThreads({ inbound: [message()], sent: [] })).toStrictEqual([]);
  });

  it("drops a thread whose inbound message ties the owner's own timestamp exactly", () => {
    const at = "2026-08-29T00:00:00.000Z";
    expect(
      outstandingThreads({ inbound: [message({ sentAtIso: at })], sent: [message({ sentAtIso: at })] }),
    ).toStrictEqual([]);
  });

  it("drops an inbound message with no readable timestamp rather than assuming it is recent", () => {
    const found = outstandingThreads({
      inbound: [message({ sentAtIso: undefined })],
      sent: [message({ sentAtIso: "2026-08-29T00:00:00.000Z" })],
    });
    expect(found).toStrictEqual([]);
  });

  it("ignores one of the owner's own messages with no readable timestamp when finding the owner's last word", () => {
    const found = outstandingThreads({
      inbound: [message({ sentAtIso: "2026-08-30T00:00:00.000Z" })],
      sent: [message({ sentAtIso: undefined }), message({ sentAtIso: "2026-08-29T00:00:00.000Z" })],
    });
    expect(found[0]!.ownerLastIso).toBe("2026-08-29T00:00:00.000Z");
  });

  it("takes the owner's LATEST message in a thread, not the first one it read", () => {
    const found = outstandingThreads({
      inbound: [message({ sentAtIso: "2026-08-30T00:00:00.000Z" })],
      sent: [message({ sentAtIso: "2026-08-20T00:00:00.000Z" }), message({ sentAtIso: "2026-08-29T00:00:00.000Z" })],
    });
    expect(found[0]!.ownerLastIso).toBe("2026-08-29T00:00:00.000Z");
  });

  it("takes the LATEST inbound message when several arrived after the owner's reply", () => {
    const found = outstandingThreads({
      inbound: [
        message({ sentAtIso: "2026-08-29T12:00:00.000Z", subject: "earlier" }),
        message({ sentAtIso: "2026-08-30T12:00:00.000Z", subject: "later" }),
      ],
      sent: [message({ sentAtIso: "2026-08-29T00:00:00.000Z" })],
    });
    expect(found).toHaveLength(1);
    expect(found[0]!.inbound.subject).toBe("later");
  });

  it("orders the newest inbound first", () => {
    const found = outstandingThreads({
      inbound: [
        message({ sentAtIso: "2026-08-28T00:00:00.000Z", threadId: "older" }),
        message({ sentAtIso: "2026-08-30T00:00:00.000Z", threadId: "newer" }),
      ],
      sent: [
        message({ sentAtIso: "2026-08-01T00:00:00.000Z", threadId: "older" }),
        message({ sentAtIso: "2026-08-01T00:00:00.000Z", threadId: "newer" }),
      ],
    });
    expect(found.map((one) => one.threadId)).toStrictEqual(["newer", "older"]);
  });
});

describe("mailReadings", () => {
  it("claims somebody is stopped on the owner only when the reply asks something", () => {
    const asking = thread({ inbound: message({ snippet: "could you confirm the account name?" }) });
    expect(mailReadings({ nowIso: NOW, thread: asking }).stoppedOnOwner).toBe(5);
  });

  it("reads a question in the subject as an ask", () => {
    const asking = thread({ inbound: message({ snippet: "no question here", subject: "are we still on?" }) });
    expect(mailReadings({ nowIso: NOW, thread: asking }).stoppedOnOwner).toBe(5);
  });

  it("never claims somebody is stopped on the owner over a reply that asks nothing", () => {
    expect(mailReadings({ nowIso: NOW, thread: thread() }).stoppedOnOwner).toBe(0);
  });

  it("holds directness at its cap, because the detector proves the owner is in the conversation", () => {
    expect(mailReadings({ nowIso: NOW, thread: thread() }).directness).toBe(3);
  });

  it("reads STARRED as the owner's own explicit priority", () => {
    const starred = thread({ inbound: message({ labelIds: ["INBOX", "STARRED"] }) });
    expect(mailReadings({ nowIso: NOW, thread: starred }).explicitPriority).toBe(2);
  });

  it("never reads Gmail's own IMPORTANT guess as the owner's priority", () => {
    const important = thread({ inbound: message({ labelIds: ["INBOX", "IMPORTANT"] }) });
    expect(mailReadings({ nowIso: NOW, thread: important }).explicitPriority).toBe(0);
  });

  it("caps age however long the thread has been sitting", () => {
    const old = thread({ inboundIso: "2026-01-01T00:00:00.000Z" });
    expect(mailReadings({ nowIso: NOW, thread: old }).age).toBe(AGE_DAYS_CAP);
  });

  it("reads age as zero when the instant will not parse", () => {
    expect(mailReadings({ nowIso: NOW, thread: thread({ inboundIso: "not a date" }) }).age).toBe(0);
  });
});

describe("mailItem", () => {
  it("keys on Gmail's own thread id", () => {
    expect(mailItem({ thread: thread() })!.nativeId).toBe("thread-one");
  });

  it("links to the thread under #all, so the link survives the owner archiving it", () => {
    expect(mailPermalink({ thread: thread() })).toBe("https://mail.google.com/mail/u/0/#all/thread-one");
  });

  it("names the sender as who", () => {
    expect(mailItem({ thread: thread() })!.who).toBe("A Colleague");
  });

  it("refuses a thread whose sender cannot be named rather than rendering a blank cell", () => {
    expect(mailItem({ thread: thread({ inbound: message({ from: undefined }) }) })).toBeUndefined();
  });

  it("quotes the subject in what would count as done", () => {
    expect(mailItem({ thread: thread() })!.doneWhen).toBe(
      'Reply to A Colleague about "Re: a subject", which they answered after your last message',
    );
  });
});

describe("mailEvidence", () => {
  it("grades the thread order as a provider fact that does not show the work resolved", () => {
    const evidence = mailEvidence({ thread: thread() })[0]!;
    expect(evidence.grade).toBe("provider-fact");
    expect(evidence.showsResolved).toBe(false);
    expect(evidence.source).toBe("https://mail.google.com/mail/u/0/#all/thread-one");
  });
});

describe("mailRuleZero", () => {
  it("shows every thread, because the detector only ever produces the owner's move", () => {
    expect(mailRuleZero({ nowIso: NOW, thread: thread() }).verdict).toBe("show");
  });
});

describe("gmailLeg", () => {
  it("marks every row verified, because both listings are live reads", () => {
    expect(gmailLeg({ nowIso: NOW, threads: [thread()] })[0]!.unverified).toBe(false);
  });

  it("marks every row as finishing in-flight work, which is the tiebreak", () => {
    expect(gmailLeg({ nowIso: NOW, threads: [thread()] })[0]!.finishesInFlight).toBe(true);
  });

  it("drops a thread that cannot fill its mandatory fields", () => {
    expect(gmailLeg({ nowIso: NOW, threads: [thread({ inbound: message({ from: undefined }) })] })).toStrictEqual([]);
  });

  it("produces nothing at all from an empty mailbox, which is an answer rather than a failure", () => {
    expect(gmailLeg({ nowIso: NOW, threads: [] })).toStrictEqual([]);
  });
});

describe("mailItem with awkward headers", () => {
  it("names a thread with no subject rather than quoting an empty string", () => {
    const item = mailItem({ thread: thread({ inbound: message({ subject: undefined }) }) })!;
    expect(item.doneWhen).toBe(
      "Reply to A Colleague about a thread with no subject, which they answered after your last message",
    );
  });

  it("takes the display name when the address itself contains angle brackets in the name", () => {
    expect(senderName({ from: "Ada <the coder> <ada@example.com>" })).toBe("Ada <the coder>");
  });

  it("reads a header that is only an empty pair of brackets as unnameable", () => {
    expect(senderName({ from: "<>" })).toBeUndefined();
  });
});

describe("mailBackground", () => {
  it("names the subject and the sender, and quotes what they actually wrote", () => {
    expect(mailBackground({ thread: thread() })).toBe(
      'An email conversation you wrote into, "Re: a subject", and A Colleague has replied since your last message. Their message opens: "a reply with no question in it"',
    );
  });

  it("says there is no subject rather than quoting an empty one", () => {
    const bare = thread({ inbound: message({ subject: undefined }) });
    expect(mailBackground({ thread: bare })).toContain("a thread with no subject");
  });

  it("leaves the quote off entirely when the listing carried no snippet", () => {
    const quiet = thread({ inbound: message({ snippet: undefined }) });
    expect(mailBackground({ thread: quiet })).toBe(
      'An email conversation you wrote into, "Re: a subject", and A Colleague has replied since your last message.',
    );
  });
});
