/*
 * The page's half of a reopened call's opening window: the `reopen-reminder` event written into the call file and never
 * run as a tool call, the line that measures the three seconds, the watch that gives the window away the moment the owner's
 * microphone hears them, and the route's answer read back.
 * Every seam is a plain fake; nothing is mocked.
 */
import { describe, expect, it } from "vitest";

import { planCallEventHandler } from "../../components/voice/planWiring";
import { reopenReminderLine } from "../../components/voice/planWiringLines";
import { reopenReminderOutcomeOf, reopenWatchStep } from "../../components/voice/reopenReminderClient";
import type { ToolLine } from "../../components/voice/voiceContext";
import type { PlanReopenReminderEvent } from "../../lib/planCallContract";

/** One window event, its unset fields `null`. */
const event = (over: Partial<PlanReopenReminderEvent>): PlanReopenReminderEvent => ({
  acceptedElapsedMs: null,
  elapsedMs: 0,
  failure: null,
  kind: "reopen-reminder",
  phase: "armed",
  previousCallId: "a0000076-0000-4000-8000-000000000083",
  reason: null,
  windowMs: 3_000,
  ...over,
});

/**
 * The page's stream handler over fakes that write down everything asked of them.
 *
 * @returns the handler, the call-file lines, and every other thing it was asked to do
 */
function handler({ current }: { current: boolean }): {
  handle: ReturnType<typeof planCallEventHandler>;
  journal: ToolLine[];
  other: string[];
} {
  const journal: ToolLine[] = [];
  const other: string[] = [];
  const handle = planCallEventHandler({
    act: () => other.push("act"),
    announce: () => other.push("announce"),
    answer: () => other.push("answer"),
    claim: async () => {
      other.push("claim");
      return { kind: "taken" };
    },
    claimed: { current: new Set<string>() },
    closing: () => false,
    current: () => current,
    ended: () => other.push("ended"),
    fail: async () => {
      other.push("fail");
      return undefined;
    },
    held: () => undefined,
    journal: ({ line }) => {
      journal.push(line);
    },
    note: () => other.push("note"),
    progress: () => other.push("progress"),
    rollover: () => other.push("rollover"),
    turnStarted: () => other.push("turnStarted"),
    typedIn: () => other.push("typedIn"),
    usage: () => other.push("usage"),
    written: () => other.push("written"),
  });
  return { handle, journal, other };
}

describe("planCallEventHandler on the opening window", () => {
  it("writes each step to the call file only, never claiming it as a tool call", async () => {
    const h = handler({ current: true });
    h.handle(event({ phase: "armed" }));
    h.handle(event({ acceptedElapsedMs: 3_140, elapsedMs: 3_002, phase: "handed" }));
    await Promise.resolve();
    expect(h.journal.map((line) => [line.name, line.reopenReminder!.elapsedSinceArmedMs])).toEqual([
      ["reopen-reminder", 0],
      ["reopen-reminder", 3_002],
    ]);
    expect(h.other).toEqual([]);
  });

  it("drops a step reaching a page whose call has moved on", () => {
    const h = handler({ current: false });
    h.handle(event({ phase: "armed" }));
    expect([h.journal, h.other]).toEqual([[], []]);
  });
});

describe("reopenReminderLine", () => {
  it("says each step with its milliseconds against the window and carries them as numbers, never as latency", () => {
    const previousCallId = "a0000076-0000-4000-8000-000000000083";
    const window = `3000 ms window, previous call ${previousCallId}`;
    expect(
      [
        event({ phase: "armed" }),
        event({ acceptedElapsedMs: 3_140, elapsedMs: 3_002, phase: "handed" }),
        event({ elapsedMs: 1_200, phase: "gave-way", reason: "speech" }),
        event({ acceptedElapsedMs: 3_500, elapsedMs: 3_000, failure: "it timed out", phase: "failed" }),
      ].map((step) => reopenReminderLine({ event: step })),
    ).toEqual([
      {
        detail: `armed the ${window}`,
        ms: undefined,
        name: "reopen-reminder",
        refused: false,
        reopenReminder: { elapsedSinceArmedMs: 0, phase: "armed", previousCallId, windowMs: 3_000 },
        usage: undefined,
      },
      {
        detail: `handed the reminder after 3002 ms of the ${window}; the voice took it at 3140 ms`,
        ms: undefined,
        name: "reopen-reminder",
        refused: false,
        reopenReminder: { elapsedSinceArmedMs: 3_002, phase: "handed", previousCallId, windowMs: 3_000 },
        usage: undefined,
      },
      {
        detail: `gave way to speech after 1200 ms of the ${window}`,
        ms: undefined,
        name: "reopen-reminder",
        refused: false,
        reopenReminder: { elapsedSinceArmedMs: 1_200, phase: "gave-way", previousCallId, windowMs: 3_000 },
        usage: undefined,
      },
      {
        detail: `could not hand the reminder after 3000 ms of the ${window}: it timed out`,
        ms: undefined,
        name: "reopen-reminder",
        refused: true,
        reopenReminder: { elapsedSinceArmedMs: 3_000, phase: "failed", previousCallId, windowMs: 3_000 },
        usage: undefined,
      },
    ]);
  });
});

describe("reopenWatchStep", () => {
  const read = (over: Partial<Parameters<typeof reopenWatchStep>[0]>): ReturnType<typeof reopenWatchStep> =>
    reopenWatchStep({ answer: "armed", current: true, heard: false, sinceArmedMs: 0, windowMs: 3_000, ...over });

  it("posts speech once the window is armed and the owner has been heard inside it", () => {
    expect(read({ heard: true, sinceArmedMs: 2_999 })).toBe("speech");
    expect(read({ heard: false, sinceArmedMs: 2_999 })).toBe("watch");
  });

  // A word while `ready` is in flight is posted at once, never held past the server's deadline.
  it("posts speech heard while ready is in flight at once, and keeps watching a silent pending window", () => {
    expect(read({ answer: "pending", heard: true })).toBe("speech");
    expect(read({ answer: "pending", heard: false })).toBe("watch");
  });

  it("stops on any answer but armed, a passed window, or a call no longer the page's, whatever was heard", () => {
    expect(read({ answer: "not-armed", heard: true })).toBe("stop");
    expect(read({ sinceArmedMs: 3_000 })).toBe("stop");
    expect(read({ current: false, heard: true })).toBe("stop");
    expect(read({ answer: "pending", current: false })).toBe("stop");
  });
});

describe("reopenReminderOutcomeOf", () => {
  it("reads each answer the window gives, and refuses any other body", () => {
    expect(
      ["armed", "gave-way", "already", "unavailable"].map((outcome) => reopenReminderOutcomeOf({ body: { outcome } })),
    ).toEqual(["armed", "gave-way", "already", "unavailable"]);
    expect(
      [{ outcome: "handed" }, { ok: true }, null, "armed"].map((body) => reopenReminderOutcomeOf({ body })),
    ).toEqual([undefined, undefined, undefined, undefined]);
  });
});
