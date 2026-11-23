/**
 * Unit: the mail preview's pure half — the card's fold, the row reader's mail arm, and what a preview
 * address resolves to against the board.
 */
import { describe, expect, it } from "vitest";

import { mailReplyOf, rowAction } from "../../components/live/readAction";
import { lookupMailPreview, mailBodyFold } from "../../lib/mailPreview";

const MAIL = {
  actor: "me",
  form: {
    bcc: [],
    body: "Hi both,\n\nTen items.",
    cc: ["c@example.test"],
    subject: "Ten items",
    to: ["r@vendor.test"],
  },
  from: "l@example.test",
  kind: "mail",
  version: 2,
};

const PREVIEW = { digest: "3f9a2c7e1b4d5006", url: "http://localhost:3000/queue/mail/iso-mail/3f9a2c7e1b4d5006" };

describe("mailBodyFold", () => {
  it("shows the first lines and counts the rest", () => {
    expect(mailBodyFold({ body: "a\nb\nc\nd", lines: 2 })).toEqual({ hiddenLines: 2, shown: "a\nb" });
  });

  it("hides nothing when the body fits, and does not count trailing blank lines", () => {
    expect(mailBodyFold({ body: "a\nb\n\n\n", lines: 2 })).toEqual({ hiddenLines: 0, shown: "a\nb" });
  });

  it("shows everything at an infinite fold", () => {
    expect(mailBodyFold({ body: "a\nb\nc", lines: Number.POSITIVE_INFINITY })).toEqual({
      hiddenLines: 0,
      shown: "a\nb\nc",
    });
  });
});

describe("rowAction over a mail", () => {
  it("reads the mail whole with the preview address and digest the board published", () => {
    expect(rowAction({ row: { action: MAIL, mailPreview: PREVIEW } })).toEqual({
      kind: "mail",
      mail: {
        bcc: [],
        body: "Hi both,\n\nTen items.",
        cc: ["c@example.test"],
        digest: "3f9a2c7e1b4d5006",
        from: "l@example.test",
        previewUrl: PREVIEW.url,
        replyTo: undefined,
        subject: "Ten items",
        to: ["r@vendor.test"],
      },
    });
  });

  it("reads a reply's target, and the helper the card draws its thread from returns it", () => {
    const read = rowAction({
      row: { action: { ...MAIL, replyTo: { messageId: "1a10eb75732e663a" } }, mailPreview: PREVIEW },
    });
    expect(read.kind).toBe("mail");
    expect(mailReplyOf({ action: read })).toBe("1a10eb75732e663a");
    expect(mailReplyOf({ action: rowAction({ row: { action: MAIL, mailPreview: PREVIEW } }) })).toBe(undefined);
  });

  it("names a reply target with no readable id as invalid, never as a new mail", () => {
    const action = { ...MAIL, replyTo: { threadId: "1a10eb75732e663a" } };
    expect(rowAction({ row: { action, mailPreview: PREVIEW } })).toEqual({
      kind: "invalid",
      why: "the mail names a message it replies to, but not by a readable id",
    });
  });

  it("names a mail with no published preview as invalid rather than drawing an unpressable one", () => {
    expect(rowAction({ row: { action: MAIL } })).toEqual({
      kind: "invalid",
      why: "the board published no preview address or digest beside the mail",
    });
  });

  it("names a mail whose recipient list is not all strings as invalid", () => {
    const action = { ...MAIL, form: { ...MAIL.form, to: ["r@vendor.test", 7] } };
    expect(rowAction({ row: { action, mailPreview: PREVIEW } }).kind).toBe("invalid");
  });
});

describe("lookupMailPreview", () => {
  const rows = [
    { digest: "3f9a2c7e1b4d5006", slug: "iso-mail" },
    { digest: undefined, slug: "plain-ask" },
  ];

  it("answers current for the digest the row still holds", () => {
    expect(lookupMailPreview({ digest: "3f9a2c7e1b4d5006", rows, slug: "iso-mail" })).toEqual({ kind: "current" });
  });

  it("answers superseded, naming the current digest, for an old one", () => {
    expect(lookupMailPreview({ digest: "0000000000000000", rows, slug: "iso-mail" })).toEqual({
      currentDigest: "3f9a2c7e1b4d5006",
      kind: "superseded",
    });
  });

  it("tells a row with no mail from a row that is not there", () => {
    expect(lookupMailPreview({ digest: "3f9a2c7e1b4d5006", rows, slug: "plain-ask" })).toEqual({ kind: "no-mail" });
    expect(lookupMailPreview({ digest: "3f9a2c7e1b4d5006", rows, slug: "gone" })).toEqual({ kind: "no-row" });
  });
});
