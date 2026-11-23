/**
 * Unit: the live mail thread an email-born ask card draws — its argv, its reader, and how it lays out.
 */
import { describe, expect, it } from "vitest";
import { readMailThread } from "../../components/live/readMailThread";
import { mailThreadLayout, oneLine, senderName } from "../../lib/mailThreadLayout";
import { mailThreadArgv } from "../../lib/mailThreadVerb";

/** One message as `gmail read --thread --json` prints it. */
function wire({ id, labels = ["INBOX"] }: { id: string; labels?: readonly string[] }): Record<string, unknown> {
  return {
    attachments: [],
    authored: `authored ${id}`,
    body: `authored ${id}\n\nOn Mon someone wrote:\n> older`,
    bodyFormat: "text",
    cc: [],
    from: "Alex Chen <alex.chen@othercompany.x.test>",
    htmlLinks: [],
    id,
    labelIds: labels,
    quotedCharsDropped: 30,
    sentAtIso: "2026-09-30T06:24:11.000Z",
    snippet: `snippet ${id}`,
    subject: "Re: Othercompany New CSM introduction",
    threadId: "2b1e0ad463527f9f",
    to: ["ada@acme.com"],
    unsubscribe: { kind: "none" },
  };
}

/** The whole document, as the verb prints it. */
function document({
  messages,
  unreadMessages = 0,
}: {
  messages: readonly Record<string, unknown>[];
  unreadMessages?: number;
}): Record<string, unknown> {
  return {
    coverage: { detail: "", kind: "bounded", residue: [] },
    data: { account: "ada@acme.com", messages, threadId: "2b1e0ad463527f9f", unreadMessages },
    readAtIso: "2026-10-01T06:23:02.914Z",
    source: "gmail",
    target: { address: "2b1e0ad463527f8c", identity: "ada@acme.com", kind: "thread" },
  };
}

describe("mailThreadArgv", () => {
  it("builds the literal thread read for a Gmail id", () => {
    expect(mailThreadArgv({ id: "2b1e0ad463527f8c" })).toEqual({
      argv: ["gmail", "read", "2b1e0ad463527f8c", "--thread", "--json"],
      kind: "argv",
      title: "slopweaver gmail read 2b1e0ad463527f8c --thread --json",
    });
  });

  it("refuses anything that is not sixteen hex digits, a flag above all", () => {
    expect(mailThreadArgv({ id: "--all" })).toEqual({
      kind: "refused",
      why: "the mail id is not a Gmail id (sixteen hex digits)",
    });
  });
});

describe("readMailThread", () => {
  it("reads every message, marking the owner's Gmail draft", () => {
    const thread = readMailThread({
      payload: document({ messages: [wire({ id: "a" }), wire({ id: "b", labels: ["DRAFT"] })] }),
    })!;
    expect(thread.account).toBe("ada@acme.com");
    expect(thread.threadId).toBe("2b1e0ad463527f9f");
    expect(thread.messages.map((message) => [message.id, message.draft, message.authored])).toEqual([
      ["a", false, "authored a"],
      ["b", true, "authored b"],
    ]);
  });

  it("reads a message with no sender or date as absent, never invented", () => {
    const bare = wire({ id: "a" });
    delete bare["from"];
    delete bare["sentAtIso"];
    const message = readMailThread({ payload: document({ messages: [bare] }) })!.messages[0];
    expect(message.from).toBe(undefined);
    expect(message.sentAtIso).toBe(undefined);
  });

  it("refuses the whole thread when one message lacks its authored text", () => {
    const old = wire({ id: "b" });
    delete old["authored"];
    expect(readMailThread({ payload: document({ messages: [wire({ id: "a" }), old] }) })).toBe(undefined);
  });

  it("refuses a document from another source", () => {
    expect(readMailThread({ payload: { ...document({ messages: [wire({ id: "a" })] }), source: "slack" } })).toBe(
      undefined,
    );
  });

  it("refuses a thread Gmail answered with no message, rather than drawing an empty one with no draft", () => {
    expect(readMailThread({ payload: document({ messages: [] }) })).toBe(undefined);
  });

  it("refuses a thread the verb read only part of", () => {
    expect(readMailThread({ payload: document({ messages: [wire({ id: "a" })], unreadMessages: 1 }) })).toBe(undefined);
  });

  it("refuses a document that does not say how many messages went unread", () => {
    const messages = [wire({ id: "a" })];
    const data = { account: "ada@acme.com", messages, threadId: "2b1e0ad463527f9f" };
    expect(readMailThread({ payload: { ...document({ messages }), data } })).toBe(undefined);
  });
});

describe("mailThreadLayout", () => {
  const m = ({ id, draft = false }: { id: string; draft?: boolean }): { id: string; draft: boolean } => ({
    draft,
    id,
  });

  it("opens the newest received message, rows the two before it, folds the middle, and puts the draft under", () => {
    const laid = mailThreadLayout({
      messages: [
        m({ id: "1" }),
        m({ id: "2" }),
        m({ id: "3" }),
        m({ id: "4" }),
        m({ id: "5" }),
        m({ draft: true, id: "d" }),
      ],
    });
    expect(laid.opener!.id).toBe("1");
    expect(laid.folded.map((x) => x.id)).toEqual(["2"]);
    expect(laid.recent.map((x) => x.id)).toEqual(["3", "4"]);
    expect(laid.open!.id).toBe("5");
    expect(laid.drafts.map((x) => x.id)).toEqual(["d"]);
  });

  it("draws a one-message thread open, with no opener row", () => {
    const laid = mailThreadLayout({ messages: [m({ id: "1" })] });
    expect(laid.opener).toBe(undefined);
    expect(laid.open!.id).toBe("1");
    expect(laid.folded).toEqual([]);
  });

  it("folds nothing when the thread is short", () => {
    const laid = mailThreadLayout({ messages: [m({ id: "1" }), m({ id: "2" }), m({ id: "3" })] });
    expect(laid.folded).toEqual([]);
    expect(laid.recent.map((x) => x.id)).toEqual(["2"]);
  });

  it("opens nothing on a thread that is only a draft", () => {
    const laid = mailThreadLayout({ messages: [m({ draft: true, id: "d" })] });
    expect(laid.open).toBe(undefined);
    expect(laid.drafts.map((x) => x.id)).toEqual(["d"]);
  });
});

describe("oneLine", () => {
  it("runs the lines together and cuts at a word", () => {
    expect(oneLine({ limit: 20, text: "Hi Ada,\r\n\r\nI can see your new account" })).toBe("Hi Ada, I can see…");
  });

  it("leaves a short line whole", () => {
    expect(oneLine({ limit: 80, text: "Cheers,\nDavid" })).toBe("Cheers, David");
  });
});

describe("senderName", () => {
  it("takes the display name", () => {
    expect(senderName({ from: "Alex Chen <alex.chen@othercompany.x.test>" })).toBe("Alex Chen");
  });

  it("takes the address when the name is empty or quoted as the address", () => {
    expect(senderName({ from: "<a@b.test>" })).toBe("a@b.test");
    expect(senderName({ from: '"ada@acme.com" <ada@acme.com>' })).toBe("ada@acme.com");
  });

  it("takes a bare address as it is", () => {
    expect(senderName({ from: "ada@acme.com" })).toBe("ada@acme.com");
  });
});
