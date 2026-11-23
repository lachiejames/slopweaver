/**
 * The shared mail compose form in `outbound/mail/form.ts`: a single address string is accepted as a list, absent
 * recipient lists read as empty, the body comes back byte for byte, and malformed JSON, a mistyped field and an
 * unrecognised key are each refused with the reasons named.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseMailComposeForm } from "../../../../outbound/mail/form.js";

describe("parseMailComposeForm", () => {
  it("parses a complete form with every list given as an array", () => {
    const form = unwrap(
      parseMailComposeForm({
        json: JSON.stringify({
          bcc: ["c@example.test"],
          body: "Hello.",
          cc: ["b@example.test"],
          subject: "Hi",
          to: ["a@example.test", "d@example.test"],
        }),
      }),
    );

    expect(form).toEqual({
      bcc: ["c@example.test"],
      body: "Hello.",
      cc: ["b@example.test"],
      subject: "Hi",
      to: ["a@example.test", "d@example.test"],
    });
  });

  it("accepts a bare string for a recipient list and reads an absent list as empty", () => {
    const form = unwrap(
      parseMailComposeForm({ json: JSON.stringify({ body: "Hello.", subject: "Hi", to: "a@example.test" }) }),
    );

    expect(form).toEqual({ bcc: [], body: "Hello.", cc: [], subject: "Hi", to: ["a@example.test"] });
  });

  it("hands the body back byte for byte", () => {
    const body = "Line one.\n\n  Indented `code` and $HOME, trailing space \n";

    const form = unwrap(parseMailComposeForm({ json: JSON.stringify({ body, subject: "S", to: [] }) }));

    expect(form.body).toBe(body);
  });

  it("refuses text that is not JSON, quoting the parser's reason", () => {
    const reasons = unwrapErr(parseMailComposeForm({ json: "{not json" }));

    expect(reasons.length).toBe(1);
    expect(reasons[0]).toContain("--form is not valid JSON: ");
  });

  it("refuses a document that is not an object, naming the root", () => {
    const reasons = unwrapErr(parseMailComposeForm({ json: "[]" }));

    expect(reasons).toEqual(["(root): Invalid input: expected object, received array"]);
  });

  it("refuses a missing subject and names its path", () => {
    const reasons = unwrapErr(parseMailComposeForm({ json: JSON.stringify({ body: "b", to: "a@example.test" }) }));

    expect(reasons).toEqual(["subject: Invalid input: expected string, received undefined"]);
  });

  it("refuses a mistyped recipient list at its key", () => {
    const reasons = unwrapErr(
      parseMailComposeForm({ json: JSON.stringify({ body: "b", subject: "s", to: ["a@example.test", 7] }) }),
    );

    expect(reasons).toEqual(["to: Invalid input"]);
  });

  it("refuses an unrecognised key rather than dropping it, and lists the form's real fields", () => {
    const reasons = unwrapErr(
      parseMailComposeForm({
        json: JSON.stringify({ body: "b", recipients: ["a@example.test"], subject: "s", to: "a@example.test" }),
      }),
    );

    expect(reasons.length).toBe(1);
    expect(reasons[0]).toContain('unknown field "recipients" — REFUSED, not ignored.');
    expect(reasons[0]).toContain("this form's fields are: bcc, body, cc, subject, to");
  });
});
