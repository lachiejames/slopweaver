/**
 * The `talk` call verbs' own manifest module: the call reads, the thread journal's writer and the call reader's pair,
 * with only the two writers declaring local state. That the `talk` manifest serves each as the same entry is
 * `verbs.test.ts`'s.
 */
import { describe, expect, it } from "vitest";

import { talkCallsManifest } from "../../../cli/manifests/talkCalls.js";

describe("talkCallsManifest", () => {
  it("declares the call reads, the thread journal's writer and the call reader's pair, only the two writers writing", () => {
    expect(Object.keys(talkCallsManifest)).toEqual([
      "assessment-due",
      "assessment-record",
      "call-thread",
      "call-thread-append",
      "call-tools",
      "calls",
    ]);
    expect(Object.values(talkCallsManifest).map((entry) => entry.meta.effect)).toEqual([
      "none",
      "local-state",
      "none",
      "local-state",
      "none",
      "none",
    ]);
  });
});
