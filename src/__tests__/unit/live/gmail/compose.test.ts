/**
 * The composing half of the mail door: header encoding, the RFC 5322 build, the approval digest, and the
 * validation that stands in front of all three. Every function here is a string in and a string out, so
 * there is nothing to fake and no seam to inject.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  approvalDigest,
  buildMimeMessage,
  encodeHeaderValue,
  type GmailComposeForm,
  previewBody,
  toRawBase64Url,
  validateComposeForm,
} from "../../../../live/gmail/compose.js";
import { decodeEncodedWords } from "../../../../live/gmail/parse.js";

/** A minimal valid form; each test overrides only the field it is about. */
function form(over: Partial<GmailComposeForm> = {}): GmailComposeForm {
  return { bcc: [], body: "the body", cc: [], subject: "a subject", to: ["someone@example.com"], ...over };
}

describe("encodeHeaderValue", () => {
  it("leaves an all-ASCII value exactly as written, so ordinary mail stays readable in the raw bytes", () => {
    expect(encodeHeaderValue({ value: "Re: the staging pool" })).toBe("Re: the staging pool");
  });

  it("encodes a non-ASCII value as an RFC 2047 base64 encoded-word", () => {
    expect(encodeHeaderValue({ value: "café" })).toBe("=?UTF-8?B?Y2Fmw6k=?=");
  });

  it("round-trips through the reader's own decoder, which is the pair that has to agree", () => {
    const original = "réunion — jeudi 14h";
    expect(decodeEncodedWords({ value: encodeHeaderValue({ value: original }) })).toBe(original);
  });

  it("encodes an ASCII value that looks like an encoded-word, so a client shows it literally", () => {
    const literal = "=?UTF-8?B?SGVsbG8=?=";
    expect(encodeHeaderValue({ value: literal })).not.toBe(literal);
    expect(decodeEncodedWords({ value: encodeHeaderValue({ value: literal }) })).toBe(literal);
    expect(decodeEncodedWords({ value: literal })).toBe("Hello");
  });

  it("splits a long non-ASCII value into several encoded-words rather than one over-length header", () => {
    const encoded = encodeHeaderValue({ value: "é".repeat(60) });
    expect(encoded.split("=?UTF-8?B?").length - 1).toBe(3);
  });

  it("never splits a multi-byte code point across two encoded-words", () => {
    const original = "🙂".repeat(30);
    expect(decodeEncodedWords({ value: encodeHeaderValue({ value: original }) })).toBe(original);
  });

  it("keeps every encoded-word inside RFC 2047's 75-character limit", () => {
    const lines = encodeHeaderValue({ value: "ü".repeat(200) }).split("\r\n ");
    expect(lines.every((line) => line.length <= 75)).toBe(true);
  });
});

