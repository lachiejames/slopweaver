/**
 * `first-answered` in the ask-lifecycle log — parsed, folded, kept off every terminal reader.
 *
 * Built on the incident's own instants: ask `C0SYN000010/1790924298.202269`, dispatched with a
 * lease to 08:59:55.295Z, its plan posted 07:34:58.645Z. A worker that posted that plan used to write
 * `answered`, which cleared the dispatch and let both reapers close the session that still owed the pull
 * requests. Each case pairs the new kind with the old one so a regression to "a plan is an ending" fails.
 */
import { describe, expect, it } from "vitest";

import {
  type AskLifecycle,
  type AskLifecycleEvent,
  askLifecycleEventLine,
  askLifecycleKey,
  foldAskLifecycle,
  parseAskLifecycleLog,
  terminalAskEventsByKey,
} from "../../../../live/ask/lifecycle.js";

const ASK = { channel: "C0SYN000010", messageTs: "1790924298.202269", threadTs: "1790924298.202269" };
const KEY = askLifecycleKey({ askIdentity: ASK });
const GEN1_LEASE = "2026-10-02T08:59:55.295Z";
const PLAN_AT = "2026-10-02T07:34:58.645Z";
const REARMED_LEASE = "2026-10-02T09:34:58.645Z";

const CAPTURED: AskLifecycleEvent = {
  ...ASK,
  kind: "captured",
  surface: "channel",
  tsIso: "2026-10-02T06:58:20.000Z",
  userId: "U0AAA",
};

/** A `dispatched` event at the given instant, leased to the given expiry. */
function dispatched({ leaseExpiresAt, tsIso }: { leaseExpiresAt: string; tsIso: string }): AskLifecycleEvent {
  return {
    ...ASK,
    decision: {
      confidence: "high",
      needs: [],
      rationale: "worth answering",
      response: "respond",
      schemaVersion: 1,
      tier: "fresh-visible-session",
      truthMode: "current",
    },
    kind: "dispatched",
    leaseExpiresAt,
    tier: "fresh-visible-session",
    tsIso,
  };
}

const GEN1 = dispatched({ leaseExpiresAt: GEN1_LEASE, tsIso: "2026-10-02T06:59:55.295Z" });

const FIRST_ANSWERED: Extract<AskLifecycleEvent, { kind: "first-answered" }> = {
  ...ASK,
  answerDigest: "digest-of-the-plan",
  answerTs: "1790926498.645000",
  kind: "first-answered",
  leaseExpiresAt: REARMED_LEASE,
  owes: "pull-requests",
  tsIso: PLAN_AT,
  what: "open the two pull requests the plan names",
};

const ANSWERED: AskLifecycleEvent = { ...ASK, answerTs: "1790926498.645000", kind: "answered", tsIso: PLAN_AT };

/** Fold a sequence of events and return this ask's entry, which every case below expects to exist. */
function foldOf({ events }: { events: readonly AskLifecycleEvent[] }): AskLifecycle {
  return foldAskLifecycle({ events }).get(KEY)!;
}

describe("first-answered — parsing", () => {
  it("round-trips through the log line with nothing unreadable", () => {
    const text = [CAPTURED, GEN1, FIRST_ANSWERED].map((event) => askLifecycleEventLine({ event })).join("\n");

    const parsed = parseAskLifecycleLog({ text });

    expect(parsed.unreadable).toEqual([]);
    expect(parsed.events[2]).toEqual(FIRST_ANSWERED);
  });

  it("reports a first-answered line missing its re-armed lease as unreadable rather than folding a guess", () => {
    const { leaseExpiresAt: _dropped, ...withoutLease } = FIRST_ANSWERED;
    const text = [
      askLifecycleEventLine({ event: CAPTURED }),
      JSON.stringify({ ...withoutLease, schemaVersion: 1 }),
    ].join("\n");

    expect(parseAskLifecycleLog({ text }).unreadable).toEqual([2]);
  });

  it("refuses an owes value outside the closed set", () => {
    const text = JSON.stringify({ ...FIRST_ANSWERED, owes: "progress-posts", schemaVersion: 1 });

    expect(parseAskLifecycleLog({ text }).unreadable).toEqual([1]);
  });

  it("folds a log with no first-answered line exactly as it always did", () => {
    const text = [CAPTURED, GEN1, ANSWERED].map((event) => askLifecycleEventLine({ event })).join("\n");
    const parsed = parseAskLifecycleLog({ text });
    const entry = foldOf({ events: parsed.events });

    expect(parsed.unreadable).toEqual([]);
    expect(entry.state).toBe("answered");
    expect(entry.activeDispatch).toBeUndefined();
    expect(entry.firstAnswer).toBeUndefined();
  });
});

