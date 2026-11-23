/*
 * The Queue card's WHAT line names the annotated screenshot a cleared first message leads with, notes and all, so
 * what the picture shows is above the fold.
 */

import { describe, expect, it } from "vitest";

import { leadingReceiptLine } from "../../lib/postHead";

const RECEIPT = {
  notes: ["1 · filed", "2 · AWS and GCP certs, both current"],
  sha256: "a".repeat(64),
};

describe("leadingReceiptLine", () => {
  it("names the leading screenshot's notes after the receipts line", () => {
    expect(leadingReceiptLine({ line: "Receipts: 5 links, 1 attachment", receipt: RECEIPT })).toBe(
      "Receipts: 5 links, 1 attachment. Leads with an annotated screenshot: 1 · filed; 2 · AWS and GCP " +
        "certs, both current",
    );
  });

  it("does not double a full stop the receipts line already ends on", () => {
    expect(leadingReceiptLine({ line: "Receipts: 1 link.", receipt: { ...RECEIPT, notes: ["the control"] } })).toBe(
      "Receipts: 1 link. Leads with an annotated screenshot: the control",
    );
  });

  it("leaves the line alone on a row with no leading receipt", () => {
    expect(leadingReceiptLine({ line: "No receipts named", receipt: undefined })).toBe("No receipts named");
  });
});
