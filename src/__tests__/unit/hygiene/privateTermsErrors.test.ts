import { describe, expect, it } from "vitest";

import { PrivateTermsParseErrors } from "../../../hygiene/privateTermsErrors.js";

describe("PrivateTermsParseErrors", () => {
  it("names the line a header was missing on, and both accepted headers", () => {
    expect(PrivateTermsParseErrors.headerMissing({ line: 3 })).toEqual({
      code: "PRIVATE_TERMS_HEADER_MISSING",
      line: 3,
      message:
        "line 3: the first non-comment line must be the header class<TAB>flags<TAB>pattern<TAB>source, " +
        "or id<TAB>class<TAB>flags<TAB>pattern<TAB>meaning<TAB>allowed-where<TAB>source",
    });
  });

  it("names a malformed row by line and class, then why", () => {
    expect(
      PrivateTermsParseErrors.rowMalformed({ className: "organisation", line: 7, why: "the pattern is empty" }),
    ).toEqual({
      code: "PRIVATE_TERMS_ROW_MALFORMED",
      line: 7,
      message: "line 7 (class organisation): the pattern is empty",
    });
  });
});
