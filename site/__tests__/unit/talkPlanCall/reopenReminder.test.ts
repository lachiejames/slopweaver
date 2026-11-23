/**
 * A reopened call's opening window (`lib/talkPlanReopenReminder.ts`). The owner's own words go first, and after three
 * seconds of the owner's silence the voice reminds them where they left off.
 */

import { describe, expect, it } from "vitest";
import { PLAN_CALL_LIMITS, type SequencedEvent } from "../../../lib/planCallContract";
import type { PlanReopenReminder } from "../../../lib/talkPlanProtocol";
import { type ReopenReminderState, reopenReminderStep } from "../../../lib/talkPlanReopenReminder";
import {
  appendsAfter,
  COMPOSITION,
  eventsOf,
  harness,
  heardLine,
  NUDGES,
  SDP_LINE,
  settle,
  transcriptLine,
} from "./harness";

const REMINDER: PlanReopenReminder = {
  previousCallId: "call-0",
  previousEndedIso: "2026-11-06T01:10:00.000Z",
  text: "The owner reopened the call a moment after hanging up. Remind them where you left off.",
};

const WINDOW = PLAN_CALL_LIMITS.reopenReminderSilenceMs;

/** The window's own events on the stream, in order. */
const windowEvents = ({ seen }: { seen: readonly SequencedEvent[] }): SequencedEvent["event"][] =>
  eventsOf({ seen }).filter((event) => event.kind === "reopen-reminder");

/** An event the window recorded, its unset fields `null`. */
const step = (over: Record<string, unknown>): Record<string, unknown> => ({
  acceptedElapsedMs: null,
  failure: null,
  kind: "reopen-reminder",
  previousCallId: "call-0",
  reason: null,
  windowMs: WINDOW,
  ...over,
});

/**
 * A call opened with the given reminder, its stream attached.
 *
 * @returns the harness and every event the stream saw
 */
async function reopened({ reminder = REMINDER }: { reminder?: PlanReopenReminder | null } = {}): Promise<
  ReturnType<typeof harness> & { seen: SequencedEvent[] }
> {
  const h = harness({ script: NUDGES });
  const outcome = await h.call.open({
    composition: { ...COMPOSITION, reopenReminder: reminder },
    offerSdp: "v=0 offer",
  });
  expect(outcome).toEqual({ kind: "open", sdp: "v=0 answer", threadId: "thread-1" });
  const seen: SequencedEvent[] = [];
  h.call.subscribe({ after: 0, listener: (event) => seen.push(event) });
  return { ...h, seen };
}

describe("reopenReminderStep", () => {
  const loaded: ReopenReminderState = { kind: "loaded", reminder: REMINDER };
  const waiting: ReopenReminderState = { armedAtMs: 1_000, kind: "waiting", reminder: REMINDER };

  it("is three seconds of the owner's silence", () => {
    expect(WINDOW).toBe(3_000);
  });

  it("arms once, from a loaded window only", () => {
    expect(reopenReminderStep({ elapsedMs: 1_000, input: { kind: "ready" }, state: loaded })).toEqual({
      effect: "arm",
      state: waiting,
    });
    expect(reopenReminderStep({ elapsedMs: 2_000, input: { kind: "ready" }, state: waiting })).toEqual({
      effect: undefined,
      state: waiting,
    });
    expect(reopenReminderStep({ elapsedMs: 0, input: { kind: "ready" }, state: { kind: "none" } })).toEqual({
      effect: undefined,
      state: { kind: "none" },
    });
  });

  it("hands at a whole window after arming and not a millisecond before", () => {
    expect(reopenReminderStep({ elapsedMs: 1_000 + WINDOW - 1, input: { kind: "deadline" }, state: waiting })).toEqual({
      effect: undefined,
      state: waiting,
    });
    expect(reopenReminderStep({ elapsedMs: 1_000 + WINDOW, input: { kind: "deadline" }, state: waiting })).toEqual({
      effect: "hand",
      state: { kind: "done" },
    });
  });

  it("gives way for good, before or after arming, and never after it is done", () => {
    const giveWay = { kind: "give-way", reason: "speech" } as const;
    expect(reopenReminderStep({ elapsedMs: 0, input: giveWay, state: loaded }).effect).toBe("gave-way");
    expect(reopenReminderStep({ elapsedMs: 2_000, input: giveWay, state: waiting })).toEqual({
      effect: "gave-way",
      state: { kind: "done" },
    });
    expect(reopenReminderStep({ elapsedMs: 9_000, input: giveWay, state: { kind: "done" } }).effect).toBe(undefined);
  });
});

