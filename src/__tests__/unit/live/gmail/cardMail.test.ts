/**
 * Unit: a triage card's stored mail — where each body is found, how it is cut, the capture that fetches it, the
 * store that keeps it, and the two reads the Queue takes over it.
 *
 * Every message here is synthetic: no real mail, address or Gmail id enters a fixture. The store is a real round trip
 * into a `mkdtempSync` home; Gmail is a plain fake carrying the two calls the capture makes.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { GmailApi } from "../../../../live/gmail/api.js";
import {
  type CardMailStore,
  readCardMailStore,
  removeCardMailStore,
  type StoredCardMailMessage,
} from "../../../../live/gmail/cardMail.js";
import {
  cardMailBodySources,
  MAX_CARD_MAIL_ALTERNATIVE_BYTES,
  MAX_CARD_MAIL_FETCHED_BODY_BYTES,
  truncateUtf8,
} from "../../../../live/gmail/cardMailBody.js";
import { captureCardMail } from "../../../../live/gmail/cardMailCapture.js";
import {
  type RenderedCardMailBody,
  renderCardMailIndex,
  renderCardMailMessage,
} from "../../../../live/gmail/cardMailRender.js";
import { GmailErrors } from "../../../../live/gmail/errors.js";
import type { GmailMessage, GmailPart } from "../../../../live/gmail/parse.js";
import type { GmailTriageCard } from "../../../../live/gmail/triageCards.js";
import { stateHomePaths } from "../../../../stateHome.js";

const NOW = "2026-10-04T01:00:00.000Z";

/** Gmail's base64url body encoding. */
function encoded({ text }: { text: string }): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

/** A synthetic `full` message with the given MIME parts under a multipart/alternative root. */
function fullMessage({ id, parts }: { id: string; parts: readonly GmailPart[] }): GmailMessage {
  return {
    id,
    internalDate: String(Date.parse("2026-10-03T09:30:00.000Z")),
    payload: {
      headers: [
        { name: "From", value: "Notices <notices@example.test>" },
        { name: "To", value: "owner@example.test" },
        { name: "Subject", value: `Notice ${id}` },
      ],
      mimeType: "multipart/alternative",
      parts,
    },
    threadId: `t-${id}`,
  };
}

const htmlPart = ({ html }: { html: string }): GmailPart => ({
  body: { data: encoded({ text: html }) },
  mimeType: "text/html",
});
const textPart = ({ text }: { text: string }): GmailPart => ({
  body: { data: encoded({ text }) },
  mimeType: "text/plain",
});

/** A fake Gmail reader over a fixed set of messages and attachment bodies, recording each call. */
function fakeApi({
  messages,
  attachments = {},
  failing = [],
  calls,
}: {
  messages: Readonly<Record<string, GmailMessage>>;
  attachments?: Readonly<Record<string, string>>;
  failing?: readonly string[];
  calls: string[];
}): Pick<GmailApi, "getAttachment" | "getMessage"> {
  return {
    getAttachment: async ({ attachmentId }) => {
      calls.push(`attachment:${attachmentId}`);
      const data = attachments[attachmentId];
      return data === undefined
        ? err(GmailErrors.apiFailed({ message: "no such attachment" }))
        : ok({ data, size: undefined });
    },
    getMessage: async ({ id }) => {
      calls.push(`message:${id}`);
      if (failing.includes(id)) {
        return err(GmailErrors.apiFailed({ message: "backend error" }));
      }
      const message = messages[id];
      return message === undefined
        ? err(GmailErrors.apiFailed({ cause: { status: 404 }, message: "Requested entity was not found." }))
        : ok(message);
    },
  };
}

/** The stored message at `at`, failing the test when it is a gone entry — the narrowing `unwrap` does for a Result. */
function messageAt({ store, at }: { store: CardMailStore; at: number }): StoredCardMailMessage {
  const mail = store.mails[at]!;
  if (mail.kind !== "message") {
    throw new Error(`entry ${String(at)} is ${mail.kind}, not a message`);
  }
  return mail;
}

