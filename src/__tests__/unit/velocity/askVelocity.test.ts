import { describe, expect, it } from "vitest";

import type { AskLifecycleEvent } from "../../../live/ask/lifecycle.js";
import type { RespondDecision } from "../../../live/turn/tier.js";
import { askTurns, askTurnsInSpan } from "../../../velocity/askVelocity.js";

const DECISION: RespondDecision = {
  confidence: "high",
  needs: [],
  rationale: "context and judgement alone answer this",
  response: "respond",
  schemaVersion: 1,
  tier: "inline",
  truthMode: "none",
};

/** One ask, dispatched `dispatchCount` times before it terminates via `answered`. */
function askEvents({
  channel,
  messageTs,
  dispatchCount,
  terminalTsIso,
}: {
  channel: string;
  messageTs: string;
  dispatchCount: number;
  terminalTsIso: string;
}): AskLifecycleEvent[] {
  const base = { channel, messageTs, threadTs: messageTs };
  const events: AskLifecycleEvent[] = [
    { ...base, kind: "captured", surface: "channel", tsIso: "2026-08-30T00:00:00.000Z", userId: "U1" },
  ];
  for (let n = 0; n < dispatchCount; n += 1) {
    events.push({
      ...base,
      decision: DECISION,
      kind: "dispatched",
      leaseExpiresAt: "2026-08-30T01:00:00.000Z",
      tier: "inline",
      tsIso: "2026-08-30T00:0" + String(n) + ":00.000Z",
    });
  }
  events.push({ ...base, answerTs: "9999.1", kind: "answered", tsIso: terminalTsIso });
  return events;
}

describe("askTurns", () => {
  it("counts the dispatched events an ask carried before its terminal event", () => {
    const events = askEvents({
      channel: "C1",
      dispatchCount: 2,
      messageTs: "1.1",
      terminalTsIso: "2026-08-30T05:00:00.000Z",
    });

    expect(askTurns({ events })).toEqual([
      { key: JSON.stringify(["C1", "1.1"]), terminalTsIso: "2026-08-30T05:00:00.000Z", turns: 2 },
    ]);
  });

  it("reports 0 turns for an ask that terminated with no dispatch at all", () => {
    const events = askEvents({
      channel: "C1",
      dispatchCount: 0,
      messageTs: "1.1",
      terminalTsIso: "2026-08-30T05:00:00.000Z",
    });

    expect(askTurns({ events })[0]?.turns).toBe(0);
  });

  it("omits an ask that never reached a terminal event", () => {
    const events: AskLifecycleEvent[] = [
      {
        channel: "C1",
        kind: "captured",
        messageTs: "1.1",
        surface: "channel",
        threadTs: "1.1",
        tsIso: "2026-08-30T00:00:00.000Z",
        userId: "U1",
      },
    ];

    expect(askTurns({ events })).toEqual([]);
  });

  it("tracks two distinct asks independently", () => {
    const events = [
      ...askEvents({ channel: "C1", dispatchCount: 1, messageTs: "1.1", terminalTsIso: "2026-08-30T05:00:00.000Z" }),
      ...askEvents({ channel: "C1", dispatchCount: 3, messageTs: "2.2", terminalTsIso: "2026-08-30T06:00:00.000Z" }),
    ];

    const turns = askTurns({ events });

    expect(turns.map((t) => t.turns).toSorted((a, b) => a - b)).toEqual([1, 3]);
  });
});

describe("askTurnsInSpan", () => {
  it("keeps only asks whose terminal event falls inside [sinceIso, untilIso)", () => {
    const turns = [
      { key: "before", terminalTsIso: "2026-08-29T23:59:00.000Z", turns: 1 },
      { key: "in", terminalTsIso: "2026-08-30T00:00:00.000Z", turns: 2 },
      { key: "after", terminalTsIso: "2026-08-31T00:00:00.000Z", turns: 3 },
    ];

    const kept = askTurnsInSpan({ sinceIso: "2026-08-30T00:00:00.000Z", turns, untilIso: "2026-08-31T00:00:00.000Z" });

    expect(kept.map((t) => t.key)).toEqual(["in"]);
  });
});