describe("a reopened call's opening window", () => {
  it("hands the reminder after three seconds of the owner's silence, and not before", async () => {
    const h = await reopened();
    const before = h.written.length;
    expect(h.call.reopenReminder.ready()).toBe("armed");
    h.clock.advance({ ms: WINDOW - 1 });
    await settle();
    expect(appendsAfter({ before, h })).toEqual([]);
    h.clock.advance({ ms: 1 });
    await settle();
    expect(appendsAfter({ before, h })).toEqual([{ role: "developer", text: REMINDER.text, threadId: "thread-1" }]);
    expect(windowEvents({ seen: h.seen })).toEqual([
      step({ elapsedMs: 0, phase: "armed" }),
      step({ acceptedElapsedMs: WINDOW, elapsedMs: WINDOW, phase: "handed" }),
    ]);
  });

  it("gives way to the owner's voice on the meter inside the window, and hands nothing after it", async () => {
    const h = await reopened();
    const before = h.written.length;
    h.call.reopenReminder.ready();
    h.clock.advance({ ms: 1_200 });
    expect(h.call.reopenReminder.giveWay({ reason: "speech" })).toBe("gave-way");
    h.clock.advance({ ms: WINDOW * 2 });
    await settle();
    expect(appendsAfter({ before, h })).toEqual([]);
    expect(windowEvents({ seen: h.seen })).toEqual([
      step({ elapsedMs: 0, phase: "armed" }),
      step({ elapsedMs: 1_200, phase: "gave-way", reason: "speech" }),
    ]);
    expect(h.call.reopenReminder.giveWay({ reason: "speech" })).toBe("already");
  });

  it("gives way to the owner's transcribed words, and to the voice speaking first", async () => {
    const heard = await reopened();
    heard.call.reopenReminder.ready();
    heard.clock.advance({ ms: 800 });
    heard.call.receive({ chunk: heardLine({ delta: "so about the" }) });
    expect(windowEvents({ seen: heard.seen })[1]).toEqual(
      step({ elapsedMs: 800, phase: "gave-way", reason: "transcribed" }),
    );
    const spoke = await reopened();
    spoke.call.reopenReminder.ready();
    spoke.clock.advance({ ms: 500 });
    spoke.call.receive({ chunk: transcriptLine({ role: "assistant" }) });
    expect(windowEvents({ seen: spoke.seen })[1]).toEqual(
      step({ elapsedMs: 500, phase: "gave-way", reason: "voice-spoke" }),
    );
  });

  it("gives way to words the owner spoke before the page was even ready, so the window never arms", async () => {
    const h = await reopened();
    h.call.receive({ chunk: heardLine({ delta: "hey" }) });
    expect(h.call.reopenReminder.ready()).toBe("already");
    expect(windowEvents({ seen: h.seen })).toEqual([step({ elapsedMs: 0, phase: "gave-way", reason: "transcribed" })]);
  });

  // The page posts the owner's metered speech the moment it hears it, so it can land before its own `ready`.
  it("gives way to the owner's metered speech that lands before the page's ready, and hands nothing", async () => {
    const h = await reopened();
    const before = h.written.length;
    expect(h.call.reopenReminder.giveWay({ reason: "speech" })).toBe("gave-way");
    expect(h.call.reopenReminder.ready()).toBe("already");
    h.clock.advance({ ms: WINDOW * 2 });
    await settle();
    expect(appendsAfter({ before, h })).toEqual([]);
    expect(windowEvents({ seen: h.seen })).toEqual([step({ elapsedMs: 0, phase: "gave-way", reason: "speech" })]);
  });

  // The voice's words in the same chunk as the SDP land before the handshake loads the reminder.
  it("gives way to the voice speaking inside the handshake, before the reminder loads, and never arms", async () => {
    const h = harness({
      script: {
        ...NUDGES,
        "thread/realtime/start": ({ id }) =>
          `${JSON.stringify({ id, result: {} })}\n${SDP_LINE}${transcriptLine({ role: "assistant" })}`,
      },
    });
    // Its `gave-way` is telemetry emitted before any page subscribed, which the stream does not replay.
    await h.call.open({ composition: { ...COMPOSITION, reopenReminder: REMINDER }, offerSdp: "v=0 offer" });
    const before = h.written.length;
    expect(h.call.reopenReminder.ready()).toBe("already");
    h.clock.advance({ ms: WINDOW * 2 });
    await settle();
    expect(appendsAfter({ before, h })).toEqual([]);
  });

  it("answers unavailable on a call that is not a reopen, and records nothing", async () => {
    const h = await reopened({ reminder: null });
    expect(h.call.reopenReminder.ready()).toBe("unavailable");
    expect(h.call.reopenReminder.giveWay({ reason: "speech" })).toBe("unavailable");
    expect(windowEvents({ seen: h.seen })).toEqual([]);
  });

  it("hands nothing once the owner hangs up inside the window", async () => {
    const h = await reopened();
    h.call.reopenReminder.ready();
    h.clock.advance({ ms: 1_000 });
    const before = h.written.length;
    h.call.stop({ reason: "the owner hung up" });
    h.clock.advance({ ms: WINDOW });
    await settle();
    expect(appendsAfter({ before, h })).toEqual([]);
  });
});
