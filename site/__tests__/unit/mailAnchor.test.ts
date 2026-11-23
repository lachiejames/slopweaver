/**
 * Unit: the Gmail thread an ask row names, read off its anchor or its own prose.
 */
import { describe, expect, it } from "vitest";
import { askMailThread, gmailAddressOf, mailThreadOf } from "../../lib/mailAnchor";

/** A vendor contact's ask, in the shape the inbox lane registers one. */
const VENDOR_ASK =
  "Alex Chen (Othercompany CSM) asked you directly, earlier, in 'Re: Othercompany New CSM introduction' (gmail 2b1e0ad463527f8c, thread 2b1e0ad463527f9f): 'What workload are you planning to move to the new account and by when?'";

describe("mailThreadOf", () => {
  it("takes the thread id over the message id when the prose names both", () => {
    expect(mailThreadOf({ anchor: undefined, texts: [VENDOR_ASK] })).toEqual({
      id: "2b1e0ad463527f9f",
      url: "https://mail.google.com/mail/u/0/#all/2b1e0ad463527f9f",
    });
  });

  it("falls back to a message id when the prose names no thread", () => {
    expect(mailThreadOf({ anchor: undefined, texts: ["re the owner's mail (gmail 2b1e0ad463527f8c)."] })!.id).toBe(
      "2b1e0ad463527f8c",
    );
  });

  it("prefers a Gmail address in the published anchor over the prose", () => {
    const thread = mailThreadOf({
      anchor: "https://mail.google.com/mail/u/0/#inbox/2b1e0ad463527fbb",
      texts: [VENDOR_ASK],
    });
    expect(thread!.id).toBe("2b1e0ad463527fbb");
  });

  it("reads a Gmail address written in the prose when no id word names one", () => {
    const thread = mailThreadOf({
      anchor: undefined,
      texts: ["the reply sits at https://mail.google.com/mail/u/0/#label/Vendors/2b1e0ad463527fbb, unanswered"],
    });
    expect(thread!.id).toBe("2b1e0ad463527fbb");
  });

  it("reads a later text when the first names no mail", () => {
    expect(mailThreadOf({ anchor: undefined, texts: ["no mail here", "thread 2b1e0ad463527f9f"] })!.id).toBe(
      "2b1e0ad463527f9f",
    );
  });

  it("names nothing on a Slack-born row", () => {
    expect(
      mailThreadOf({
        anchor: "https://acme.slack.com/archives/C0SYN4E1234567/p1789717308365179",
        texts: ["Rosa asked in the thread whether the pool exhausted"],
      }),
    ).toBe(undefined);
  });

  it("refuses an id that is not sixteen hex digits, or one run into more letters", () => {
    expect(mailThreadOf({ anchor: undefined, texts: ["thread 2b1e0ad463527f9", "gmail 2b1e0ad463527f8czz"] })).toBe(
      undefined,
    );
  });
});

describe("askMailThread", () => {
  it("reads the ids out of the summary when the question carries none", () => {
    const thread = askMailThread({
      replyTo: undefined,
      row: {
        anchor: undefined,
        question: "How should the reply go?",
        reason: "waiting on the owner's word",
        summary: VENDOR_ASK,
      },
    });
    expect(thread).toEqual({
      id: "2b1e0ad463527f9f",
      url: "https://mail.google.com/mail/u/0/#all/2b1e0ad463527f9f",
    });
  });

  it("draws the message an offered reply answers ahead of any id the prose names", () => {
    const row = { anchor: undefined, question: "Send it?", reason: "r", summary: VENDOR_ASK };
    expect(askMailThread({ replyTo: "2b1e0ad463527fae", row })).toEqual({
      id: "2b1e0ad463527fae",
      url: "https://mail.google.com/mail/u/0/#all/2b1e0ad463527fae",
    });
  });

  it("draws a reply's thread on a row whose words name no mail at all", () => {
    const row = { anchor: undefined, question: "Send it?", reason: "r", summary: undefined };
    expect(askMailThread({ replyTo: "2b1e0ad463527fae", row })!.id).toBe("2b1e0ad463527fae");
  });

  it("reads the ids out of a detached ask's read reason, which sit inside its reason", () => {
    const row = {
      anchor: undefined,
      question: "Ship it?",
      reason: "its doc would not read, so it needs repairing before anything else",
      reasonWhy: "thread 2b1e0ad463527f9f",
      summary: undefined,
    };
    expect(askMailThread({ replyTo: undefined, row })!.id).toBe("2b1e0ad463527f9f");
  });

  it("names nothing on a row with no mail anywhere", () => {
    const row = { anchor: undefined, question: undefined, reason: "r", summary: undefined };
    expect(askMailThread({ replyTo: undefined, row })).toBe(undefined);
  });
});

describe("gmailAddressOf", () => {
  it("writes the corpus's own Gmail address form", () => {
    expect(gmailAddressOf({ id: "2b1e0ad463527f9f" })).toBe("https://mail.google.com/mail/u/0/#all/2b1e0ad463527f9f");
  });
});
