/**
 * Fathom's sender and search, the one place the inbox triage and `fathom discover` both read who Fathom is.
 */
import { describe, expect, it } from "vitest";

import { FATHOM_MAIL_QUERY, isFathomMailSender } from "../../../../corpus/fathom/mail.js";

describe("isFathomMailSender", () => {
  it("names Fathom's own sender", () => {
    expect(isFathomMailSender({ address: "no-reply@fathom.video" })).toBe(true);
  });

  it("ignores the address's case", () => {
    expect(isFathomMailSender({ address: "No-Reply@Fathom.Video" })).toBe(true);
  });

  it("refuses another sender on the same domain", () => {
    expect(isFathomMailSender({ address: "support@fathom.video" })).toBe(false);
  });

  it("refuses an empty address", () => {
    expect(isFathomMailSender({ address: "" })).toBe(false);
  });
});

describe("FATHOM_MAIL_QUERY", () => {
  it("searches Fathom's own sender", () => {
    expect(FATHOM_MAIL_QUERY).toBe("from:no-reply@fathom.video");
  });
});
