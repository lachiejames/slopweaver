/**
 * Unit: the MAIL arm of an ask's action — the rules it is recorded under, its round-trip through the
 * journal's wire shape, the options it derives, and the digest a console press carries back.
 */
import { describe, expect, it } from "vitest";

import { askActionProblems, MAIL_BODY_MAX_CHARS, type MailAskAction } from "../../../handover/askAction.js";
import { actionOptions, HOLD_OPTION, MAIL_DRAFT_OPTION } from "../../../handover/askActionOptions.js";
import { askActionFrom } from "../../../handover/askActionWire.js";
import { mailActionDigest, mailPreviewOf } from "../../../handover/mailActionPreview.js";

const MAIL: MailAskAction = {
  actor: "me",
  form: {
    bcc: [],
    body: "Hi Felix, Rosa —\n\nTen things we would like to close before the audit.",
    cc: ["ada@example.test"],
    subject: "ISO 27001 — ten open compliance items",
    to: ["felix@vendor.test", "rosa@vendor.test"],
  },
  from: "ada@example.test",
  kind: "mail",
  version: 2,
};

/** The message a reply answers, shaped as every Gmail id the door prints. */
const REPLY_TO = "1a10eb75732e663a";

describe("askActionProblems over a mail", () => {
  it("accepts a well-formed mail", () => {
    expect(askActionProblems({ action: MAIL })).toEqual([]);
  });

  it("refuses a mail with nobody in To, naming the draft verb's own rule", () => {
    const action = { ...MAIL, form: { ...MAIL.form, to: [] } };
    expect(askActionProblems({ action })).toEqual(["to: at least one recipient is required"]);
  });

  it("refuses a sender that is not one bare address", () => {
    const action = { ...MAIL, from: "the owner <ada@example.test>" };
    expect(askActionProblems({ action })[0]).toContain("is not a bare address");
  });

  it("refuses a body hard-wrapped inside a paragraph, through the draft verb's own rule", () => {
    const action = { ...MAIL, form: { ...MAIL.form, body: "Hi Felix,\n\nTen things we would like\nto close." } };
    expect(askActionProblems({ action })).toEqual([
      'body: 1 hard line break inside a paragraph (line 4; first "to close.") — write each paragraph as ONE line ' +
        "and let the reader's mail client wrap it; separate paragraphs with a blank line, and start a new line " +
        "only for a list item or a quoted line",
    ]);
  });

  it("refuses an empty subject and an over-long body", () => {
    const action = { ...MAIL, form: { ...MAIL.form, body: "x".repeat(MAIL_BODY_MAX_CHARS + 1), subject: " " } };
    const problems = askActionProblems({ action });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("subject: a draft the owner is asked to create names what it is about");
    expect(problems[1]).toContain(`against a cap of ${String(MAIL_BODY_MAX_CHARS)}`);
  });
});

describe("askActionFrom over a mail", () => {
  it("round-trips the mail through JSON exactly", () => {
    expect(askActionFrom({ value: JSON.parse(JSON.stringify(MAIL)) })).toEqual({ action: MAIL, kind: "action" });
  });

  it("names a mail with a field this build does not know as invalid, never as absent", () => {
    const read = askActionFrom({ value: { ...MAIL, attachments: ["a.pdf"] } });
    expect(read.kind).toBe("invalid");
  });

  it("names a mail breaking its own rules as invalid, with the rule", () => {
    expect(askActionFrom({ value: { ...MAIL, form: { ...MAIL.form, to: [] } } })).toEqual({
      kind: "invalid",
      why: "to: at least one recipient is required",
    });
  });

  it("round-trips a reply's target exactly, and leaves a new mail without one", () => {
    const reply: MailAskAction = { ...MAIL, replyTo: { messageId: REPLY_TO } };
    expect(askActionFrom({ value: JSON.parse(JSON.stringify(reply)) })).toEqual({ action: reply, kind: "action" });
    // Strict: a decoder manufacturing `replyTo: undefined` would fail the journal's own append/read-back compare.
    expect(askActionFrom({ value: JSON.parse(JSON.stringify(MAIL)) })).toStrictEqual({ action: MAIL, kind: "action" });
  });

  it("names a reply target carrying a field this build does not know as invalid", () => {
    const read = askActionFrom({ value: { ...MAIL, replyTo: { messageId: REPLY_TO, threadId: REPLY_TO } } });
    expect(read).toEqual({ kind: "invalid", why: 'replyTo: Unrecognized key: "threadId"' });
  });

  it("refuses a reply target that is not a Gmail message id", () => {
    const action: MailAskAction = { ...MAIL, replyTo: { messageId: "thread-of-david" } };
    expect(askActionProblems({ action })).toEqual([
      "replyTo: thread-of-david is not a Gmail message id (sixteen lowercase hex characters)",
    ]);
  });
});

describe("actionOptions over a mail", () => {
  it("offers exactly create-the-draft, then hold", () => {
    expect(actionOptions({ action: MAIL }).map((one) => one.option)).toEqual([
      MAIL_DRAFT_OPTION.option,
      HOLD_OPTION.option,
    ]);
  });
});

describe("mailActionDigest", () => {
  it("is stable for the same slug and mail, and moves with a byte of the body or the slug", () => {
    const base = mailActionDigest({ action: MAIL, slug: "iso-mail" });
    expect(base).toMatch(/^[0-9a-f]{16}$/u);
    expect(mailActionDigest({ action: MAIL, slug: "iso-mail" })).toBe(base);
    const edited = { ...MAIL, form: { ...MAIL.form, body: `${MAIL.form.body}!` } };
    expect(mailActionDigest({ action: edited, slug: "iso-mail" })).not.toBe(base);
    expect(mailActionDigest({ action: MAIL, slug: "another-row" })).not.toBe(base);
  });

  it("digests a new mail exactly as it did before replies existed, so a preview already drawn keeps its press", () => {
    // The literal is a sha256 of the canonical form, before `replyTo` existed, taken outside this code — a
    // recomputed "before" would prove nothing. Repro: printf %s '<that commit's JSON of MAIL>' | shasum -a 256
    expect(mailActionDigest({ action: MAIL, slug: "iso-mail" })).toBe("85f57e6d340a68da");
  });

  it("digests a reply apart from the same words as a new mail, and apart from a reply to another message", () => {
    const reply = mailActionDigest({ action: { ...MAIL, replyTo: { messageId: REPLY_TO } }, slug: "iso-mail" });
    expect(reply).not.toBe("f6fc1d228bf623df");
    const other = { ...MAIL, replyTo: { messageId: "1a0f6ca321b11f34" } };
    expect(mailActionDigest({ action: other, slug: "iso-mail" })).not.toBe(reply);
  });

  it("puts the digest in the console address it publishes", () => {
    const preview = mailPreviewOf({ action: MAIL, slug: "iso-mail" });
    expect(preview.url).toBe(`http://localhost:3000/queue/mail/iso-mail/${preview.digest}`);
  });
});
