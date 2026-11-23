/**
 * `releasedRowsOf` — which open runs a session deliberately let go of, as `handover reconcile` publishes them for the
 * Fleet page's doctrine panel. A park releases the writer too, and is not counted here.
 */
import { describe, expect, it } from "vitest";

import type { JournalEvidence } from "../../../handover/assemble.js";
import type { RunEvent } from "../../../handover/ledger.js";
import { releasedRowsOf } from "../../../handover/releasedRows.js";

const STARTED: RunEvent = { atIso: "2026-11-03T01:00:00.000Z", branch: "feat/x", docHash: "abc", kind: "started" };
const LAUNCHED: Extract<RunEvent, { kind: "launched" }> = {
  atIso: "2026-11-03T01:00:01.000Z",
  kind: "launched",
  pid: undefined,
  sessionId: "session-a",
  worktree: "/wt",
};
const RELEASED: Extract<RunEvent, { kind: "released" }> = {
  atIso: "2026-11-03T02:00:00.000Z",
  kind: "released",
  sessionId: "session-a",
  why: "handing off",
};
const PARKED: Extract<RunEvent, { kind: "parked" }> = {
  atIso: "2026-11-03T02:00:00.000Z",
  branch: "feat/x",
  kind: "parked",
  question: "Which slide order?",
  screenTail: "❯ ",
  sessionId: "session-a",
  workspaceRef: "workspace:9",
  worktree: "/wt",
};
const CLAIMED: Extract<RunEvent, { kind: "claimed" }> = {
  atIso: "2026-11-03T03:00:00.000Z",
  host: "claude-code",
  kind: "claimed",
  pid: undefined,
  sessionId: "session-b",
  worktree: "/wt",
  why: "reseating",
};

/**
 * One journal read cleanly.
 *
 * @returns the evidence
 */
function clean({ events }: { events: readonly RunEvent[] }): JournalEvidence {
  return { events, unreadableLines: [] };
}

describe("releasedRowsOf", () => {
  it("names an open run whose writer released it, and nothing else", () => {
    const journals = new Map<string, JournalEvidence>([
      ["b-released", clean({ events: [STARTED, LAUNCHED, RELEASED] })],
      ["a-held", clean({ events: [STARTED, LAUNCHED] })],
      ["c-parked", clean({ events: [STARTED, LAUNCHED, PARKED] })],
      ["d-reclaimed", clean({ events: [STARTED, LAUNCHED, RELEASED, CLAIMED] })],
      ["e-also-released", clean({ events: [STARTED, LAUNCHED, RELEASED] })],
    ]);

    expect(releasedRowsOf({ journals })).toEqual({ ids: ["b-released", "e-also-released"], kind: "read" });
  });

  it("counts a park as parked even when a stale release from a non-holder shares its instant", () => {
    const stale: RunEvent = { ...RELEASED, sessionId: "session-b", why: "stale release" };
    const journals = new Map([["parked", clean({ events: [STARTED, LAUNCHED, stale, PARKED] })]]);

    expect(releasedRowsOf({ journals })).toEqual({ ids: [], kind: "read" });
  });

  it("counts a run parked after its release as parked, never released", () => {
    const parkedLater: RunEvent = { ...PARKED, atIso: "2026-11-03T02:30:00.000Z" };
    const journals = new Map([["x", clean({ events: [STARTED, LAUNCHED, RELEASED, parkedLater] })]]);

    expect(releasedRowsOf({ journals })).toEqual({ ids: [], kind: "read" });
  });

  it("counts a park as parked when a stale release from a non-holder lands after it", () => {
    const stale: RunEvent = { ...RELEASED, atIso: "2026-11-03T02:30:00.000Z", sessionId: "session-b" };
    const journals = new Map([["x", clean({ events: [STARTED, LAUNCHED, PARKED, stale] })]]);

    expect(releasedRowsOf({ journals })).toEqual({ ids: [], kind: "read" });
  });

  it("counts a run as parked when its own holder appends a release after a park that still stands", () => {
    const late: RunEvent = { ...RELEASED, atIso: "2026-11-03T02:00:01.000Z", why: "stale concurrent release" };
    const journals = new Map([["x", clean({ events: [STARTED, LAUNCHED, PARKED, late] })]]);

    expect(releasedRowsOf({ journals })).toEqual({ ids: [], kind: "read" });
  });

  it("still counts a release when a stale park from a session that never held the run lands after it", () => {
    const claimedByA: RunEvent = { ...CLAIMED, atIso: "2026-11-03T01:30:00.000Z", sessionId: "session-a" };
    const launchedByB: RunEvent = { ...LAUNCHED, sessionId: "session-b" };
    const stalePark: RunEvent = { ...PARKED, atIso: "2026-11-03T02:30:00.000Z", sessionId: "session-b" };
    const journals = new Map([["x", clean({ events: [STARTED, launchedByB, claimedByA, RELEASED, stalePark] })]]);

    expect(releasedRowsOf({ journals })).toEqual({ ids: ["x"], kind: "read" });
  });

  it("does not count a run a park let go of once that park is cleared", () => {
    const cleared: RunEvent = { atIso: "2026-11-03T02:30:00.000Z", kind: "park-cleared", parkIndex: 2, why: "woken" };
    const journals = new Map([["x", clean({ events: [STARTED, LAUNCHED, PARKED, cleared] })]]);

    expect(releasedRowsOf({ journals })).toEqual({ ids: [], kind: "read" });
  });

  it("does not count a released run that has since finished", () => {
    const finished: RunEvent = { atIso: "2026-11-03T04:00:00.000Z", kind: "finished", residue: [] };
    const journals = new Map([["done", clean({ events: [STARTED, LAUNCHED, RELEASED, finished] })]]);

    expect(releasedRowsOf({ journals })).toEqual({ ids: [], kind: "read" });
  });

  it("reads an empty board as a measured empty", () => {
    expect(releasedRowsOf({ journals: new Map() })).toEqual({ ids: [], kind: "read" });
  });

  it("refuses the whole count when one journal carries a line it could not read, naming each", () => {
    const journals = new Map<string, JournalEvidence>([
      ["fine", clean({ events: [STARTED, LAUNCHED, RELEASED] })],
      ["z-broken", { events: [STARTED], unreadableLines: [3] }],
      ["m-broken", { events: [STARTED], unreadableLines: [1, 2] }],
    ]);

    expect(releasedRowsOf({ journals })).toEqual({
      kind: "unread",
      unreadableIds: ["m-broken", "z-broken"],
      why: "2 run journal(s) carry a line this build could not read",
    });
  });
});
