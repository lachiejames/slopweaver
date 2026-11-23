/**
 * What the Gmail guard reads off one request, pure: which hosts are Gmail's, which routes are reads (method AND path),
 * what a write is named in a refusal, which strings of a body and an address are judged, where a `raw` MIME message is
 * set apart to be decoded, the re-read draft a send carries, and the one-click unsubscribe POST's leaves. The routes
 * the pinned SDK really emits are measured in `../../live/gmail/guardedFetch.test.ts`; these cases pin the rules.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  gmailJsonBody,
  gmailOneClickRequest,
  gmailRequestCommand,
  gmailWriteRequest,
  isGmailApiRequest,
  isGmailDraftSend,
  isGmailReadRequest,
} from "../../../../outbound/gmail/writePrivacyPayload.js";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** A URL under the Gmail API root. */
const at = ({ path }: { path: string }): URL => new URL(`${API}${path}`);

/** A message's text as Gmail's `raw` carries it. */
const raw = ({ text }: { text: string }): string => Buffer.from(text, "utf8").toString("base64url");

describe("which requests are Gmail's", () => {
  it("is Gmail's on gmail.googleapis.com, and on www.googleapis.com only under a Gmail path", () => {
    expect(isGmailApiRequest({ url: at({ path: "/labels" }) })).toBe(true);
    expect(isGmailApiRequest({ url: new URL("https://www.googleapis.com/gmail/v1/users/me/labels") })).toBe(true);
    expect(isGmailApiRequest({ url: new URL("https://www.googleapis.com/upload/gmail/v1/users/me/drafts") })).toBe(
      true,
    );
    expect(isGmailApiRequest({ url: new URL("https://oauth2.googleapis.com/token") })).toBe(false);
    expect(isGmailApiRequest({ url: new URL("https://docs.googleapis.com/v1/documents/d1") })).toBe(false);
    expect(isGmailApiRequest({ url: new URL("https://www.googleapis.com/calendar/v3/users/me") })).toBe(false);
  });
});

describe("which Gmail requests are reads", () => {
  it("lists the door's reads on GET only, and nothing else", () => {
    const reads = [
      "/messages",
      "/messages/m1",
      "/messages/m1/attachments/a1",
      "/threads/t1",
      "/labels",
      "/profile",
      "/history",
      "/drafts/d1",
    ];
    expect(reads.map((path) => isGmailReadRequest({ method: "GET", url: at({ path }) }))).toEqual(
      reads.map(() => true),
    );
    expect(reads.map((path) => isGmailReadRequest({ method: "POST", url: at({ path }) }))).toEqual(
      reads.map(() => false),
    );
  });

  it("treats a GET nobody listed, and every write, as a write", () => {
    expect(isGmailReadRequest({ method: "GET", url: at({ path: "/drafts" }) })).toBe(false);
    expect(isGmailReadRequest({ method: "GET", url: at({ path: "/settings/filters" }) })).toBe(false);
    expect(isGmailReadRequest({ method: "POST", url: at({ path: "/messages/m1/modify" }) })).toBe(false);
    expect(isGmailReadRequest({ method: "DELETE", url: at({ path: "/messages/m1" }) })).toBe(false);
  });

  it("names drafts.send only on its POST", () => {
    expect(isGmailDraftSend({ method: "POST", url: at({ path: "/drafts/send" }) })).toBe(true);
    expect(isGmailDraftSend({ method: "GET", url: at({ path: "/drafts/send" }) })).toBe(false);
    expect(isGmailDraftSend({ method: "POST", url: at({ path: "/drafts" }) })).toBe(false);
  });
});

describe("gmailRequestCommand", () => {
  it("names a known write by its SDK method and an unknown one by its path with every id withheld", () => {
    expect(gmailRequestCommand({ method: "post", url: at({ path: "/messages/18c0ffee/modify" }) })).toBe(
      "gmail messages.modify",
    );
    expect(gmailRequestCommand({ method: "POST", url: at({ path: "/threads/t1/modify" }) })).toBe(
      "gmail threads.modify",
    );
    expect(gmailRequestCommand({ method: "POST", url: at({ path: "/drafts" }) })).toBe("gmail drafts.create");
    expect(gmailRequestCommand({ method: "POST", url: at({ path: "/drafts/send" }) })).toBe("gmail drafts.send");
    expect(gmailRequestCommand({ method: "POST", url: at({ path: "/messages/18c0ffee/trash" }) })).toBe(
      "gmail POST /gmail/v1/users/me/messages/{id}/trash",
    );
  });
});

