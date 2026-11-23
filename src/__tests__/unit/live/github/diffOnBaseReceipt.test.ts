import { describe, expect, it } from "vitest";

import {
  type DiffOnBaseReceipt,
  inCutOrder,
  unreadReceipt,
  withReceipt,
} from "../../../../live/github/diffOnBaseReceipt.js";

const RECEIPT: DiffOnBaseReceipt = {
  baseOid: "tip",
  baseRef: "staging",
  checkedAtIso: "2026-10-14T02:38:00.000Z",
  verdict: "on-base",
};

describe("withReceipt", () => {
  it("lands the receipt just before commits and the per-file list last", () => {
    const data = withReceipt({
      data: { body: "b", commits: {}, files: {}, state: "OPEN" },
      files: [{ filename: "a.ts", verdict: "on-base" }],
      receipt: RECEIPT,
    });

    expect(Object.keys(data)).toEqual(["diffOnBase", "body", "commits", "files", "state", "diffOnBaseFiles"]);
  });

  it("lands the receipt after the state fields when they come first, and at the end when neither anchor is there", () => {
    expect([
      Object.keys(withReceipt({ data: { commits: {}, state: "OPEN" }, files: [], receipt: RECEIPT })),
      Object.keys(withReceipt({ data: { state: "OPEN" }, files: [], receipt: RECEIPT })),
    ]).toEqual([
      ["diffOnBase", "commits", "state", "diffOnBaseFiles"],
      ["state", "diffOnBase", "diffOnBaseFiles"],
    ]);
  });
});

describe("inCutOrder", () => {
  it("puts the verdict and its reason first, and writes no reason key when there is none", () => {
    expect([
      Object.keys(inCutOrder({ receipt: { ...RECEIPT, reason: "why", verdict: "unknown" } })),
      Object.keys(inCutOrder({ receipt: RECEIPT })),
    ]).toEqual([
      ["verdict", "reason", "baseRef", "baseOid", "checkedAtIso"],
      ["verdict", "baseRef", "baseOid", "checkedAtIso"],
    ]);
  });
});

describe("unreadReceipt", () => {
  it("is an unknown with its reason and no base tip", () => {
    expect(
      unreadReceipt({ baseRef: "staging", checkedAtIso: "2026-10-14T02:38:00.000Z", reason: "no branch" }),
    ).toEqual({
      baseOid: null,
      baseRef: "staging",
      checkedAtIso: "2026-10-14T02:38:00.000Z",
      reason: "no branch",
      verdict: "unknown",
    });
  });
});
