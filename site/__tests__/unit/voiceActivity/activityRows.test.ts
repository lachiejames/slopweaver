import { describe, expect, it } from "vitest";

import { activityRows, NO_ACTIVITY, STALL_MS } from "../../../lib/voiceActivity";
import { sameRows } from "../../../lib/voiceSame";
import { delegated, MEASURED, play } from "./harness";

describe("activityRows", () => {
  it("lists every delegation, tool and continuation in flight, newest progress first, a stale one marked", () => {
    const activity = play({
      script: [
        [0, delegated({ id: "d1" })],
        [30_000, { callId: "c1", kind: "tool-started", name: "read_page" }],
        [31_000, { kind: "continued" }],
      ],
    });
    expect(activityRows({ activity, nowMs: STALL_MS })).toEqual([
      { key: "continued", seconds: 4, stale: false, step: undefined, words: "waiting for the backend to continue" },
      { key: "t:c1", seconds: 5, stale: false, step: { kind: "tool", name: "read_page" }, words: "running read_page" },
      { key: "d:d1", seconds: 35, stale: true, step: { kind: "reasoning" }, words: "reasoning" },
    ]);
  });

  it("calls two rows that differ only in their tool different, so the orb's face redraws", () => {
    const row = { key: "c:t1", seconds: 3, stale: false, words: "running a tool" };
    const slack = { ...row, step: { kind: "tool", name: "slack_thread_after" } } as const;
    const screen = { ...row, step: { kind: "tool", name: "read_screen" } } as const;
    expect(sameRows({ a: [slack], b: [screen] })).toBe(false);
    expect(sameRows({ a: [slack], b: [{ ...slack }] })).toBe(true);
    expect(sameRows({ a: [{ ...row, step: undefined }], b: [slack] })).toBe(false);
  });

  it("forgets everything when the session closes, an error and the owner's last words included", () => {
    const activity = play({
      script: [...MEASURED, [7_900, { kind: "error", message: "boom" }], [8_000, { kind: "closed" }]],
    });
    expect(activityRows({ activity, nowMs: 9_000 })).toEqual([]);
    expect(activity).toEqual(NO_ACTIVITY);
  });
});