describe("first-answered — the fold keeps the dispatch and its generation token", () => {
  it("keeps activeDispatch with the ORIGINAL lease after the plan is posted", () => {
    const entry = foldOf({ events: [CAPTURED, GEN1, FIRST_ANSWERED] });

    expect(entry.state).toBe("first-answered");
    expect(entry.activeDispatch!.leaseExpiresAt).toBe(GEN1_LEASE);
    expect(entry.firstAnswer!.leaseExpiresAt).toBe(REARMED_LEASE);
  });

  it("is the pair: an `answered` row clears the dispatch, which is what reaped the builder", () => {
    const entry = foldOf({ events: [CAPTURED, GEN1, ANSWERED] });

    expect(entry.activeDispatch).toBeUndefined();
  });

  it("carries the first answer through every non-terminal event that can follow it", () => {
    const failed: AskLifecycleEvent = {
      ...ASK,
      kind: "failed",
      reason: "workspace gone",
      tsIso: "2026-10-02T07:50:00.000Z",
    };
    const redispatched: AskLifecycleEvent = {
      ...ASK,
      kind: "redispatched",
      reason: "stranded",
      strandedAs: "failed",
      tsIso: "2026-10-02T07:55:00.000Z",
    };
    const checklist: AskLifecycleEvent = {
      ...ASK,
      kind: "checklist-posted",
      tsIso: "2026-10-02T07:55:30.000Z",
      turnId: "turn-2",
      workingTs: "1790927730.000100",
    };
    const gen2 = dispatched({ leaseExpiresAt: "2026-10-02T09:56:00.000Z", tsIso: "2026-10-02T07:56:00.000Z" });

    const entry = foldOf({ events: [CAPTURED, GEN1, FIRST_ANSWERED, failed, CAPTURED, redispatched, checklist, gen2] });

    expect(entry.firstAnswer!.tsIso).toBe(PLAN_AT);
    expect(entry.activeDispatch!.leaseExpiresAt).toBe("2026-10-02T09:56:00.000Z");
  });

  it("clears the first answer on the terminal that ends the turn", () => {
    const finalAnswer: AskLifecycleEvent = {
      ...ASK,
      answerTs: "1790931000.000100",
      kind: "answered",
      tsIso: "2026-10-02T08:50:00.000Z",
    };

    const entry = foldOf({ events: [CAPTURED, GEN1, FIRST_ANSWERED, finalAnswer] });

    expect(entry.firstAnswer).toBeUndefined();
    expect(entry.activeDispatch).toBeUndefined();
  });
});

describe("first-answered — never an ending to a terminal reader", () => {
  it("leaves terminalAskEventsByKey with no entry for the ask", () => {
    expect(terminalAskEventsByKey({ events: [CAPTURED, GEN1, FIRST_ANSWERED] }).has(KEY)).toBe(false);
  });

  it("is the pair: the old `answered` row is a terminal under the same key", () => {
    expect(terminalAskEventsByKey({ events: [CAPTURED, GEN1, ANSWERED] }).get(KEY)!.kind).toBe("answered");
  });
});