/** An HTML body, failing the test when the message drew another kind. */
function htmlBody({ body }: { body: RenderedCardMailBody }): RenderedCardMailBody & { kind: "html" } {
  if (body.kind !== "html") {
    throw new Error(`drew ${body.kind}, not html`);
  }
  return body;
}

function pin({
  ids,
  slug = "inbox-triage-20261003-notices",
}: {
  ids: readonly string[];
  slug?: string;
}): GmailTriageCard {
  return { ids, key: "from:notices@example.test", pinnedAtIso: NOW, schemaVersion: 1, slug };
}

describe("truncateUtf8", () => {
  it("keeps text under the cap whole, and cuts over it on a character boundary", () => {
    expect(truncateUtf8({ maxBytes: 8, text: "abc" })).toEqual({ text: "abc", truncated: false });
    // "é" is two bytes: a cap of 4 falls inside the second one, so the cut steps back to before it.
    expect(truncateUtf8({ maxBytes: 4, text: "aéé" })).toEqual({ text: "aé", truncated: true });
  });
});

describe("cardMailBodySources", () => {
  it("finds the first html and text alternatives depth first, skipping a file attached to the mail", () => {
    const message = fullMessage({
      id: "m1",
      parts: [
        { body: { data: encoded({ text: "<p>attached</p>" }) }, filename: "page.html", mimeType: "text/html" },
        { mimeType: "multipart/related", parts: [htmlPart({ html: "<p>body</p>" })] },
        textPart({ text: "body" }),
      ],
    });
    expect(cardMailBodySources({ message })).toEqual({
      html: { data: encoded({ text: "<p>body</p>" }), kind: "inline" },
      text: { data: encoded({ text: "body" }), kind: "inline" },
    });
  });

  it("reports a body Gmail returned behind an attachment id, with its declared size", () => {
    const message = fullMessage({
      id: "m2",
      parts: [{ body: { attachmentId: "att-1", size: 700_000 }, mimeType: "text/html" }],
    });
    expect(cardMailBodySources({ message })).toEqual({
      html: { attachmentId: "att-1", declaredBytes: 700_000, kind: "attachment" },
      text: { kind: "absent" },
    });
  });
});