describe("gmailJsonBody", () => {
  it("judges every string leaf, label ids included, and sets every raw message apart", () => {
    const body = JSON.stringify({ addLabelIds: ["Label_7"], message: { raw: "cmF3", threadId: "t1" } });
    expect(unwrap(gmailJsonBody({ body, command: "gmail x" }))).toEqual({
      leaves: [
        { locus: "gmail x addLabelIds[0]", text: "Label_7" },
        { locus: "gmail x message.threadId", text: "t1" },
      ],
      raws: [{ locus: "gmail x message.raw", raw: "cmF3" }],
    });
  });

  it("is empty for no body, and refuses a body that is not JSON", () => {
    expect(unwrap(gmailJsonBody({ body: undefined, command: "gmail x" }))).toEqual({ leaves: [], raws: [] });
    expect(unwrapErr(gmailJsonBody({ body: "not json", command: "gmail x" })).message).toBe(
      "gmail x: a request body that is not JSON, so it cannot be judged",
    );
  });
});

describe("gmailWriteRequest", () => {
  it("judges a modify's path and query, and its label ids", async () => {
    const request = await gmailWriteRequest({
      body: JSON.stringify({ addLabelIds: ["STARRED"], removeLabelIds: [] }),
      draft: undefined,
      method: "POST",
      url: at({ path: "/messages/m1/modify?fields=id" }),
    });
    expect(request.command).toBe("gmail messages.modify");
    expect(unwrap(request.leaves)).toEqual([
      { locus: "gmail messages.modify path", text: "/gmail/v1/users/me/messages/m1/modify" },
      { locus: "gmail messages.modify query.fields", text: "id" },
      { locus: "gmail messages.modify addLabelIds[0]", text: "STARRED" },
    ]);
  });

  it("decodes a draft's raw message into leaves, and hands the decoded text to the dead-host walk", async () => {
    const body = JSON.stringify({ message: { raw: raw({ text: "Subject: hi\r\n\r\nsee the notes\r\n" }) } });
    const request = await gmailWriteRequest({ body, draft: undefined, method: "POST", url: at({ path: "/drafts" }) });
    expect(unwrap(request.leaves).map((leaf) => leaf.locus)).toEqual([
      "gmail drafts.create path",
      "gmail drafts.create message.raw subject",
      "gmail drafts.create message.raw text",
    ]);
    expect(request.payload).toEqual({
      body,
      decoded: ["/gmail/v1/users/me/drafts", "hi", "see the notes\n"],
      url: `${API}/drafts`,
    });
  });

  it("refuses a drafts.create carrying no raw message", async () => {
    const request = await gmailWriteRequest({
      body: JSON.stringify({ message: { threadId: "t1" } }),
      draft: undefined,
      method: "POST",
      url: at({ path: "/drafts" }),
    });
    expect(unwrapErr(request.leaves).message).toBe(
      "gmail drafts.create: a draft carrying no message.raw, so there is nothing to judge it by",
    );
  });

  it("judges a send on the draft it re-read, and refuses when that re-read failed", async () => {
    const send = { body: JSON.stringify({ id: "d1" }), method: "POST", url: at({ path: "/drafts/send" }) };
    const judged = await gmailWriteRequest({ ...send, draft: ok(raw({ text: "Subject: sent\r\n\r\nb\r\n" })) });
    expect(unwrap(judged.leaves).filter((leaf) => leaf.locus.includes("draft.raw"))).toEqual([
      { locus: "gmail drafts.send draft.raw subject", text: "sent" },
      { locus: "gmail drafts.send draft.raw text", text: "b\n" },
    ]);
    const failed = await gmailWriteRequest({
      ...send,
      draft: err({ message: "the draft could not be re-read before sending" }),
    });
    expect(unwrapErr(failed.leaves).message).toBe("gmail drafts.send: the draft could not be re-read before sending");
  });

  it("refuses a send whose re-read draft carries malformed base64url", async () => {
    const send = { body: JSON.stringify({ id: "d1" }), method: "POST", url: at({ path: "/drafts/send" }) };
    const judged = await gmailWriteRequest({ ...send, draft: ok("not+base64url") });
    expect(unwrapErr(judged.leaves).message).toBe(
      "gmail drafts.send draft.raw: a raw message that is not base64url, so it cannot be judged",
    );
  });
});

describe("gmailOneClickRequest", () => {
  it("judges the sender's whole URL, tokens included, the body and the content type", () => {
    const url = new URL("https://mail.example.test/u/token-1?list=weekly");
    const request = gmailOneClickRequest({ body: "List-Unsubscribe=One-Click", contentType: "a/b", url });
    expect(request.command).toBe("gmail unsubscribe one-click");
    expect(unwrap(request.leaves)).toEqual([
      { locus: "gmail unsubscribe one-click url", text: "https://mail.example.test/u/token-1?list=weekly" },
      { locus: "gmail unsubscribe one-click body", text: "List-Unsubscribe=One-Click" },
      { locus: "gmail unsubscribe one-click content-type", text: "a/b" },
    ]);
  });
});
