/**
 * The forward draft: a `multipart/mixed` message that keeps the receipt's PDF and its subject, stored in one attempt.
 * Every value here is invented; the seam is a plain fake recording what it was asked, never a mock.
 */
import { describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { GmailApi } from "../../../../live/gmail/api.js";
import {
  applyGmailForwardDraft,
  type ForwardAttachment,
  type ForwardSource,
  forwardText,
  MAX_FORWARD_ATTACHMENT_BYTES,
  planGmailForwardDraft,
} from "../../../../live/gmail/forward.js";

const RECEIPTS = "receipts@expenses.airwallex.com";

/** An invented receipt mail. */
function source(over: Partial<ForwardSource> = {}): ForwardSource {
  return {
    body: "Receipt #0001\nTotal A$120.00",
    from: "Vendor Billing <billing@vendor.example.test>",
    sentAtIso: "2027-03-04T02:00:00.000Z",
    subject: "Your receipt from Vendor #0001",
    to: ["owner@plan.example.test"],
    ...over,
  };
}

/** Invented PDF bytes, with a byte above 0x7f so a lossy encoding would show. */
const PDF_BYTES = new Uint8Array([...Buffer.from("%PDF-1.7\n", "latin1"), 0xe2, 0x00, 0xff, 0x0a]);

/** An invented PDF attachment. */
function pdf(over: Partial<ForwardAttachment> = {}): ForwardAttachment {
  return { bytes: PDF_BYTES, filename: "Receipt-0001.pdf", mimeType: "application/pdf", ...over };
}

/** A text cut at its first blank line: the headers above it, and everything below. */
function atBlankLine({ text }: { text: string }): { head: string; rest: string } {
  const at = text.indexOf("\r\n\r\n");
  return { head: text.slice(0, at), rest: text.slice(at + 4) };
}

/** A built message's headers and each of its parts, split on the boundary its own header declares. */
function split({ message }: { message: string }): { headers: string; parts: readonly string[] } {
  const { head, rest } = atBlankLine({ text: message });
  const boundary = /boundary="([^"]+)"/u.exec(head)![1]!;
  const sections = `\r\n${rest}`.split(`\r\n--${boundary}`);
  return { headers: head, parts: sections.slice(1, -1).map((section) => section.replace(/^\r\n/u, "")) };
}

/** One part's headers and its decoded base64 content. */
function decode({ part }: { part: string }): { headers: string; bytes: Buffer } {
  const { head, rest } = atBlankLine({ text: part });
  return { bytes: Buffer.from(rest.replaceAll("\r\n", ""), "base64"), headers: head };
}

describe("forwardText", () => {
  it("writes the forwarded header block, then the body, CRLF throughout", () => {
    expect(forwardText({ source: source() })).toBe(
      [
        "---------- Forwarded message ---------",
        "From: Vendor Billing <billing@vendor.example.test>",
        "Date: 2027-03-04T02:00:00.000Z",
        "Subject: Your receipt from Vendor #0001",
        "To: owner@plan.example.test",
        "",
        "Receipt #0001",
        "Total A$120.00",
      ].join("\r\n"),
    );
  });

  it("leaves out a header line the source does not carry", () => {
    const text = forwardText({ source: source({ from: undefined, sentAtIso: undefined, subject: undefined, to: [] }) });
    expect(text).toBe("---------- Forwarded message ---------\r\n\r\nReceipt #0001\r\nTotal A$120.00");
  });
});