describe("captureCardMail and the store", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) {
      rmSync(home, { force: true, recursive: true });
    }
  });
  function newHome(): string {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-card-mail-"));
    homes.push(home);
    return home;
  }

  it("stores every pinned message owner-only, and reads back exactly what the pin holds", async () => {
    const home = newHome();
    const calls: string[] = [];
    const api = fakeApi({
      calls,
      messages: {
        m1: fullMessage({ id: "m1", parts: [textPart({ text: "hello" }), htmlPart({ html: "<p>hello</p>" })] }),
        m2: fullMessage({ id: "m2", parts: [textPart({ text: "second" })] }),
      },
    });
    const card = pin({ ids: ["m1", "m2"] });
    const captured = unwrap(await captureCardMail({ api, card, home, nowIso: () => NOW }));
    expect(calls).toEqual(["message:m1", "message:m2"]);
    expect(captured.path).toBe(join(stateHomePaths({ home }).live.gmail.cardMail, `${card.slug}.json`));
    expect([
      statSync(captured.path).mode & 0o777,
      statSync(stateHomePaths({ home }).live.gmail.cardMail).mode & 0o777,
    ]).toEqual([0o600, 0o700]);
    const store = unwrap(readCardMailStore({ home, pin: card }));
    expect(store.mails[0]).toEqual({
      body: { html: "<p>hello</p>", htmlTruncated: false, text: "hello", textTruncated: false },
      cc: [],
      from: "Notices <notices@example.test>",
      id: "m1",
      kind: "message",
      receivedAtIso: "2026-10-03T09:30:00.000Z",
      subject: "Notice m1",
      threadId: "t-m1",
      to: ["owner@example.test"],
    });
    expect([store.pinnedCount, store.omittedCount, store.storedAtIso]).toEqual([2, 0, NOW]);
  });

  it("fetches a body Gmail returned as an attachment, and records one declared too large as cut with nothing kept", async () => {
    const home = newHome();
    const calls: string[] = [];
    const api = fakeApi({
      attachments: { "att-html": encoded({ text: "<p>large body</p>" }) },
      calls,
      messages: {
        m1: fullMessage({
          id: "m1",
          parts: [
            { body: { attachmentId: "att-text", size: MAX_CARD_MAIL_FETCHED_BODY_BYTES + 1 }, mimeType: "text/plain" },
            { body: { attachmentId: "att-html", size: 17 }, mimeType: "text/html" },
          ],
        }),
      },
    });
    const captured = unwrap(await captureCardMail({ api, card: pin({ ids: ["m1"] }), home, nowIso: () => NOW }));
    expect(calls).toEqual(["message:m1", "attachment:att-html"]);
    expect(messageAt({ at: 0, store: captured.store }).body).toEqual({
      html: "<p>large body</p>",
      htmlTruncated: false,
      text: null,
      textTruncated: true,
    });
  });

  it("stores a pinned id Gmail answers with a 404 as gone, and keeps the rest", async () => {
    const home = newHome();
    const api = fakeApi({
      calls: [],
      messages: { m2: fullMessage({ id: "m2", parts: [textPart({ text: "kept" })] }) },
    });
    const captured = unwrap(await captureCardMail({ api, card: pin({ ids: ["m1", "m2"] }), home, nowIso: () => NOW }));
    expect(captured.store.mails.map((mail) => [mail.id, mail.kind])).toEqual([
      ["m1", "gone"],
      ["m2", "message"],
    ]);
  });

  it("a failed read writes nothing, and leaves an earlier copy standing", async () => {
    const home = newHome();
    const card = pin({ ids: ["m1"] });
    const first = fakeApi({
      calls: [],
      messages: { m1: fullMessage({ id: "m1", parts: [textPart({ text: "first" })] }) },
    });
    const written = unwrap(await captureCardMail({ api: first, card, home, nowIso: () => NOW }));
    const before = readFileSync(written.path, "utf8");
    const failing = fakeApi({ calls: [], failing: ["m1"], messages: {} });
    const refused = unwrapErr(
      await captureCardMail({ api: failing, card, home, nowIso: () => "2026-10-05T00:00:00.000Z" }),
    );
    expect([refused.code, refused.message]).toEqual([
      "CARD_MAIL_FETCH_FAILED",
      "could not read pinned message m1 from Gmail: backend error",
    ]);
    expect(readFileSync(written.path, "utf8")).toBe(before);
  });

  it("cuts an alternative at the byte cap and flags it", async () => {
    const home = newHome();
    const long = "a".repeat(MAX_CARD_MAIL_ALTERNATIVE_BYTES + 10);
    const api = fakeApi({ calls: [], messages: { m1: fullMessage({ id: "m1", parts: [textPart({ text: long })] }) } });
    const captured = unwrap(await captureCardMail({ api, card: pin({ ids: ["m1"] }), home, nowIso: () => NOW }));
    const { body } = messageAt({ at: 0, store: captured.store });
    expect([body.text!.length, body.textTruncated]).toEqual([MAX_CARD_MAIL_ALTERNATIVE_BYTES, true]);
  });

  it("refuses a copy that is not the mail this pin holds, and one that is not a card's mail at all", async () => {
    const home = newHome();
    const api = fakeApi({ calls: [], messages: { m1: fullMessage({ id: "m1", parts: [textPart({ text: "x" })] }) } });
    const card = pin({ ids: ["m1"] });
    const written = unwrap(await captureCardMail({ api, card, home, nowIso: () => NOW }));
    const other = unwrapErr(readCardMailStore({ home, pin: { ...card, ids: ["m1", "m0"] } }));
    expect([other.code, other.message]).toEqual([
      "CARD_MAIL_PIN_MISMATCH",
      `the stored mail for card ${card.slug} is not what its pin holds (stored over 1 pinned id(s), the pin holds 2) — ` +
        `re-fetch it with gmail card-mail ${card.slug} --fetch`,
    ]);
    writeFileSync(written.path, '{"schemaVersion":1}\n');
    expect(unwrapErr(readCardMailStore({ home, pin: card })).code).toBe("CARD_MAIL_MALFORMED");
    unwrap(removeCardMailStore({ home, slug: card.slug }));
    expect(unwrapErr(readCardMailStore({ home, pin: card })).message).toBe(
      `no stored mail for ${card.slug} — run slopweaver gmail card-mail ${card.slug} --fetch`,
    );
    expect(removeCardMailStore({ home, slug: card.slug }).isOk()).toBe(true);
  });

  it("refuses a stored received date that is no instant, rather than handing the card a date it cannot draw", async () => {
    const home = newHome();
    const api = fakeApi({ calls: [], messages: { m1: fullMessage({ id: "m1", parts: [textPart({ text: "x" })] }) } });
    const card = pin({ ids: ["m1"] });
    const written = unwrap(await captureCardMail({ api, card, home, nowIso: () => NOW }));
    const raw = readFileSync(written.path, "utf8");
    const received = /"receivedAtIso":\s*"[^"]*"/;
    expect(raw).toMatch(received);
    writeFileSync(written.path, raw.replace(received, '"receivedAtIso":"not-a-date"'));
    expect(unwrapErr(readCardMailStore({ home, pin: card })).code).toBe("CARD_MAIL_MALFORMED");
  });
});

