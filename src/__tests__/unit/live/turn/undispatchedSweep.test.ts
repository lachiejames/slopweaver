/**
 * `undispatchedSweepAction` — the sweep's sixth finding, decided purely.
 *
 * The incident it exists for: a burst-queued follow-up was promoted, given the capture-time
 * `:eyes:` and progress card by a one-shot child session that then exited, and never routed. Every other
 * sweep finding keys on `activeDispatch`, so nothing in the system could see it, and its card stood on
 * `Work out how to answer` in a public channel for six hours.
 *
 * Every case here folds REAL lifecycle events through `foldAskLifecycle` rather than hand-building an
 * `AskLifecycle` literal: the predicate reads `state` and `activeDispatch`, and those are exactly the two
 * fields a hand-built fixture would get to assert into existence.
 */
import { describe, expect, it } from "vitest";

import { type AskLifecycle, type AskLifecycleEvent, foldAskLifecycle } from "../../../../live/ask/lifecycle.js";
import type { RespondDecision } from "../../../../live/turn/tier.js";
import {
  UNDISPATCHED_ABANDON_AFTER_MINUTES,
  undispatchedSweepAction,
} from "../../../../live/turn/undispatchedSweep.js";

const CHANNEL = "C0SWEEP";
const MESSAGE_TS = "1788145953.649839";
const THREAD_TS = "1788138032.262199";
const CAPTURED_ISO = "2026-08-31T04:36:11.402Z";
const CARD_ISO = "2026-08-31T04:36:19.928Z";

/** The ask identity every event in this file carries. */
const IDENTITY = { channel: CHANNEL, messageTs: MESSAGE_TS, threadTs: THREAD_TS } as const;

const DECISION: RespondDecision = {
  confidence: "high",
  needs: [],
  rationale: "a live investigation is needed",
  response: "respond",
  schemaVersion: 1,
  tier: "fresh-visible-session",
  truthMode: "none",
};

/**
 * Fold a list of events into the one ask they all describe.
 *
 * @param events the events, in append order
 * @returns the folded ask
 */
function foldOne({ events }: { events: readonly AskLifecycleEvent[] }): AskLifecycle {
  return [...foldAskLifecycle({ events }).values()][0]!;
}

/** The two events the incident's own record set contains, and nothing after them. */
const CARD_STANDING: readonly AskLifecycleEvent[] = [
  { ...IDENTITY, kind: "captured", surface: "channel", tsIso: CAPTURED_ISO, userId: "U0ASKER" },
  {
    ...IDENTITY,
    kind: "checklist-posted",
    tsIso: CARD_ISO,
    turnId: "turn-1788150978891",
    workingTs: "1788150979.345329",
  },
];

describe("undispatchedSweepAction", () => {
  it("finalises a capture-time card that no session ever routed, past the bound", () => {
    const action = undispatchedSweepAction({
      ask: foldOne({ events: CARD_STANDING }),
      nowIso: "2026-08-31T10:36:19.928Z",
    });
    expect(action?.kind).toBe("undispatched");
    expect(action?.minutes).toBe(360);
    expect(action?.ask).toEqual(IDENTITY);
    expect(action?.reason).toBe(
      "no session ever picked this up — it was seen 360m ago (last event 2026-08-31T04:36:19.928Z) and no " +
        "routing decision was ever recorded for it",
    );
  });

  it("says nothing while the ask is still inside the window a session takes to route one", () => {
    const action = undispatchedSweepAction({
      ask: foldOne({ events: CARD_STANDING }),
      nowIso: "2026-08-31T05:00:19.928Z",
    });
    expect(action).toBe(undefined);
  });

  it("fires at the bound exactly, so the boundary is decided rather than left to a strict inequality", () => {
    const action = undispatchedSweepAction({
      ask: foldOne({ events: CARD_STANDING }),
      nowIso: "2026-08-31T05:06:19.928Z",
    });
    expect(action?.minutes).toBe(UNDISPATCHED_ABANDON_AFTER_MINUTES);
  });

  it("fires on a capture with no card at all, because the :eyes: goes up before the card does", () => {
    const action = undispatchedSweepAction({
      ask: foldOne({ events: [CARD_STANDING[0]!] }),
      nowIso: "2026-08-31T10:36:11.402Z",
    });
    expect(action?.kind).toBe("undispatched");
    expect(action?.minutes).toBe(360);
  });

  it("says nothing about a DISPATCHED ask, which every other sweep arm already owns", () => {
    const action = undispatchedSweepAction({
      ask: foldOne({
        events: [
          ...CARD_STANDING,
          {
            ...IDENTITY,
            decision: DECISION,
            kind: "dispatched",
            leaseExpiresAt: "2026-08-31T05:13:20.569Z",
            tier: "fresh-visible-session",
            tsIso: "2026-08-31T04:37:00.000Z",
          },
        ],
      }),
      nowIso: "2026-08-31T10:36:19.928Z",
    });
    expect(action).toBe(undefined);
  });

  it("says nothing about a lease-expired ask, which the sweep has already reported and finalised", () => {
    // `lease-expired` CLEARS `activeDispatch` (see `supersedesDispatch`), so an arm keyed on that field
    // alone would re-finalise this ask on every lap forever.
    const action = undispatchedSweepAction({
      ask: foldOne({
        events: [
          ...CARD_STANDING,
          {
            ...IDENTITY,
            decision: DECISION,
            kind: "dispatched",
            leaseExpiresAt: "2026-08-31T05:13:20.569Z",
            tier: "fresh-visible-session",
            tsIso: "2026-08-31T04:37:00.000Z",
          },
          { ...IDENTITY, kind: "lease-expired", tsIso: "2026-08-31T05:14:00.000Z" },
        ],
      }),
      nowIso: "2026-08-31T10:36:19.928Z",
    });
    expect(action).toBe(undefined);
  });

  it("says nothing about an ask it has ALREADY finalised, so one sweep never becomes an edit every lap", () => {
    const action = undispatchedSweepAction({
      ask: foldOne({
        events: [
          ...CARD_STANDING,
          {
            ...IDENTITY,
            kind: "dispatch-failed",
            reason: "no session ever picked this up",
            tsIso: "2026-08-31T05:06:19.928Z",
          },
        ],
      }),
      nowIso: "2026-08-31T10:36:19.928Z",
    });
    expect(action).toBe(undefined);
  });

  it("says nothing about an answered ask, however long ago its card went up", () => {
    const action = undispatchedSweepAction({
      ask: foldOne({
        events: [
          ...CARD_STANDING,
          { ...IDENTITY, answerTs: "1788150962.923029", kind: "answered", tsIso: "2026-08-31T04:40:00.000Z" },
        ],
      }),
      nowIso: "2026-08-31T10:36:19.928Z",
    });
    expect(action).toBe(undefined);
  });

  it("says nothing when the last event's instant cannot be read, rather than treating it as long ago", () => {
    const action = undispatchedSweepAction({
      ask: foldOne({ events: [CARD_STANDING[0]!, { ...CARD_STANDING[1]!, tsIso: "not-an-instant" }] }),
      nowIso: "2026-08-31T10:36:19.928Z",
    });
    expect(action).toBe(undefined);
  });
});