describe("planGmailForwardDraft", () => {
  it("builds a multipart forward to the receipts address, subject unchanged, the PDF byte for byte", () => {
    const plan = unwrap(
      planGmailForwardDraft({
        account: "owner@work.example.test",
        attachments: [pdf()],
        source: source(),
        to: [RECEIPTS],
      }),
    );
    const { headers, parts } = split({ message: plan.message });
    expect(headers.split("\r\n").slice(0, 4)).toEqual([
      "From: owner@work.example.test",
      `To: ${RECEIPTS}`,
      "Subject: Your receipt from Vendor #0001",
      "MIME-Version: 1.0",
    ]);
    expect(headers).toContain('Content-Type: multipart/mixed; boundary="=_sw_');
    expect(parts.length).toBe(2);
    const text = decode({ part: parts[0]! });
    expect(text.headers).toBe('Content-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64');
    expect(text.bytes.toString("utf8")).toBe(forwardText({ source: source() }));
    const file = decode({ part: parts[1]! });
    expect(file.headers).toBe(
      [
        'Content-Type: application/pdf; name="Receipt-0001.pdf"',
        'Content-Disposition: attachment; filename="Receipt-0001.pdf"',
        "Content-Transfer-Encoding: base64",
      ].join("\r\n"),
    );
    expect([...file.bytes]).toEqual([...PDF_BYTES]);
    expect(Buffer.from(plan.raw, "base64url").toString("utf8")).toBe(plan.message);
  });

  it("builds the same bytes twice, so apply can hold a draft to its plan", () => {
    const build = (): string =>
      unwrap(
        planGmailForwardDraft({
          account: "owner@work.example.test",
          attachments: [pdf()],
          source: source(),
          to: [RECEIPTS],
        }),
      ).raw;
    expect(build()).toBe(build());
  });

  it("carries no Subject header when the receipt had none", () => {
    const plan = unwrap(
      planGmailForwardDraft({
        account: "owner@work.example.test",
        attachments: [pdf()],
        source: source({ subject: undefined }),
        to: [RECEIPTS],
      }),
    );
    expect(split({ message: plan.message }).headers.split("\r\n").slice(0, 3)).toEqual([
      "From: owner@work.example.test",
      `To: ${RECEIPTS}`,
      "MIME-Version: 1.0",
    ]);
  });

  it("encodes a non-ASCII file name both ways a mail client reads one", () => {
    const plan = unwrap(
      planGmailForwardDraft({
        account: "owner@work.example.test",
        attachments: [pdf({ filename: "Reçu (1).pdf" })],
        source: source(),
        to: [RECEIPTS],
      }),
    );
    const file = decode({ part: split({ message: plan.message }).parts[1]! });
    expect(file.headers.split("\r\n").slice(0, 2)).toEqual([
      `Content-Type: application/pdf; name="=?UTF-8?B?${Buffer.from("Reçu (1).pdf", "utf8").toString("base64")}?="`,
      "Content-Disposition: attachment; filename*=UTF-8''Re%C3%A7u%20%281%29.pdf",
    ]);
  });

  it("refuses every reason at once: no recipient, a two-line subject, a PDF that is not one", () => {
    const error = unwrapErr(
      planGmailForwardDraft({
        account: "owner@work.example.test",
        attachments: [pdf({ bytes: new Uint8Array(Buffer.from("<html>", "latin1")) })],
        source: source({ subject: "Your receipt\r\nBcc: someone@example.test" }),
        to: [],
      }),
    );
    expect(error.code).toBe("INVALID_ADDRESS");
    expect(error.message).toBe(
      [
        "the compose form was refused:",
        "  - to: at least one recipient is required",
        "  - subject: must not contain a line break — a header cannot span lines",
        "  - attachment Receipt-0001.pdf: says it is a PDF but does not open with %PDF-",
      ].join("\n"),
    );
  });

  it("refuses a forward with nothing attached, and one over the size cap", () => {
    const none = unwrapErr(
      planGmailForwardDraft({ account: "owner@work.example.test", attachments: [], source: source(), to: [RECEIPTS] }),
    );
    expect(none.message).toContain("attachments: a forward that keeps its attachments needs at least one");
    const huge = new Uint8Array(MAX_FORWARD_ATTACHMENT_BYTES + 1);
    huge.set(PDF_BYTES);
    const over = unwrapErr(
      planGmailForwardDraft({
        account: "owner@work.example.test",
        attachments: [pdf({ bytes: huge })],
        source: source(),
        to: [RECEIPTS],
      }),
    );
    expect(over.message).toContain(`${String(MAX_FORWARD_ATTACHMENT_BYTES + 1)} bytes is over the`);
  });
});

describe("applyGmailForwardDraft", () => {
  /** A fake draft seam recording each call and answering one stored draft. */
  function fakeDrafts(): { api: Pick<GmailApi, "createDraft">; calls: { raw: string; once: boolean | undefined }[] } {
    const calls: { raw: string; once: boolean | undefined }[] = [];
    return {
      api: {
        createDraft: async ({ raw, once }) => {
          calls.push({ once, raw });
          return ok({ id: "d-1", message: { id: "m-1", threadId: "t-1" } });
        },
      },
      calls,
    };
  }

  it("stores the planned bytes as a draft in exactly one attempt", async () => {
    const plan = unwrap(
      planGmailForwardDraft({
        account: "owner@work.example.test",
        attachments: [pdf()],
        source: source(),
        to: [RECEIPTS],
      }),
    );
    const { api, calls } = fakeDrafts();
    expect(unwrap(await applyGmailForwardDraft({ api, plan }))).toEqual({ draftId: "d-1", draftMessageId: "m-1" });
    expect(calls).toEqual([{ once: true, raw: plan.raw }]);
  });

  it("refuses a plan whose raw is not what its fields build, and stores nothing", async () => {
    const plan = unwrap(
      planGmailForwardDraft({
        account: "owner@work.example.test",
        attachments: [pdf()],
        source: source(),
        to: [RECEIPTS],
      }),
    );
    const { api, calls } = fakeDrafts();
    const tampered = { ...plan, to: ["someone-else@example.test"] };
    const error = unwrapErr(await applyGmailForwardDraft({ api, plan: tampered }));
    expect(error.message).toBe(
      "the compose form was refused:\n  - raw: the plan's message is not the one its fields build",
    );
    expect(calls).toEqual([]);
  });
});
