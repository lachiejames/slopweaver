/**
 * The compose form's parser. Pure — JSON text in, a typed form or a list of problems out.
 *
 * The strictness assertions carry the weight here. A form that silently dropped an unrecognised key would
 * compose a message missing whatever that key held, and the whole reason `strictForm` exists is that this
 * failure mode previews clean and exits zero.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseGmailComposeForm } from "../../../../outbound/gmail/form.js";

describe("parseGmailComposeForm", () => {
  it("parses the full shape", () => {
    const parsed = unwrap(
      parseGmailComposeForm({
        json: JSON.stringify({
          bcc: ["c@example.com"],
          body: "hello",
          cc: ["b@example.com"],
          subject: "hi",
          to: ["a@example.com"],
        }),
      }),
    );
    expect(parsed.to).toEqual(["a@example.com"]);
    expect(parsed.cc).toEqual(["b@example.com"]);
    expect(parsed.bcc).toEqual(["c@example.com"]);
  });

  it("hands the body back byte for byte, CRLF paragraph breaks included, never reflowed", () => {
    const body = "Hi,\r\n\r\nOne paragraph on one line.\r\n\r\nCheers, the owner";
    expect(unwrap(parseGmailComposeForm({ json: JSON.stringify({ body, subject: "s", to: "a@e.com" }) })).body).toBe(
      body,
    );
  });

  it("accepts a single recipient written as a bare string, which is what everybody does", () => {
    const parsed = unwrap(parseGmailComposeForm({ json: '{"to":"a@example.com","subject":"s","body":"b"}' }));
    expect(parsed.to).toEqual(["a@example.com"]);
  });

  it("defaults an omitted cc and bcc to empty rather than undefined", () => {
    const parsed = unwrap(parseGmailComposeForm({ json: '{"to":["a@example.com"],"subject":"s","body":"b"}' }));
    expect(parsed.cc).toEqual([]);
    expect(parsed.bcc).toEqual([]);
  });

  it("REFUSES an unrecognised key rather than dropping it", () => {
    const problems = unwrapErr(
      parseGmailComposeForm({ json: '{"to":["a@example.com"],"subject":"s","body":"b","recipients":["x@y.com"]}' }),
    );
    expect(problems.length).toBe(1);
  });

  it("names the nearest real field when a key is a near miss, so a porter is sent somewhere", () => {
    const problems = unwrapErr(
      parseGmailComposeForm({ json: '{"to":["a@example.com"],"subject":"s","body":"b","bdy":"oops"}' }),
    );
    expect(problems.join(" ")).toContain("body");
  });

  it("refuses text that is not JSON at all, naming it as such", () => {
    expect(unwrapErr(parseGmailComposeForm({ json: "to: someone" })).join(" ")).toContain("not valid JSON");
  });

  it("refuses a missing body", () => {
    const problems = unwrapErr(parseGmailComposeForm({ json: '{"to":["a@example.com"],"subject":"s"}' }));
    expect(problems.join(" ")).toContain("body");
  });

  it("refuses a body of the wrong type rather than coercing it", () => {
    const problems = unwrapErr(parseGmailComposeForm({ json: '{"to":["a@e.com"],"subject":"s","body":42}' }));
    expect(problems.join(" ")).toContain("body");
  });

  it("reports the path of the field that failed, so a long form is fixable", () => {
    const problems = unwrapErr(parseGmailComposeForm({ json: '{"to":["a@e.com"],"subject":7,"body":"b"}' }));
    expect(problems[0]).toContain("subject:");
  });

  it("places a problem with the document as a whole at the form's root, never at an empty path", () => {
    const problems = unwrapErr(parseGmailComposeForm({ json: "[]" }));
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch(/^\(root\): /);
  });
});
