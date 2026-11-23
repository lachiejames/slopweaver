/**
 * `unpickedSteerGate.ts` — the tick is the deadline for every steer registered at or before it STARTED, and a steer
 * carrying a decision, or registered after the start, or with no instant to judge, is passed.
 */
import { describe, expect, it } from "vitest";

import { type JudgedSteer, judgeUnpickedSteers } from "../../../supervisor/unpickedSteerGate.js";

/** When the judged tick started. */
const STARTED = "2026-10-06T14:00:00.000Z";

/**
 * One steer on a card, missed by a pass unless the verdict says otherwise.
 *
 * @param turnId the steer's own turn
 * @param registeredAtIso when its relay row registered
 * @param verdict what the Queue reads of it
 * @returns the steer
 */
function steer({
  turnId,
  registeredAtIso = "2026-10-06T13:00:00.000Z",
  verdict = { kind: "reverted", passFinalisedIso: "2026-10-06T13:30:00.000Z", reason: "missed-pass" },
}: {
  turnId: string;
  registeredAtIso?: string;
  verdict?: JudgedSteer["verdict"];
}): JudgedSteer {
  return {
    cardKey: "ask:the-card",
    heard: "do the thing",
    registeredAtIso,
    relaySlug: `talk-${turnId}`,
    turnId,
    verdict,
  };
}

describe("judgeUnpickedSteers", () => {
  it("refuses every undecided steer registered before the tick started, whatever its Queue state", () => {
    const missed = steer({ turnId: "missed" });
    const down = steer({ turnId: "down", verdict: { kind: "reverted", reason: "chair-down" } });
    const landing = steer({ turnId: "landing", verdict: { kind: "reverted", reason: "landing-missing" } });
    const waiting = steer({ turnId: "waiting", verdict: { kind: "awaiting" } });
    const unread = steer({ turnId: "unread", verdict: { kind: "unread", why: "the doc did not read" } });

    expect(
      judgeUnpickedSteers({
        read: { kind: "read", steers: [missed, down, landing, waiting, unread], undecodedRelays: 0 },
        startedIso: STARTED,
      }),
    ).toStrictEqual({
      kind: "refused",
      steers: [missed, down, landing, waiting, unread],
      undated: [],
      undecodedRelays: 0,
    });
  });

  it("refuses a steer registered at the tick's start instant exactly", () => {
    const atStart = steer({ registeredAtIso: STARTED, turnId: "at-start" });

    expect(
      judgeUnpickedSteers({ read: { kind: "read", steers: [atStart], undecodedRelays: 0 }, startedIso: STARTED }),
    ).toStrictEqual({ kind: "refused", steers: [atStart], undated: [], undecodedRelays: 0 });
  });

  it("passes a steer registered after the tick started — it is the next tick's", () => {
    const later = steer({
      registeredAtIso: "2026-10-06T14:00:00.001Z",
      turnId: "later",
      verdict: { kind: "awaiting" },
    });

    expect(
      judgeUnpickedSteers({ read: { kind: "read", steers: [later], undecodedRelays: 2 }, startedIso: STARTED }),
    ).toStrictEqual({ kind: "clean", undated: [], undecodedRelays: 2 });
  });

  it("passes a settled steer and a card somebody chose to keep or restore", () => {
    const settled = steer({
      turnId: "settled",
      verdict: {
        action: { atIso: "2026-10-06T13:10:00.000Z", kind: "intake-mark", markKind: "answered", witness: "PR #1" },
        kind: "settled",
      },
    });
    const kept = steer({ turnId: "kept", verdict: { kind: "reverted", reason: "kept", why: "left up on purpose" } });
    const restored = steer({ turnId: "restored", verdict: { kind: "reverted", reason: "restored", why: "reopened" } });

    expect(
      judgeUnpickedSteers({
        read: { kind: "read", steers: [settled, kept, restored], undecodedRelays: 0 },
        startedIso: STARTED,
      }),
    ).toStrictEqual({ kind: "clean", undated: [], undecodedRelays: 0 });
  });

  it("passes a steer whose registration does not parse, and names it beside the owed ones", () => {
    const undated = steer({ registeredAtIso: "not-a-date", turnId: "undated", verdict: { kind: "unread", why: "x" } });
    const owed = steer({ turnId: "owed" });

    expect(
      judgeUnpickedSteers({ read: { kind: "read", steers: [undated, owed], undecodedRelays: 1 }, startedIso: STARTED }),
    ).toStrictEqual({ kind: "refused", steers: [owed], undated: [undated], undecodedRelays: 1 });
  });

  it("returns an unreadable read as unreadable, never clean", () => {
    expect(
      judgeUnpickedSteers({ read: { kind: "unreadable", why: "talk/relays.jsonl did not read" }, startedIso: STARTED }),
    ).toStrictEqual({ kind: "unreadable", why: "talk/relays.jsonl did not read" });
  });

  it("refuses to judge a tick whose own start does not parse", () => {
    expect(
      judgeUnpickedSteers({ read: { kind: "read", steers: [], undecodedRelays: 0 }, startedIso: "soon" }),
    ).toStrictEqual({ kind: "unreadable", why: "the tick's start soon does not parse, so no deadline can be judged" });
  });

  it("is clean over no steers at all", () => {
    expect(
      judgeUnpickedSteers({ read: { kind: "read", steers: [], undecodedRelays: 0 }, startedIso: STARTED }),
    ).toStrictEqual({ kind: "clean", undated: [], undecodedRelays: 0 });
  });
});
