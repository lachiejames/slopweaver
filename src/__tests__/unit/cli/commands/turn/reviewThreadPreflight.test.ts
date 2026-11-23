/**
 * The round-1 thread gate's pure halves: which read-through it measures from, and the exact lines it refuses
 * with. The live Slack read is the thin effectful shell around them and is not exercised here.
 */
import { describe, expect, it } from "vitest";

import {
  roundOneReadThrough,
  roundOneThreadRefusalLines,
} from "../../../../../cli/commands/turn/reviewThreadPreflight.js";
import { hatchFor } from "../../../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../../../hatch/render.js";
import { unwrap } from "../../../../../lib/result.js";
import { threadDeltaFromMessages } from "../../../../../live/turn/threadFreshness.js";

const ASK = "1785000000.000100";
const NOW = "2026-07-25T17:00:00.000Z";
const THREAD = [
  { ts: ASK, user: "U_ASKER" },
  { ts: "1785000060.000100", user: "U_A" },
  { ts: "1785000120.000100", user: "U_B" },
];

describe("roundOneReadThrough", () => {
  it("reads the ask's own ts as no claimed read, so a worker who saw nothing after the ask is not refused", () => {
    expect(roundOneReadThrough({ addressedTs: ASK, readThrough: ASK })).toBeUndefined();
  });

  it("passes a later read-through through unchanged", () => {
    expect(roundOneReadThrough({ addressedTs: ASK, readThrough: "1785000060.000100" })).toBe("1785000060.000100");
  });

  it("stays absent when none was named", () => {
    expect(roundOneReadThrough({ addressedTs: ASK, readThrough: undefined })).toBeUndefined();
  });
});

describe("roundOneThreadRefusalLines", () => {
  it("refuses an unread human message with the count, each ts and sender, then the review-thread-delta hatch", () => {
    const decision = unwrap(
      threadDeltaFromMessages({
        addressedTs: ASK,
        cleared: false,
        nowIso: NOW,
        rawMessages: THREAD,
        readThrough: "1785000060.000100",
      }),
    );
    expect(roundOneThreadRefusalLines({ decision })).toEqual([
      "review round 1 not opened: 1 human message(s) landed in the thread after this draft's read:",
      "  1785000120.000100 from U_B",
      ...hatchRefusalLines({
        detail: "1 unread, newest 1785000120.000100",
        hatch: hatchFor({ id: "review-thread-delta" }),
      }),
    ]);
  });

  it("names the --delta-cleared route in the refusal", () => {
    const decision = unwrap(
      threadDeltaFromMessages({
        addressedTs: ASK,
        cleared: false,
        nowIso: NOW,
        rawMessages: THREAD,
        readThrough: undefined,
      }),
    );
    expect(roundOneThreadRefusalLines({ decision }).join("\n")).toContain("--delta-cleared");
  });

  it("opens the round once the caller cleared the delta", () => {
    const decision = unwrap(
      threadDeltaFromMessages({
        addressedTs: ASK,
        cleared: true,
        nowIso: NOW,
        rawMessages: THREAD,
        readThrough: undefined,
      }),
    );
    expect(roundOneThreadRefusalLines({ decision })).toEqual([]);
  });

  it("opens the round when the read reached the newest human message", () => {
    const decision = unwrap(
      threadDeltaFromMessages({
        addressedTs: ASK,
        cleared: false,
        nowIso: NOW,
        rawMessages: THREAD,
        readThrough: "1785000120.000100",
      }),
    );
    expect(roundOneThreadRefusalLines({ decision })).toEqual([]);
  });

  it("opens the round when nothing followed the ask and the worker named the ask's own ts", () => {
    const decision = unwrap(
      threadDeltaFromMessages({
        addressedTs: ASK,
        cleared: false,
        nowIso: NOW,
        rawMessages: [THREAD[0]],
        readThrough: roundOneReadThrough({ addressedTs: ASK, readThrough: ASK }),
      }),
    );
    expect(roundOneThreadRefusalLines({ decision })).toEqual([]);
  });
});
