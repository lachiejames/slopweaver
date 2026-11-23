/*
 * The page's half of a call surviving the voice's renderer dying under it (`site/lib/overlayCrashRecovery.ts`): what
 * the shell hands over is parsed exactly, the transcript is closed at the crash with the shell's words, and the
 * recovery ends the plan call before it reconnects — never reconnecting beside a session it could not end.
 */
import { describe, expect, it } from "vitest";

import {
  type CrashRecoverySteps,
  type CrashStop,
  crashedTranscriptWire,
  crashRecoveryFailure,
  type OverlayCrashRecovery,
  overlayCrashRecoveryOf,
  recoverCrashedCall,
} from "../../lib/overlayCrashRecovery";
import type { TalkTranscriptWire } from "../../lib/talkTranscript";

const TRANSCRIPT = "0442ee9a-dd6b-47ba-bb03-4ebead9df434";
const PLAN = "6f1c2d3e-4a5b-4c6d-8e7f-901234567890";
const WRITE = "1b2c3d4e-5f60-4a71-8b92-a3b4c5d6e7f8";
const WHY = "the voice window's renderer crashed (crashed, exit 133)";

const RECOVERY: OverlayCrashRecovery = {
  crashedAtIso: "2026-10-25T12:43:23.000Z",
  planCallId: PLAN,
  reconnect: true,
  transcriptCallId: TRANSCRIPT,
  why: WHY,
};

describe("overlayCrashRecoveryOf", () => {
  it("takes exactly what the shell holds", () => {
    expect(overlayCrashRecoveryOf({ value: { ...RECOVERY } })).toEqual(RECOVERY);
  });

  it("takes a call that died before it was minted", () => {
    expect(overlayCrashRecoveryOf({ value: { ...RECOVERY, planCallId: null } })).toEqual({
      ...RECOVERY,
      planCallId: null,
    });
  });

  it("reads the shell's null, and an older shell's nothing, as no recovery", () => {
    expect(overlayCrashRecoveryOf({ value: null })).toBe(undefined);
    expect(overlayCrashRecoveryOf({ value: undefined })).toBe(undefined);
  });

  it("drops an id that is not a call id, upper case included", () => {
    expect(overlayCrashRecoveryOf({ value: { ...RECOVERY, transcriptCallId: "../x" } })).toBe(undefined);
    expect(overlayCrashRecoveryOf({ value: { ...RECOVERY, planCallId: PLAN.toUpperCase() } })).toBe(undefined);
  });

  it("drops a reason with a line break, an empty one, and one past the bound", () => {
    expect(overlayCrashRecoveryOf({ value: { ...RECOVERY, why: "a\nb" } })).toBe(undefined);
    expect(overlayCrashRecoveryOf({ value: { ...RECOVERY, why: " " } })).toBe(undefined);
    expect(overlayCrashRecoveryOf({ value: { ...RECOVERY, why: "x".repeat(513) } })).toBe(undefined);
  });

  it("drops an instant that is not one, a reconnect that is not a flag, and an extra key", () => {
    expect(overlayCrashRecoveryOf({ value: { ...RECOVERY, crashedAtIso: "yesterday" } })).toBe(undefined);
    expect(overlayCrashRecoveryOf({ value: { ...RECOVERY, reconnect: "yes" } })).toBe(undefined);
    expect(overlayCrashRecoveryOf({ value: { ...RECOVERY, extra: 1 } })).toBe(undefined);
  });
});

describe("crashedTranscriptWire", () => {
  it("closes the dead call at the crash, with the shell's words", () => {
    expect(crashedTranscriptWire({ recovery: RECOVERY, instance: undefined, writeId: WRITE })).toEqual({
      callId: TRANSCRIPT,
      lines: [{ atIso: "2026-10-25T12:43:23.000Z", kind: "closed", why: WHY, writeId: WRITE }],
    });
  });

  // The e2e marker rides the recovery's own post too: it would otherwise bypass the marked sink, landing the walk's close unmarked.
  it("carries the desktop test instance's marker when the test instance recovers", async () => {
    const { steps, wires } = recordingSteps({ closed: true, stop: { kind: "taken" } });
    await recoverCrashedCall({ instance: "e2e", recovery: RECOVERY, steps, writeId: WRITE });
    expect(wires).toEqual([
      {
        callId: TRANSCRIPT,
        instance: "e2e",
        lines: [{ atIso: "2026-10-25T12:43:23.000Z", kind: "closed", why: WHY, writeId: WRITE }],
      },
    ]);
  });
});

/**
 * Steps that record what they were asked, the stop answering `stop`, the close answering `closed`, and the page
 * reporting a call of the owner's own begun meanwhile when `superseded`.
 */
