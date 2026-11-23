import { describe, expect, it } from "vitest";

import {
  asAskSettlement,
  asBoardPriority,
  asRowKind,
  DEFAULT_PRIORITY,
  declineNeedsAnchor,
  effectivePriority,
  priorityIndex,
} from "../../../handover/rowKind.js";

describe("asRowKind", () => {
  it("reads a declared ask", () => {
    expect(asRowKind({ value: "ask" })).toBe("ask");
  });

  it("defaults an absent kind to doc, so no existing doc needs a migration", () => {
    expect(asRowKind({ value: undefined })).toBe("doc");
  });

  it("swallows an unrecognised kind into doc rather than dropping the row", () => {
    expect(asRowKind({ value: "Ask" })).toBe("doc");
  });

  it("never admits tag, which is projected rather than authored", () => {
    expect(asRowKind({ value: "tag" })).toBe("doc");
  });
});

describe("asBoardPriority", () => {
  it("reads a declared band", () => {
    expect(asBoardPriority({ value: "p0" })).toBe("p0");
  });

  it("returns undefined for an absent one, so the kind default stays the single place it is stated", () => {
    expect(asBoardPriority({ value: undefined })).toBeUndefined();
  });

  it("returns undefined for a band that does not exist", () => {
    expect(asBoardPriority({ value: "p9" })).toBeUndefined();
  });
});

describe("asAskSettlement", () => {
  it("reads each of the three terminal states", () => {
    expect(asAskSettlement({ value: "filed" })).toBe("filed");
    expect(asAskSettlement({ value: "answered" })).toBe("answered");
    expect(asAskSettlement({ value: "declined" })).toBe("declined");
  });

  it("returns undefined for an open ask", () => {
    expect(asAskSettlement({ value: undefined })).toBeUndefined();
  });

  it("returns undefined for a state this board does not know", () => {
    expect(asAskSettlement({ value: "done" })).toBeUndefined();
  });
});

describe("declineNeedsAnchor", () => {
  it("is true only for a decline — the one an agent may not decide", () => {
    expect(declineNeedsAnchor({ settlement: "declined" })).toBe(true);
    expect(declineNeedsAnchor({ settlement: "filed" })).toBe(false);
    expect(declineNeedsAnchor({ settlement: "answered" })).toBe(false);
  });
});

describe("effectivePriority", () => {
  it("ranks a tag above an ask above a doc when none declares a band", () => {
    expect(effectivePriority({ declared: undefined, kind: "tag" })).toBe("p0");
    expect(effectivePriority({ declared: undefined, kind: "ask" })).toBe("p1");
    expect(effectivePriority({ declared: undefined, kind: "doc" })).toBe("p2");
  });

  it("lets a declared band beat the kind default in either direction", () => {
    expect(effectivePriority({ declared: "p0", kind: "doc" })).toBe("p0");
    expect(effectivePriority({ declared: "p3", kind: "tag" })).toBe("p3");
  });

  it("agrees with the defaults table it reads", () => {
    expect(DEFAULT_PRIORITY.tag).toBe("p0");
  });
});

describe("priorityIndex", () => {
  it("orders the bands most urgent first", () => {
    expect(priorityIndex({ priority: "p0" })).toBe(0);
    expect(priorityIndex({ priority: "p3" })).toBe(3);
  });
});
