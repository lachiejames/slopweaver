/**
 * Which `read_screen` call answers with the frame the owner's look ask already took, rather than capturing their screen a
 * second time: the same turn of the owner's, within {@link ASK_FRAME_REUSE_MS} of the ask's look beginning.
 */
import { describe, expect, it } from "vitest";

import { ASK_FRAME_REUSE_MS, type AskFrame, askFrameFor } from "../../components/voice/screenLookSeam";

describe("askFrameFor", () => {
  const kept: AskFrame = {
    atMs: 1_000,
    ownerTurnId: "t-1",
    shot: Promise.resolve({
      answer: undefined,
      detail: "no screen shared",
      looked: undefined,
      output: undefined,
      relayScreen: { kind: "none", reason: "screen-not-shared" },
    }),
  };

  it("answers the same turn's read_screen with the ask's frame, up to the reuse window and not past it", () => {
    expect(askFrameFor({ ownerTurnId: "t-1", kept, nowMs: 1_000 })).toBe(kept);
    expect(askFrameFor({ ownerTurnId: "t-1", kept, nowMs: 1_000 + ASK_FRAME_REUSE_MS })).toBe(kept);
    expect(askFrameFor({ ownerTurnId: "t-1", kept, nowMs: 1_001 + ASK_FRAME_REUSE_MS })).toBeUndefined();
  });

  it("never answers another turn of the owner's, an unplaced turn, or with nothing kept", () => {
    expect(askFrameFor({ ownerTurnId: "t-2", kept, nowMs: 1_000 })).toBeUndefined();
    expect(askFrameFor({ ownerTurnId: undefined, kept, nowMs: 1_000 })).toBeUndefined();
    expect(
      askFrameFor({ ownerTurnId: "t-1", kept: { ...kept, ownerTurnId: undefined }, nowMs: 1_000 }),
    ).toBeUndefined();
    expect(askFrameFor({ ownerTurnId: "t-1", kept: undefined, nowMs: 1_000 })).toBeUndefined();
  });

  it("holds the window at twice the measured lag of the thread's own read_screen, 7–8 s", () => {
    expect(ASK_FRAME_REUSE_MS).toBe(15_000);
  });
});
