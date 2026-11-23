import { describe, expect, it } from "vitest";

import { decodeHold, decodePreparation, decodeReceipt } from "../../../../outbound/privateTermReview/decode.js";

/** A hold as `JSON.parse` reads one back: the term's absent allowed-where is how an undefined one is written. */
const HOLD = {
  command: "slack chat.postMessage",
  contents: [{ locus: "text", text: "acme ships on Friday" }],
  createdAtIso: "2026-01-02T03:04:05.000Z",
  destination: "acme workspace, channel C0FIXTURE",
  family: "slack",
  heldBy: null,
  holdId: "ph-0123456789ab",
  holdKey: "a".repeat(64),
  matches: [{ className: "organisation", content: 0, end: 4, line: 1, start: 0, termId: "pt-0123456789ab" }],
  requestSha256: "b".repeat(64),
  schemaVersion: 1,
  terms: [
    {
      className: "organisation",
      meaning: "the synthetic client",
      rowDigest: "c".repeat(64),
      termId: "pt-0123456789ab",
    },
  ],
};

const RECEIPT = {
  holdId: "ph-0123456789ab",
  holdKey: "a".repeat(64),
  preparationId: "pr-fixture",
  receiptId: "pr-receipt",
  recordedAtIso: "2026-01-02T03:04:05.000Z",
  recordedBy: null,
  reviewId: "review-fixture",
  reviewer: "codex",
  schemaVersion: 1,
  summary: "the one match names the synthetic client in an allowed place",
  verdict: "CLEAN",
};

const PREPARATION = {
  baseSha: "d".repeat(40),
  createdAtIso: "2026-01-02T03:04:05.000Z",
  headSha: "e".repeat(40),
  holdId: "ph-0123456789ab",
  holdKey: "a".repeat(64),
  preparationId: "pr-fixture",
  preparedBy: null,
  schemaVersion: 1,
};

describe("decodeHold", () => {
  it("reads a written hold back whole, an absent allowed-where as naming nowhere", () => {
    expect(decodeHold({ value: HOLD })).toEqual({
      ...HOLD,
      terms: [{ ...HOLD.terms[0]!, allowedWhere: undefined }],
    });
  });

  it("keeps an allowed-where the row named", () => {
    const terms = [{ ...HOLD.terms[0]!, allowedWhere: "example.com threads" }];
    expect(decodeHold({ value: { ...HOLD, terms } })!.terms[0]!.allowedWhere).toBe("example.com threads");
  });

  it("refuses a match whose class is outside the closed set", () => {
    const matches = [{ ...HOLD.matches[0]!, className: "not-a-class" }];
    expect(decodeHold({ value: { ...HOLD, matches } })).toBeUndefined();
  });

  it("refuses a family no guarded write door has", () => {
    expect(decodeHold({ value: { ...HOLD, family: "fax" } })).toBeUndefined();
  });

  it("refuses a held string with no text", () => {
    expect(decodeHold({ value: { ...HOLD, contents: [{ locus: "text" }] } })).toBeUndefined();
  });

  it("refuses another schema version", () => {
    expect(decodeHold({ value: { ...HOLD, schemaVersion: 2 } })).toBeUndefined();
  });
});

describe("decodeReceipt", () => {
  it("reads a written receipt back whole", () => {
    expect(decodeReceipt({ value: RECEIPT })).toEqual(RECEIPT);
  });

  it("refuses a reviewer that is neither Codex nor the Claude fallback", () => {
    expect(decodeReceipt({ value: { ...RECEIPT, reviewer: "someone" } })).toBeUndefined();
  });

  it("refuses a verdict that is neither CLEAN nor BROKEN", () => {
    expect(decodeReceipt({ value: { ...RECEIPT, verdict: "MAYBE" } })).toBeUndefined();
  });

  it("keeps a visible session that recorded it", () => {
    const recordedBy = { host: "codex", id: "thread-fixture" };
    expect(decodeReceipt({ value: { ...RECEIPT, recordedBy } })!.recordedBy).toEqual(recordedBy);
  });

  it("refuses a recorder with no model behind it, which no writer can produce", () => {
    const recordedBy = { host: "explicit", id: "thread-fixture" };
    expect(decodeReceipt({ value: { ...RECEIPT, recordedBy } })).toBeUndefined();
  });
});

describe("decodePreparation", () => {
  it("reads a written preparation back whole", () => {
    expect(decodePreparation({ value: PREPARATION })).toEqual(PREPARATION);
  });

  it("refuses one with no head commit", () => {
    const headless = Object.fromEntries(Object.entries(PREPARATION).filter(([key]) => key !== "headSha"));
    expect(decodePreparation({ value: headless })).toBeUndefined();
  });

  it("refuses a value that is not a record", () => {
    expect(decodePreparation({ value: "preparation" })).toBeUndefined();
  });
});
