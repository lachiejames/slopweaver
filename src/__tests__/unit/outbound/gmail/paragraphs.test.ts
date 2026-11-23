/**
 * A mail body's paragraphs are one line each: a hard-wrapped body is refused at the compose form, and a body
 * written as paragraphs passes through byte for byte.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { type GmailComposeForm, validateComposeForm } from "../../../../live/gmail/compose.js";
import { hardWrapProblems } from "../../../../outbound/gmail/paragraphs.js";

/** A sent reply, hard-wrapped at about eighty columns the way the composer wrote it. */
const WRAPPED_BODY =
  "Hi David,\n\n" +
  "SSO is on and the roles mirror our AU org. I think only one host is\n" +
  "reporting into it so far.\n\n" +
  "Cheers,\nAda";

/** The same reply written as paragraphs, with an introduced list and a quoted line. */
const PARAGRAPH_BODY =
  "Hi David,\n\n" +
  "SSO is on and the roles mirror our AU org. I think only one host is reporting into it so far.\n\n" +
  "Four things left:\n- the second host\n* the audit role\n• the NZ org\n1) numbered too\n2. and this\n\n" +
  "> What about the NZ org?\n> And the audit trail?\n\n" +
  "Cheers, the owner\n";

/** A valid form around one body. */
function form({ body }: { body: string }): GmailComposeForm {
  return { bcc: [], body, cc: [], subject: "SSO", to: ["david@example.com"] };
}

describe("hardWrapProblems", () => {
  it("refuses a hard-wrapped paragraph and a two-line sign-off, naming both lines and the first one's text", () => {
    expect(hardWrapProblems({ body: WRAPPED_BODY })).toEqual([
      'body: 2 hard line breaks inside a paragraph (lines 4, 7; first "reporting into it so far.") — write each ' +
        "paragraph as ONE line and let the reader's mail client wrap it; separate paragraphs with a blank line, " +
        "and start a new line only for a list item or a quoted line",
    ]);
  });

  it("finds nothing in a body of paragraphs, list items and quoted lines", () => {
    expect(hardWrapProblems({ body: PARAGRAPH_BODY })).toEqual([]);
  });

  it("reads a CRLF break exactly as a LF one", () => {
    expect(hardWrapProblems({ body: "one line\r\nwrapped" })).toEqual([
      'body: 1 hard line break inside a paragraph (line 2; first "wrapped") — write each paragraph as ONE line ' +
        "and let the reader's mail client wrap it; separate paragraphs with a blank line, and start a new line " +
        "only for a list item or a quoted line",
    ]);
  });

  it("reads a lone carriage return as a break, so a CR-only body cannot slip past", () => {
    expect(hardWrapProblems({ body: "one line\rwrapped" })).toEqual(hardWrapProblems({ body: "one line\nwrapped" }));
    expect(hardWrapProblems({ body: "one line\rwrapped" }).length).toBe(1);
  });

  it("refuses the continuation of a wrapped list item, and marker-like text with no space after it", () => {
    expect(hardWrapProblems({ body: "- a list item that\n  runs on" }).length).toBe(1);
    expect(hardWrapProblems({ body: "We saw\n-5% and\n1.5 million" }).length).toBe(1);
  });

  it("refuses a line-shaped block such as a postal address, since no block is inferred from prose", () => {
    expect(hardWrapProblems({ body: "Shipping address:\n123 Main Street\nMelbourne VIC 3000" }).length).toBe(1);
    expect(hardWrapProblems({ body: "Shipping address: 123 Main Street, Melbourne VIC 3000" })).toEqual([]);
  });

  it("passes a nested list item, which is still a list item", () => {
    expect(hardWrapProblems({ body: "Plan:\n- first\n  - nested\n  1. numbered" })).toEqual([]);
  });

  it("quotes a long first line by code point, never splitting a surrogate pair", () => {
    const problem = hardWrapProblems({ body: `a\n${"🙂".repeat(45)}` })[0]!;
    expect(problem).toContain(`first "${"🙂".repeat(40)}…"`);
  });

  it("treats a whitespace-only line as the blank line between paragraphs", () => {
    expect(hardWrapProblems({ body: "one\n   \ntwo" })).toEqual([]);
  });

  it("names five lines and counts the rest, quoting at most forty characters", () => {
    const body = ["x".repeat(50), ...Array.from({ length: 7 }, () => "y".repeat(50))].join("\n");
    expect(unwrapErr(validateComposeForm({ form: form({ body }) }))).toEqual([
      `body: 7 hard line breaks inside a paragraph (lines 2, 3, 4, 5, 6 and 2 more; first "${"y".repeat(40)}…") — ` +
        "write each paragraph as ONE line and let the reader's mail client wrap it; separate paragraphs with a " +
        "blank line, and start a new line only for a list item or a quoted line",
    ]);
  });
});

describe("validateComposeForm on the body's paragraphs", () => {
  it("refuses the wrapped reply rather than reflowing it", () => {
    expect(unwrapErr(validateComposeForm({ form: form({ body: WRAPPED_BODY }) }))).toEqual(
      hardWrapProblems({ body: WRAPPED_BODY }),
    );
  });

  it("passes the paragraph reply through byte for byte", () => {
    expect(unwrap(validateComposeForm({ form: form({ body: PARAGRAPH_BODY }) })).body).toBe(PARAGRAPH_BODY);
  });
});
