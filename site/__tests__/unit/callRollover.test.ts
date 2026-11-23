/*
 * The page's half of a quiet rollover, stepped over plain inputs: only the page's own live call starts one, a
 * replayed event never starts a second, a successor that opens settles it with no reconnect, and one that fails
 * hands the old call to the visible reconnect loop. The floor a held ask waits on is `callRolloverFloor.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  askStage,
  CONTEXT_URGENT_DETAIL,
  callOpenModeOf,
  QuietRollover,
  ROLLOVER_IDLE,
  type RolloverInput,
  type RolloverState,
  rolloverTransition,
} from "../../lib/callRollover";
import { PLAN_CALL_LIMITS } from "../../lib/planCallContract";

const REASON = "rolled over in a pause";
const REQUESTED: RolloverInput = { callId: "c-1", closing: false, current: true, kind: "requested", reason: REASON };
const OPENING: RolloverState = { kind: "opening", previousCallId: "c-1", reason: REASON };

describe("callOpenModeOf", () => {
  it("reads each of the three modes, and refuses an absent, legacy or unknown one rather than reading it as fresh", () => {
    expect(["fresh", "reconnect", "rollover"].map((value) => callOpenModeOf({ value }))).toEqual([
      "fresh",
      "reconnect",
      "rollover",
    ]);
    expect([undefined, true, "Rollover", ""].map((value) => callOpenModeOf({ value }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("rolloverTransition", () => {
  it("replaces the page's own live call once, remembering which call it replaced", () => {
    expect(rolloverTransition({ input: REQUESTED, state: ROLLOVER_IDLE })).toEqual({
      effect: { kind: "replace", reason: REASON },
      state: OPENING,
    });
  });

  it("ignores a replayed or duplicate request while the successor opens", () => {
    expect(rolloverTransition({ input: REQUESTED, state: OPENING })).toEqual({
      effect: { kind: "none" },
      state: OPENING,
    });
  });

  it("ignores a request on a call already replaced, or one the owner has hung up on", () => {
    const stale = rolloverTransition({ input: { ...REQUESTED, current: false }, state: ROLLOVER_IDLE });
    const closing = rolloverTransition({ input: { ...REQUESTED, closing: true }, state: ROLLOVER_IDLE });
    expect([stale, closing]).toEqual([
      { effect: { kind: "none" }, state: ROLLOVER_IDLE },
      { effect: { kind: "none" }, state: ROLLOVER_IDLE },
    ]);
  });

  it("settles quietly when the successor opens", () => {
    expect(rolloverTransition({ input: { kind: "opened" }, state: OPENING })).toEqual({
      effect: { kind: "settled" },
      state: ROLLOVER_IDLE,
    });
  });

  it("hands a successor that failed to open to the reconnect loop, anchored to the call it replaced", () => {
    expect(rolloverTransition({ input: { kind: "failed", why: "HTTP 503" }, state: OPENING })).toEqual({
      effect: { kind: "retry", previousCallId: "c-1", why: "HTTP 503" },
      state: ROLLOVER_IDLE,
    });
  });

  it("does nothing for an open or a failure with no rollover under way, since that call was an ordinary one", () => {
    const opened = rolloverTransition({ input: { kind: "opened" }, state: ROLLOVER_IDLE });
    const failed = rolloverTransition({ input: { kind: "failed", why: "HTTP 503" }, state: ROLLOVER_IDLE });
    expect([opened, failed]).toEqual([
      { effect: { kind: "none" }, state: ROLLOVER_IDLE },
      { effect: { kind: "none" }, state: ROLLOVER_IDLE },
    ]);
  });

  it("cancels on the owner's hang-up or leaving the page, never retrying, from idle as well", () => {
    expect(rolloverTransition({ input: { kind: "cancelled" }, state: ROLLOVER_IDLE })).toEqual({
      effect: { kind: "none" },
      state: ROLLOVER_IDLE,
    });
  });

  it("cancels a rollover under way on the owner's hang-up or leaving the page, never retrying", () => {
    expect(rolloverTransition({ input: { kind: "cancelled" }, state: OPENING })).toEqual({
      effect: { kind: "none" },
      state: ROLLOVER_IDLE,
    });
  });
});

/** A rollover over fakes that record, in order, what it had the page do and what it journalled; an ask lands at zero. */
function recording(): { readonly rollover: QuietRollover; readonly did: string[] } {
  const did: string[] = [];
  const rollover = new QuietRollover({
    seams: {
      dropped: ({ previousCallId }) => {
        did.push(`dropped ${String(previousCallId)}`);
      },
      journal: ({ detail }) => {
        did.push(`journal: ${detail}`);
      },
      now: () => 0,
      open: () => {
        did.push("open");
      },
      release: ({ why }) => {
        did.push(`release: ${why}`);
      },
      silence: () => {
        did.push("silence");
      },
    },
  });
  return { did, rollover };
}

