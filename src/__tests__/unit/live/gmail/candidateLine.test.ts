/**
 * Unit: how a `gmail attachment` refusal names one candidate part — every slot filled, and a field Gmail left
 * off the part named as missing rather than printed blank.
 */
import { describe, expect, it } from "vitest";
import type { GmailAttachmentCandidate } from "../../../../live/gmail/attachment.js";
import { describeCandidate } from "../../../../live/gmail/candidateLine.js";

const FULL: GmailAttachmentCandidate = {
  attachmentId: "att-1",
  filename: "invoice.pdf",
  mimeType: "application/pdf",
  partId: "1.2",
  sizeBytes: 2048,
};

describe("describeCandidate", () => {
  it("names a part carrying every field by id, filename, type and size", () => {
    expect(describeCandidate({ candidate: FULL })).toBe('part 1.2 "invoice.pdf" (application/pdf, 2048 bytes)');
  });

  it("says a part has no part id rather than leaving the slot blank", () => {
    expect(describeCandidate({ candidate: { ...FULL, partId: undefined } })).toBe(
      'part (no part id) "invoice.pdf" (application/pdf, 2048 bytes)',
    );
  });

  it("shows a part that declared no media type as of unknown type", () => {
    expect(describeCandidate({ candidate: { ...FULL, mimeType: undefined } })).toBe(
      'part 1.2 "invoice.pdf" (unknown type, 2048 bytes)',
    );
  });

  it("shows a part Gmail gave no size for as size unknown", () => {
    expect(describeCandidate({ candidate: { ...FULL, sizeBytes: undefined } })).toBe(
      'part 1.2 "invoice.pdf" (application/pdf, size unknown)',
    );
  });

  it("keeps an empty part id and an empty media type as Gmail sent them", () => {
    expect(describeCandidate({ candidate: { ...FULL, mimeType: "", partId: "" } })).toBe(
      'part  "invoice.pdf" (, 2048 bytes)',
    );
  });
});
