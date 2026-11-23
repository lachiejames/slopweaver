/**
 * The door request one stored `spend forward` makes: counts and byte sizes only, never a recipient address or an
 * attachment's bytes. Values are invented.
 */
import { describe, expect, it } from "vitest";

import { forwardDoorRequest } from "../../../../../cli/commands/spend/forwardDoor.js";
import type { GmailForwardPlan } from "../../../../../live/gmail/forward.js";

/** A plan carrying attachments of the given sizes and the given recipients; its content is invented. */
function planWith({ sizes, to }: { sizes: readonly number[]; to: readonly string[] }): GmailForwardPlan {
  return {
    account: "owner@example.test",
    attachments: sizes.map((size, index) => ({
      bytes: new Uint8Array(size),
      filename: `receipt-${String(index)}.pdf`,
      mimeType: "application/pdf",
    })),
    message: "Subject: Fwd: Your receipt\r\n\r\ninvented",
    raw: "U3ViamVjdA",
    source: {
      body: "invented receipt body",
      from: "billing@example.test",
      sentAtIso: "2027-03-04T00:00:00Z",
      subject: "Your receipt",
      to: ["owner@example.test"],
    },
    to: [...to],
  };
}

describe("forwardDoorRequest", () => {
  it("sums the attachment bytes and counts attachments and recipients", () => {
    const request = forwardDoorRequest({
      home: "/fixture/home",
      plan: planWith({ sizes: [10, 32], to: ["receipts@example.test", "copy@example.test"] }),
      receiptId: "r1",
    });
    expect(request).toStrictEqual({
      action: { kind: "verb", noun: "spend", verb: "forward" },
      artifact: { attachmentBytes: 42, attachments: 2, receiptId: "r1", to: 2 },
      meta: { createsWorkItem: false, effect: "external-write", home: "/fixture/home", requiresApproval: false },
    });
  });

  it("reports zero bytes and zero attachments for a forward with none", () => {
    const request = forwardDoorRequest({
      home: "/fixture/home",
      plan: planWith({ sizes: [], to: ["receipts@example.test"] }),
      receiptId: "r2",
    });
    expect(request).toStrictEqual({
      action: { kind: "verb", noun: "spend", verb: "forward" },
      artifact: { attachmentBytes: 0, attachments: 0, receiptId: "r2", to: 1 },
      meta: { createsWorkItem: false, effect: "external-write", home: "/fixture/home", requiresApproval: false },
    });
  });
});