describe("QuietRollover", () => {
  const request = { callId: "c-1", closing: false, current: true, reason: REASON };

  it("silences, releases with the reason and opens the successor once, however often the event is replayed", () => {
    const { did, rollover } = recording();
    rollover.requested(request);
    rollover.requested(request);
    expect(did).toEqual(["silence", `release: ${REASON}`, "open"]);
  });

  it("settles a successor that opens with no reconnect, and says an ordinary call that opens was not one", () => {
    const { did, rollover } = recording();
    const ordinary = rollover.opened();
    rollover.requested(request);
    expect([ordinary, rollover.opened(), did.length]).toEqual([false, true, 3]);
  });

  it("hands a successor that fails to the reconnect for the call it replaced, and nothing else that ends", () => {
    const { did, rollover } = recording();
    rollover.ended({ why: "an ordinary drop" });
    rollover.requested(request);
    rollover.ended({ why: "the mint answered HTTP 503" });
    rollover.ended({ why: "the retry dropped too" });
    expect(did).toEqual(["silence", `release: ${REASON}`, "open", "dropped c-1"]);
  });

  it("does nothing more when the owner hangs up while the successor opens, and a later request starts a new rollover", () => {
    const { did, rollover } = recording();
    rollover.requested(request);
    rollover.ended({ why: undefined });
    const afterHangUp = rollover.opened();
    rollover.requested({ ...request, callId: "c-2" });
    expect([afterHangUp, did]).toEqual([
      false,
      ["silence", `release: ${REASON}`, "open", "silence", `release: ${REASON}`, "open"],
    ]);
  });
});

/** An ask received at page instant zero with ten minutes of the lifetime left, its call the page's own. */
const ASK = {
  callId: "c-1",
  contextUrgent: false,
  lifetimeRemainingMs: 10 * 60_000,
  reason: REASON,
  standing: () => ({ closing: false, current: true }),
};
/** A meter sample at page instant `nowMs`. */
const at = ({ nowMs }: { nowMs: number }): { nowMs: number } => ({ nowMs });

// The server's quiet reads transcripts, which lag the owner's first words, so the page holds the ask.
describe("QuietRollover's held ask", () => {
  it("journals the ask, then rolls over on the first free floor the page samples, once", () => {
    const { did, rollover } = recording();
    rollover.asked(ASK);
    const beforeFree = [...did];
    rollover.observed({ hold: undefined, ...at({ nowMs: 1_000 }) });
    rollover.observed({ hold: undefined, ...at({ nowMs: 1_080 }) });
    expect([beforeFree, did]).toEqual([
      ["journal: ask received: 600 seconds remain"],
      [
        "journal: ask received: 600 seconds remain",
        "journal: released in a meter pause (calm)",
        "silence",
        `release: ${REASON}`,
        "open",
      ],
    ]);
  });

  it("journals each change in what holds it and each stage it enters, never the same sample twice", () => {
    const { did, rollover } = recording();
    rollover.asked(ASK);
    const urgentAt = 10 * 60_000 - PLAN_CALL_LIMITS.rolloverUrgentMs;
    rollover.observed({ hold: "the owner's turn is still open", ...at({ nowMs: 1_000 }) });
    rollover.observed({ hold: "the owner's turn is still open", ...at({ nowMs: 1_080 }) });
    rollover.observed({ hold: "the voice still owes its turn", ...at({ nowMs: 2_000 }) });
    rollover.observed({ hold: "the voice still owes its turn", ...at({ nowMs: urgentAt }) });
    rollover.observed({ hold: "the owner's meter is not quiet", ...at({ nowMs: urgentAt + 80 }) });
    expect([did, rollover.stage(at({ nowMs: urgentAt + 80 }))!.urgency]).toEqual([
      [
        "journal: ask received: 600 seconds remain",
        "journal: held: the owner's turn is still open",
        "journal: held: the voice still owes its turn",
        "journal: entered urgent: 180 seconds remain",
        "journal: held: the owner's meter is not quiet",
      ],
      "urgent",
    ]);
  });

  // A wall clock stepped forward put a wall-clock deadline into its last stage minutes early.
  it("stays calm while the server names no time left, and replaces that with the remainder it names when urgent", () => {
    const { did, rollover } = recording();
    rollover.asked({ ...ASK, lifetimeRemainingMs: null });
    const far = rollover.stage({ nowMs: 60 * 60_000 });
    rollover.asked({ ...ASK, lifetimeRemainingMs: PLAN_CALL_LIMITS.rolloverUrgentMs });
    expect([far, rollover.stage({ nowMs: 0 }), rollover.stage({ nowMs: 150_000 }), did]).toEqual([
      { remainingMs: undefined, urgency: "calm" },
      { remainingMs: 180_000, urgency: "urgent" },
      { remainingMs: 30_000, urgency: "last" },
      ["journal: ask received", "journal: ask received: 180 seconds remain"],
    ]);
  });

  it("keeps the last stage's remainder when the urgent ask is replayed after it", () => {
    const { rollover } = recording();
    rollover.asked({ ...ASK, lifetimeRemainingMs: PLAN_CALL_LIMITS.rolloverLastMs });
    rollover.asked({ ...ASK, lifetimeRemainingMs: PLAN_CALL_LIMITS.rolloverUrgentMs });
    expect(rollover.stage({ nowMs: 0 })).toEqual({ remainingMs: 30_000, urgency: "last" });
  });

  it("judges whether the call is still the owner's when the floor frees, not when the server asked", () => {
    const { did, rollover } = recording();
    let current = true;
    rollover.asked({ ...ASK, standing: () => ({ closing: false, current }) });
    current = false;
    rollover.observed({ hold: undefined, ...at({ nowMs: 1_000 }) });
    expect(did).toEqual(["journal: ask received: 600 seconds remain", "journal: released in a meter pause (calm)"]);
  });

  it("forgets an ask held when the call ends, so a free floor after it rolls nothing over", () => {
    const { did, rollover } = recording();
    rollover.asked(ASK);
    rollover.ended({ why: undefined });
    rollover.observed({ hold: undefined, ...at({ nowMs: 1_000 }) });
    expect([did, rollover.stage(at({ nowMs: 1_000 }))]).toEqual([
      ["journal: ask received: 600 seconds remain"],
      undefined,
    ]);
  });
});