function recordingSteps({
  stop,
  closed,
  superseded = false,
}: {
  stop: CrashStop;
  closed: boolean;
  superseded?: boolean;
}): {
  readonly steps: CrashRecoverySteps;
  readonly calls: string[];
  readonly wires: TalkTranscriptWire[];
} {
  const calls: string[] = [];
  const wires: TalkTranscriptWire[] = [];
  const steps: CrashRecoverySteps = {
    closeTranscript: async ({ wire }) => {
      calls.push("close");
      wires.push(wire);
      return closed;
    },
    reconnect: () => {
      calls.push("reconnect");
    },
    stopPlan: async ({ callId, why }) => {
      calls.push(`stop ${callId} ${why}`);
      return stop;
    },
    superseded: () => {
      calls.push("superseded?");
      return superseded;
    },
  };
  return { calls, steps, wires };
}

describe("recoverCrashedCall", () => {
  it("ends the plan call with the crash, closes the transcript, then reconnects", async () => {
    const { calls, steps, wires } = recordingSteps({ closed: true, stop: { kind: "taken" } });
    const outcome = await recoverCrashedCall({ recovery: RECOVERY, steps, instance: undefined, writeId: WRITE });
    expect(calls).toEqual([`stop ${PLAN} ${WHY}`, "close", "superseded?", "reconnect"]);
    expect(wires).toEqual([crashedTranscriptWire({ recovery: RECOVERY, instance: undefined, writeId: WRITE })]);
    expect(outcome).toEqual({ closed: true, reconnected: true, stop: { kind: "taken" }, superseded: false });
    expect(crashRecoveryFailure({ outcome, recovery: RECOVERY })).toBe(undefined);
  });

  it("has no plan call to end for a call that died before it was minted", async () => {
    const recovery = { ...RECOVERY, planCallId: null };
    const { calls, steps } = recordingSteps({ closed: true, stop: { kind: "taken" } });
    const outcome = await recoverCrashedCall({ recovery, steps, instance: undefined, writeId: WRITE });
    expect(calls).toEqual(["close", "superseded?", "reconnect"]);
    expect(outcome).toEqual({ closed: true, reconnected: true, stop: undefined, superseded: false });
  });

  it("does not reconnect beside a session it could not end, and says so", async () => {
    const stop: CrashStop = { kind: "lost", why: "the console server did not take the stop: TypeError" };
    const { calls, steps } = recordingSteps({ closed: true, stop });
    const outcome = await recoverCrashedCall({ recovery: RECOVERY, steps, instance: undefined, writeId: WRITE });
    expect(calls).toEqual([`stop ${PLAN} ${WHY}`, "close", "superseded?"]);
    expect(outcome.reconnected).toBe(false);
    expect(crashRecoveryFailure({ outcome, recovery: RECOVERY })).toBe(
      "the voice window crashed and its call could not be ended, so it did not reconnect: " +
        "the console server did not take the stop: TypeError",
    );
  });

  it("still reconnects when the closing line was refused", async () => {
    const { calls, steps } = recordingSteps({ closed: false, stop: { kind: "taken" } });
    const outcome = await recoverCrashedCall({ recovery: RECOVERY, steps, instance: undefined, writeId: WRITE });
    expect(calls).toEqual([`stop ${PLAN} ${WHY}`, "close", "superseded?", "reconnect"]);
    expect(outcome).toEqual({ closed: false, reconnected: true, stop: { kind: "taken" }, superseded: false });
  });

  it("leaves the page to a call the owner began while the posts were out, and shows no failure", async () => {
    const { calls, steps } = recordingSteps({ closed: true, stop: { kind: "taken" }, superseded: true });
    const outcome = await recoverCrashedCall({ recovery: RECOVERY, steps, instance: undefined, writeId: WRITE });
    expect(calls).toEqual([`stop ${PLAN} ${WHY}`, "close", "superseded?"]);
    expect(outcome).toEqual({ closed: true, reconnected: false, stop: { kind: "taken" }, superseded: true });
    expect(crashRecoveryFailure({ outcome, recovery: RECOVERY })).toBe(undefined);
  });

  it("ends and closes a second crash inside the minute without reconnecting, and names it", async () => {
    const recovery = { ...RECOVERY, reconnect: false };
    const { calls, steps } = recordingSteps({ closed: true, stop: { kind: "taken" } });
    const outcome = await recoverCrashedCall({ recovery, steps, instance: undefined, writeId: WRITE });
    expect(calls).toEqual([`stop ${PLAN} ${WHY}`, "close", "superseded?"]);
    expect(crashRecoveryFailure({ outcome, recovery })).toBe(
      `the voice window crashed twice inside a minute, so it did not reconnect: ${WHY}`,
    );
  });
});
