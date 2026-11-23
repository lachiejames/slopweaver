/**
 * BLOCKED ON THE OWNER, in the ask-lifecycle log: the two events, what the fold does with them, and the
 * one property the whole feature rests on — an ask waiting on the owner is never terminal.
 */
import { describe, expect, it } from "vitest";
import {
  type AskLifecycleEvent,
  askLifecycleKey,
  type BlockedOnHumanEvent,
  type CapturedEvent,
  foldAskLifecycle,
  parseAskLifecycleLog,
  terminalAskEventsByKey,
  terminalAskLifecycleEvent,
  type UnblockedEvent,
} from "../../../../live/ask/lifecycle.js";
import type { RespondDecision } from "../../../../live/turn/tier.js";

const BASE = {
  channel: "C1",
  messageTs: "1785000000.000100",
  threadTs: "1785000000.000100",
  tsIso: "2026-09-07T00:05:00.000Z",
};

const CAPTURED: CapturedEvent = { ...BASE, kind: "captured", surface: "channel", userId: "U_ASKER" };

const A_DECISION: RespondDecision = {
  confidence: "high",
  needs: [],
  rationale: "this needs a real look",
  response: "respond",
  schemaVersion: 1,
  tier: "fresh-visible-session",
  truthMode: "none",
};

const BLOCKED: BlockedOnHumanEvent = {
  ...BASE,
  kind: "blocked-on-human",
  need: "sign-in",
  stepText: "Waiting on the owner: sign in to Google Cloud locally so the monitor can deploy",
  tsIso: "2026-09-07T00:20:00.000Z",
  what: "sign in to Google Cloud locally so the monitor can deploy",
};

const UNBLOCKED: UnblockedEvent = {
  ...BASE,
  kind: "unblocked",
  lifted: { need: "sign-in", what: "sign in to Google Cloud locally so the monitor can deploy" },
  note: "signed in to Google Cloud",
  tsIso: "2026-09-07T09:00:00.000Z",
};

/** Fold a list of events the way every reader of this log does. */
function fold({ events }: { events: readonly AskLifecycleEvent[] }) {
  return foldAskLifecycle({ events }).get(askLifecycleKey({ askIdentity: BASE }))!;
}

describe("blocked-on-human in the ask lifecycle", () => {
  it("is not terminal, so an ask waiting on the owner is never counted as done", () => {
    expect(terminalAskLifecycleEvent({ event: BLOCKED })).toBeUndefined();
    expect(terminalAskLifecycleEvent({ event: UNBLOCKED })).toBeUndefined();
    expect(terminalAskEventsByKey({ events: [CAPTURED, BLOCKED, UNBLOCKED] }).size).toBe(0);
  });

  it("sets the fold's outstanding block and ends the dispatch the worker was holding", () => {
    const dispatched: AskLifecycleEvent = {
      ...BASE,
      decision: A_DECISION,
      kind: "dispatched",
      leaseExpiresAt: "2026-09-07T02:05:00.000Z",
      tier: "fresh-visible-session",
      tsIso: "2026-09-07T00:06:00.000Z",
    };
    const entry = fold({ events: [CAPTURED, dispatched, BLOCKED] });
    expect(entry.state).toBe("blocked-on-human");
    expect(entry.blockedOnHuman?.what).toBe("sign in to Google Cloud locally so the monitor can deploy");
    expect(entry.activeDispatch).toBeUndefined();
  });

  it("clears the outstanding block on unblocked, and the unblocked event still names what it lifted", () => {
    const entry = fold({ events: [CAPTURED, BLOCKED, UNBLOCKED] });
    expect(entry.state).toBe("unblocked");
    expect(entry.blockedOnHuman).toBeUndefined();
    expect(entry.lastEvent.kind).toBe("unblocked");
    expect(UNBLOCKED.lifted.need).toBe("sign-in");
  });

  it("keeps the block standing through a later event that is not an unblock", () => {
    const posted: AskLifecycleEvent = {
      ...BASE,
      kind: "checklist-posted",
      tsIso: "2026-09-07T00:30:00.000Z",
      turnId: "turn-1",
      workingTs: "1785000000.000150",
    };
    expect(fold({ events: [CAPTURED, BLOCKED, posted] }).blockedOnHuman?.need).toBe("sign-in");
  });

  it("keeps the block standing through a re-capture, so a redelivered frame cannot erase it", () => {
    const entry = fold({ events: [CAPTURED, BLOCKED, { ...CAPTURED, tsIso: "2026-09-07T01:00:00.000Z" }] });
    expect(entry.state).toBe("captured");
    expect(entry.blockedOnHuman?.what).toBe("sign in to Google Cloud locally so the monitor can deploy");
  });

  it("takes a second block after a resume, so one row is one block", () => {
    const second: BlockedOnHumanEvent = {
      ...BLOCKED,
      need: "risky-approval",
      tsIso: "2026-09-07T10:00:00.000Z",
      what: "say go on deploying this monitor to production",
    };
    const entry = fold({ events: [CAPTURED, BLOCKED, UNBLOCKED, second] });
    expect(entry.blockedOnHuman?.need).toBe("risky-approval");
    expect(entry.blockedOnHuman?.what).toBe("say go on deploying this monitor to production");
  });

  it("round-trips both events through the log", () => {
    const text = [BLOCKED, UNBLOCKED].map((event) => JSON.stringify({ ...event, schemaVersion: 1 })).join("\n");
    const parsed = parseAskLifecycleLog({ text });
    expect(parsed.unreadable).toEqual([]);
    expect(parsed.events).toEqual([BLOCKED, UNBLOCKED]);
  });

  it("carries the tag ts when the second, confirmed block event records one", () => {
    const confirmed: BlockedOnHumanEvent = { ...BLOCKED, tagTs: "1785000900.000200" };
    const parsed = parseAskLifecycleLog({ text: JSON.stringify({ ...confirmed, schemaVersion: 1 }) });
    expect(parsed.events[0]).toEqual(confirmed);
    expect(fold({ events: [CAPTURED, BLOCKED, confirmed] }).blockedOnHuman?.tagTs).toBe("1785000900.000200");
  });

  it("refuses a block naming a need nothing branches on", () => {
    const text = JSON.stringify({ ...BLOCKED, need: "vibes", schemaVersion: 1 });
    expect(parseAskLifecycleLog({ text }).unreadable).toEqual([1]);
  });

  it("refuses an unblock that cannot say which block it lifted", () => {
    const text = JSON.stringify({ ...BASE, kind: "unblocked", note: "did it", schemaVersion: 1 });
    expect(parseAskLifecycleLog({ text }).unreadable).toEqual([1]);
  });
});
