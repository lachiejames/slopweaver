import { describe, expect, it } from "vitest";

import { callSeat } from "../../components/voice/useTypedTalkSeat";
import { type GateEntry, standingReads } from "../../lib/relayGate";

/** A seat over fresh refs, with the refs it changes. */
function seatOver(): {
  seat: ReturnType<typeof callSeat>;
  standingData: { current: readonly string[] };
} {
  const standingData: { current: readonly string[] } = { current: [] };
  const seat = callSeat({
    claimedCalls: { current: new Set<string>() },
    gateLog: { current: [] as GateEntry[] },
    generation: { current: 0 },
    planCall: { current: undefined },
    standingData,
  });
  return { seat, standingData };
}

const HELD = { callId: "call-1", claimant: "claimant-1", follow: new AbortController() };

describe("callSeat.hold", () => {
  it("weighs a packed thread's standing data, as a call's mint does", () => {
    const { seat, standingData } = seatOver();
    seat.hold({ held: HELD, packed: true });
    expect(seat.held()).toBe(HELD);
    expect(standingData.current).toEqual(standingReads({ packed: true }));
    expect(standingData.current).toHaveLength(4);
  });

  it("clears what an earlier conversation carried when the thread holds nothing from its start", () => {
    const { seat, standingData } = seatOver();
    seat.hold({ held: HELD, packed: true });
    seat.hold({ held: HELD, packed: false });
    expect(standingData.current).toEqual(standingReads({ packed: false }));
    expect(standingData.current).toHaveLength(3);
  });
});
