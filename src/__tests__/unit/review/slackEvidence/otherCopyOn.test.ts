import { describe, expect, it } from "vitest";

import { otherCopyOn } from "../../../../review/slackEvidenceScan.js";
import { LINKING, slackRecord } from "./harness.js";

describe("otherCopyOn", () => {
  const keys = new Set(["C1:1.0"]);
  const paths = ["o/r/pull/"];

  it("returns a copy of a candidate message that no longer links the pull request", () => {
    const line = JSON.stringify(slackRecord({ edited: true, sourceId: "C1:1.0", text: "redacted" }));
    expect(otherCopyOn({ keys, line, paths, threads: new Set() })!.text).toBe("redacted");
  });

  it("ignores a line the first pass already kept, and a message nobody is looking for", () => {
    const kept = JSON.stringify(slackRecord({ sourceId: "C1:1.0", text: LINKING }));
    const stranger = JSON.stringify(slackRecord({ sourceId: "C1:9.0", text: "hello" }));
    expect([
      otherCopyOn({ keys, line: kept, paths, threads: new Set() }),
      otherCopyOn({ keys, line: stranger, paths, threads: new Set() }),
    ]).toEqual([undefined, undefined]);
  });
});

describe("otherCopyOn — a thread member", () => {
  it("keeps a linkless reply in a wanted thread and nothing from a thread nobody is looking for", () => {
    const threads = new Set(["C1:1.0"]);
    const member = JSON.stringify(slackRecord({ kind: "comment", sourceId: "C1:1.0:reply:2.0", text: "on it" }));
    const stranger = JSON.stringify(slackRecord({ kind: "comment", sourceId: "C1:9.0:reply:9.5", text: "on it" }));
    const paths = ["o/r/pull/"];
    expect(otherCopyOn({ keys: new Set(), line: member, paths, threads })!.sourceId).toBe("C1:1.0:reply:2.0");
    expect(otherCopyOn({ keys: new Set(), line: stranger, paths, threads })).toBe(undefined);
  });
});