describe("validateComposeForm", () => {
  it("accepts a plain form unchanged", () => {
    expect(unwrap(validateComposeForm({ form: form() })).to).toEqual(["someone@example.com"]);
  });

  it("accepts a display-name address, which is how people actually write recipients", () => {
    const result = validateComposeForm({ form: form({ to: ["A Person <person@example.com>"] }) });
    expect(result.isOk()).toBe(true);
  });

  it("refuses a form with no recipient at all", () => {
    expect(unwrapErr(validateComposeForm({ form: form({ to: [] }) }))).toContain(
      "to: at least one recipient is required",
    );
  });

  it("refuses an address with no domain dot", () => {
    expect(unwrapErr(validateComposeForm({ form: form({ to: ["someone@localhost"] }) }))).toEqual([
      'to: "someone@localhost" is not a deliverable-looking address',
    ]);
  });

  it("refuses a subject carrying a newline, which is the header-injection shape", () => {
    expect(unwrapErr(validateComposeForm({ form: form({ subject: "hi\r\nBcc: sneak@example.com" }) }))).toContain(
      "subject: must not contain a line break — a header cannot span lines",
    );
  });

  it("refuses an address carrying a newline, so injection cannot arrive through a recipient either", () => {
    const problems = unwrapErr(validateComposeForm({ form: form({ to: ["a@b.com\nBcc: x@y.com"] }) }));
    expect(problems).toEqual(['to: "a@b.com\nBcc: x@y.com" is not a deliverable-looking address']);
  });

  it("reports every problem at once rather than only the first", () => {
    const problems = unwrapErr(validateComposeForm({ form: form({ body: "", cc: ["nope"], to: ["also-nope"] }) }));
    expect(problems.length).toBe(3);
  });

  it("names the field each bad address came from, so three problems are three fixable lines", () => {
    expect(unwrapErr(validateComposeForm({ form: form({ cc: ["bad"] }) }))).toEqual([
      'cc: "bad" is not a deliverable-looking address',
    ]);
  });

  it("refuses a non-ASCII address, because nothing on this path speaks SMTPUTF8", () => {
    expect(unwrapErr(validateComposeForm({ form: form({ to: ["josé@example.com"] }) }))).toEqual([
      'to: "josé@example.com" is not a deliverable-looking address',
    ]);
  });

  it("refuses an address containing a space, which no addr-spec may carry unquoted", () => {
    expect(unwrapErr(validateComposeForm({ form: form({ to: ["two words@example.com"] }) })).length).toBe(1);
  });

  it("refuses two mailboxes written as one entry, which a header would collapse into the last address", () => {
    expect(
      unwrapErr(validateComposeForm({ form: form({ to: ["Alice <alice@example.com>, José <jose@example.com>"] }) })),
    ).toEqual([
      'to: "Alice <alice@example.com>, José <jose@example.com>" is not one mailbox — put each recipient in its own entry, and quote a name that carries a comma, like "Smith, Jo" <jo@example.com>',
    ]);
  });

  it("refuses a display name carrying a line break, which would start a header of its own", () => {
    expect(unwrapErr(validateComposeForm({ form: form({ to: ["Alice\r\nCc: b <alice@example.com>"] }) }))).toEqual([
      'to: "Alice\r\nCc: b <alice@example.com>" is not one mailbox — put each recipient in its own entry, and quote a name that carries a comma, like "Smith, Jo" <jo@example.com>',
    ]);
  });

  it("refuses an unquoted name that opens a group or a comment", () => {
    expect(
      unwrapErr(
        validateComposeForm({ form: form({ to: ["Team: Alice <alice@example.com>", "Bob (x) <bob@example.com>"] }) }),
      ),
    ).toHaveLength(2);
  });

  it("refuses a bare address carrying list syntax, which a header would read as two recipients", () => {
    expect(unwrapErr(validateComposeForm({ form: form({ to: ["alice@example.com,bob"] }) }))).toEqual([
      'to: "alice@example.com,bob" is not a deliverable-looking address',
    ]);
  });

  it("accepts a name with a period, which every parser reads as one phrase", () => {
    expect(unwrap(validateComposeForm({ form: form({ to: ["J. Smith <j@example.com>"] }) })).to).toEqual([
      "J. Smith <j@example.com>",
    ]);
  });

  it("accepts a quoted display name carrying a comma, which is one mailbox", () => {
    expect(unwrap(validateComposeForm({ form: form({ to: ['"Smith, Jo" <jo@example.com>'] }) })).to).toEqual([
      '"Smith, Jo" <jo@example.com>',
    ]);
  });

  it("refuses an empty body", () => {
    expect(unwrapErr(validateComposeForm({ form: form({ body: "" }) }))).toContain("body: must not be empty");
  });

  it("refuses a lone surrogate, which the UTF-8 body would store as a replacement character", () => {
    expect(unwrapErr(validateComposeForm({ form: form({ body: JSON.parse('"a\\ud800b"') as string }) }))).toEqual([
      "body: carries a lone surrogate, which UTF-8 cannot encode — the draft would not be what was written",
    ]);
    expect(unwrap(validateComposeForm({ form: form({ body: "a 🙂 b" }) })).body).toBe("a 🙂 b");
  });
});