describe("the Queue's two reads", () => {
  /** A store holding the given messages, built as the capture builds one. */
  function storeOf({ mails }: { mails: CardMailStore["mails"] }): CardMailStore {
    return {
      key: "from:notices@example.test",
      mails,
      omittedCount: 0,
      pinnedCount: mails.length,
      schemaVersion: 1,
      slug: "inbox-triage-20261003-notices",
      storedAtIso: NOW,
    };
  }
  function stored({
    id,
    html,
    text,
  }: {
    id: string;
    html: string | null;
    text: string | null;
  }): CardMailStore["mails"][number] {
    return {
      body: { html, htmlTruncated: false, text, textTruncated: false },
      cc: [],
      from: "Notices <notices@example.test>",
      id,
      kind: "message",
      receivedAtIso: NOW,
      subject: `Notice ${id}`,
      threadId: `t-${id}`,
      to: [],
    };
  }

  it("the index carries every header and no body", () => {
    const index = renderCardMailIndex({
      store: storeOf({
        mails: [stored({ html: "<p>secret body</p>", id: "m1", text: null }), { id: "m2", kind: "gone" }],
      }),
    });
    expect(index.mails).toEqual([
      {
        cc: [],
        from: "Notices <notices@example.test>",
        id: "m1",
        kind: "message",
        receivedAtIso: NOW,
        subject: "Notice m1",
        threadId: "t-m1",
        to: [],
      },
      { id: "m2", kind: "gone" },
    ]);
    expect(JSON.stringify(index)).not.toContain("secret body");
  });

  it("one message draws its sanitised HTML, with remote images counted and blocked", () => {
    const store = storeOf({
      mails: [stored({ html: '<p>Hi</p><img src="https://tracker.example.test/p.gif">', id: "m1", text: "Hi" })],
    });
    const body = htmlBody({ body: renderCardMailMessage({ id: "m1", store })!.body });
    expect(body.remoteImagesBlocked).toBe(1);
    expect(body.document).toContain("<body><p>Hi</p><img></body>");
  });

  it("falls back to the plain text when the HTML shows nothing once sanitised", () => {
    const store = storeOf({
      mails: [
        stored({ html: '<div> </div><img src="https://tracker.example.test/p.gif">', id: "m1", text: "Readable" }),
      ],
    });
    expect(renderCardMailMessage({ id: "m1", store })!.body).toEqual({
      kind: "text",
      text: "Readable",
      truncated: false,
    });
  });

  it("draws none for a bodiless message, and nothing for a gone or unknown id", () => {
    const store = storeOf({ mails: [stored({ html: null, id: "m1", text: null }), { id: "m2", kind: "gone" }] });
    expect(renderCardMailMessage({ id: "m1", store })!.body).toEqual({ kind: "none", truncated: false });
    expect([renderCardMailMessage({ id: "m2", store }), renderCardMailMessage({ id: "m9", store })]).toEqual([
      undefined,
      undefined,
    ]);
  });
});
