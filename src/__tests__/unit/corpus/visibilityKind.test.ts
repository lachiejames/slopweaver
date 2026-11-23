import { describe, expect, it } from "vitest";

import type { CorpusRecord } from "../../../corpus/types.js";
import { isAlwaysPrivateKind, stampVisibility, visibilityForRecord } from "../../../corpus/visibility.js";

/** A record of the given kind, otherwise minimal. */
function record(over: Partial<CorpusRecord> = {}): CorpusRecord {
  return {
    container: "slack/C1",
    kind: "message",
    refs: [],
    source: "slack",
    sourceId: "s1",
    text: "hello",
    tsIso: "2026-08-28T00:00:00.000Z",
    url: "https://example.slack.com/archives/C1/p1785114398557099",
    ...over,
  };
}

describe("isAlwaysPrivateKind", () => {
  it("holds for a huddle — a recorded call between named people", () => {
    expect(isAlwaysPrivateKind({ kind: "huddle" })).toBe(true);
  });

  it("does not hold for a canvas, which is a document somebody chose to write", () => {
    expect(isAlwaysPrivateKind({ kind: "canvas" })).toBe(false);
  });
});

describe("stampVisibility", () => {
  it("stamps a huddle private even when the caller asked for public", () => {
    const stamped = stampVisibility({ record: record({ kind: "huddle" }), visibility: "public" });
    expect(stamped.visibility).toBe("private");
  });

  it("leaves a public Slack message unstamped, so bronze stays byte-identical", () => {
    const stamped = stampVisibility({ record: record(), visibility: "public" });
    expect(stamped.visibility).toBe(undefined);
  });
});

describe("visibilityForRecord", () => {
  it("reads a huddle back private even with no field on it, which is the migration case", () => {
    expect(visibilityForRecord({ record: record({ kind: "huddle" }) })).toBe("private");
  });

  it("reads an unmarked message back public — the default-public contract", () => {
    expect(visibilityForRecord({ record: record() })).toBe("public");
  });
});