describe("buildMimeMessage", () => {
  it("writes the headers, a blank line, and a base64 body", () => {
    const message = buildMimeMessage({ form: form(), from: "me@example.com" });
    expect(message).toContain("From: me@example.com\r\n");
    expect(message).toContain("To: someone@example.com\r\n");
    expect(message).toContain("Subject: a subject\r\n");
    expect(message).toContain("Content-Transfer-Encoding: base64\r\n\r\n");
  });

  it("encodes only a recipient's display name, keeping its address readable to every client", () => {
    const message = buildMimeMessage({
      form: form({
        cc: ['"Zoë Q" <zoe@example.com>', "Plain Name <plain@example.com>"],
        to: ["José <jose@example.com>"],
      }),
      from: "me@example.com",
    });
    expect(message).toContain("To: =?UTF-8?B?Sm9zw6k=?= <jose@example.com>\r\n");
    expect(message).toContain("Cc: =?UTF-8?B?Wm/DqyBR?= <zoe@example.com>,\r\n Plain Name <plain@example.com>\r\n");
  });

  it("writes a bare address through as-is, even one whose local part looks like an encoded-word", () => {
    expect(unwrap(validateComposeForm({ form: form({ to: ["=?billing@example.com"] }) })).to).toEqual([
      "=?billing@example.com",
    ]);
    const message = buildMimeMessage({ form: form({ to: ["=?billing@example.com"] }), from: "me@example.com" });
    expect(message).toContain("To: =?billing@example.com\r\n");
  });

  it("encodes the body as base64 that decodes back to exactly what was written", () => {
    const body = "line one\nline two — with an em dash\n";
    const message = buildMimeMessage({ form: form({ body }), from: "me@example.com" });
    const encoded = message.split("\r\n\r\n")[1]!;
    expect(Buffer.from(encoded.replaceAll("\r\n", ""), "base64").toString("utf8")).toBe(body);
  });

  it("wraps the base64 body at 76 characters", () => {
    const message = buildMimeMessage({ form: form({ body: "x".repeat(500) }), from: "me@example.com" });
    const lines = message.split("\r\n\r\n")[1]!.split("\r\n");
    expect(lines.every((line) => line.length <= 76)).toBe(true);
  });

  it("omits Cc and Bcc entirely when they are empty, rather than writing empty headers", () => {
    const message = buildMimeMessage({ form: form(), from: "me@example.com" });
    expect(message.includes("Cc:")).toBe(false);
    expect(message.includes("Bcc:")).toBe(false);
  });

  it("writes Bcc as a header, because omitting it silently drops every blind recipient", () => {
    const message = buildMimeMessage({ form: form({ bcc: ["quiet@example.com"] }), from: "me@example.com" });
    expect(message).toContain("Bcc: quiet@example.com\r\n");
  });

  it("folds a long recipient list across lines rather than writing one over-length header", () => {
    const many = Array.from({ length: 5 }, (_unused, index) => `person${String(index)}@example.com`);
    const message = buildMimeMessage({ form: form({ to: many }), from: "me@example.com" });
    expect(message).toContain("To: person0@example.com,\r\n person1@example.com,\r\n");
  });

  it("carries In-Reply-To and References when a reply context is given", () => {
    const message = buildMimeMessage({
      form: form(),
      from: "me@example.com",
      reply: { inReplyTo: "<b@example.com>", references: ["<a@example.com>", "<b@example.com>"], threadId: "t1" },
    });
    expect(message).toContain("In-Reply-To: <b@example.com>\r\n");
    expect(message).toContain("References: <a@example.com>\r\n <b@example.com>\r\n");
  });

  it("carries neither threading header when there is no reply context", () => {
    const message = buildMimeMessage({ form: form(), from: "me@example.com" });
    expect(message.includes("In-Reply-To")).toBe(false);
  });
});

describe("toRawBase64Url", () => {
  it("emits URL-safe base64 with no padding, which is what the API's raw field takes", () => {
    expect(toRawBase64Url({ message: "a?b>c~" })).toBe("YT9iPmN-");
  });
});

describe("approvalDigest", () => {
  it("is stable for the same content", () => {
    expect(approvalDigest({ ...form(), from: "me@example.com" })).toBe(
      approvalDigest({ ...form(), from: "me@example.com" }),
    );
  });

  it("changes when the body changes, which is what stops an approval being transplanted", () => {
    expect(approvalDigest({ ...form(), from: "me@example.com" })).not.toBe(
      approvalDigest({ ...form({ body: "something else" }), from: "me@example.com" }),
    );
  });

  it("changes when a recipient is added", () => {
    expect(approvalDigest({ ...form(), from: "me@example.com" })).not.toBe(
      approvalDigest({ ...form({ cc: ["extra@example.com"] }), from: "me@example.com" }),
    );
  });

  it("changes when a BLIND recipient is added, so bcc cannot be slipped past an approval", () => {
    expect(approvalDigest({ ...form(), from: "me@example.com" })).not.toBe(
      approvalDigest({ ...form({ bcc: ["quiet@example.com"] }), from: "me@example.com" }),
    );
  });

  it("changes when the sending address changes", () => {
    expect(approvalDigest({ ...form(), from: "me@example.com" })).not.toBe(
      approvalDigest({ ...form(), from: "other@example.com" }),
    );
  });

  it("changes when recipients are merely REORDERED, because a reader checked that exact To line", () => {
    const one = form({ to: ["a@example.com", "b@example.com"] });
    const two = form({ to: ["b@example.com", "a@example.com"] });
    expect(approvalDigest({ ...one, from: "me@example.com" })).not.toBe(
      approvalDigest({ ...two, from: "me@example.com" }),
    );
  });

  it("distinguishes NO subject header from an empty one — they are different messages", () => {
    expect(approvalDigest({ ...form(), from: "me@example.com", subject: undefined })).not.toBe(
      approvalDigest({ ...form(), from: "me@example.com", subject: "" }),
    );
  });

  it("is 16 hex characters", () => {
    expect(approvalDigest({ ...form(), from: "me@example.com" })).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("previewBody", () => {
  it("returns a short body whole", () => {
    expect(previewBody({ body: "short" })).toBe("short");
  });

  it("marks the cut rather than truncating silently, so a reviewer can tell it is not the whole message", () => {
    const preview = previewBody({ body: "x".repeat(500) });
    expect(preview).toContain("… (100 more characters, not shown)");
  });
});