// A context ask held nine minutes at calm, every pause inside a next-turn hold, until the thread compacted silently
// inside the owner's question.
describe("QuietRollover's context-urgent ask", () => {
  const FAR = { ...ASK, lifetimeRemainingMs: null };

  it("holds a context-urgent ask at urgent while the lifetime is far, naming no remainder, and journals that once", () => {
    const { did, rollover } = recording();
    rollover.asked(FAR);
    const calm = rollover.stage(at({ nowMs: 0 }));
    rollover.asked({ ...FAR, contextUrgent: true });
    rollover.asked({ ...FAR, contextUrgent: true });
    expect([calm, rollover.stage(at({ nowMs: 0 })), did]).toEqual([
      { remainingMs: undefined, urgency: "calm" },
      { remainingMs: undefined, urgency: "urgent" },
      ["journal: ask received", "journal: ask received", `journal: ${CONTEXT_URGENT_DETAIL}`, "journal: ask received"],
    ]);
  });

  it("keeps a call's context urgency through a later ask that does not carry it, as a replay would", () => {
    const { rollover } = recording();
    rollover.asked({ ...FAR, contextUrgent: true });
    rollover.asked(FAR);
    expect(rollover.stage(at({ nowMs: 0 }))).toEqual({ remainingMs: undefined, urgency: "urgent" });
  });

  it("never carries context urgency to an ask on another call", () => {
    const { rollover } = recording();
    rollover.asked({ ...FAR, contextUrgent: true });
    rollover.asked({ ...FAR, callId: "c-2" });
    expect(rollover.stage(at({ nowMs: 0 }))).toEqual({ remainingMs: undefined, urgency: "calm" });
  });

  it("leaves the lifetime's last stage last, since context urgency never lowers a stage", () => {
    const { rollover } = recording();
    rollover.asked({ ...ASK, contextUrgent: true, lifetimeRemainingMs: PLAN_CALL_LIMITS.rolloverLastMs });
    expect(rollover.stage(at({ nowMs: 0 }))).toEqual({ remainingMs: 30_000, urgency: "last" });
  });

  it("releases once on the first free floor, saying it went at urgent", () => {
    const { did, rollover } = recording();
    rollover.asked({ ...FAR, contextUrgent: true });
    rollover.observed({ hold: "the owner's words are inside the rollover quiet", ...at({ nowMs: 1_000 }) });
    rollover.observed({ hold: undefined, ...at({ nowMs: 5_000 }) });
    rollover.observed({ hold: undefined, ...at({ nowMs: 5_080 }) });
    expect(did).toEqual([
      "journal: ask received",
      `journal: ${CONTEXT_URGENT_DETAIL}`,
      "journal: held: the owner's words are inside the rollover quiet",
      "journal: released in a meter pause (urgent)",
      "silence",
      `release: ${REASON}`,
      "open",
    ]);
  });
});

describe("askStage", () => {
  it("raises only calm to urgent for a context-urgent ask, and keeps the lifetime's own stage otherwise", () => {
    const urgentLeft = { atMs: 0, remainingMs: PLAN_CALL_LIMITS.rolloverUrgentMs };
    expect([
      askStage({ ask: { contextUrgent: false, known: undefined }, nowMs: 0 }),
      askStage({ ask: { contextUrgent: true, known: undefined }, nowMs: 0 }),
      askStage({ ask: { contextUrgent: true, known: urgentLeft }, nowMs: 0 }),
      askStage({ ask: { contextUrgent: true, known: urgentLeft }, nowMs: 160_000 }),
    ]).toEqual([
      { remainingMs: undefined, urgency: "calm" },
      { remainingMs: undefined, urgency: "urgent" },
      { remainingMs: 180_000, urgency: "urgent" },
      { remainingMs: 20_000, urgency: "last" },
    ]);
  });
});
