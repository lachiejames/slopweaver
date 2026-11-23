/**
 * `staleHolderReason` — the one dispatch over the two events decided about a run's holder before they are
 * appended. The journal round trip through `applyRowEvent` is `./rowEvent/orphaned.test.ts`'s and
 * `./rowEvent/parked.test.ts`'s; this pins the pure read.
 */
import { describe, expect, it } from "vitest";

import type { RunEvent } from "../../../handover/ledger.js";
import { staleHolderReason } from "../../../handover/staleHolder.js";

const LAUNCHED: RunEvent = {
  atIso: "2026-10-04T03:00:00.000Z",
  host: "claude-code",
  kind: "launched",
  pid: 4242,
  sessionId: "session-a",
  worktree: "/wt",
};
const STARTED: RunEvent = { atIso: "2026-10-04T02:00:00.000Z", branch: "feat/x", docHash: "h", kind: "started" };

const parked = ({ sessionId }: { sessionId: string }): RunEvent => ({
  atIso: "2026-10-04T04:00:00.000Z",
  branch: "feat/x",
  kind: "parked",
  question: "Which slide order?",
  screenTail: "❯ ",
  sessionId,
  workspaceRef: "workspace:9",
  worktree: "/wt",
});

describe("staleHolderReason", () => {
  it("passes a park naming the run's holder", () => {
    const events = [STARTED, LAUNCHED];

    expect(staleHolderReason({ cycle: events, event: parked({ sessionId: "session-a" }), events })).toBe(undefined);
  });

  it("refuses a park naming a session that does not hold the run", () => {
    const events = [STARTED, LAUNCHED];

    expect(staleHolderReason({ cycle: events, event: parked({ sessionId: "session-b" }), events })).toBe(
      "the run is now held by session-a, not session-b; the park was decided about a run that has since changed hands",
    );
  });

  it("refuses a reap over a cycle whose last event moved", () => {
    const events = [STARTED, LAUNCHED];
    const orphaned: RunEvent = {
      atIso: "2026-10-04T05:00:00.000Z",
      cycleEvents: 2,
      deadSessionId: "session-a",
      kind: "orphaned",
      lastEventIso: "2026-10-04T02:30:00.000Z",
    };

    expect(staleHolderReason({ cycle: events, event: orphaned, events })).toBe(
      "the cycle's last event is now at 2026-10-04T03:00:00.000Z, not 2026-10-04T02:30:00.000Z; it moved after the reap was decided",
    );
  });

  it("judges no other kind", () => {
    expect(staleHolderReason({ cycle: [], event: STARTED, events: [] })).toBe(undefined);
  });
});
