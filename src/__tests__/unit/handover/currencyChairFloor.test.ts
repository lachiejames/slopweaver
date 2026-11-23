/**
 * Whether the supervisor chat's record bears on one card's floor: how far back the walk reached, and whether an
 * unreadable chair's latest tenure could hold a turn after the floor.
 */
import { describe, expect, it } from "vitest";

import { chairReachesFloor, unreadableAfterFloor } from "../../../handover/currencyChairFloor.js";

const FLOOR_ISO = "2026-10-02T10:00:00.000Z";
const FLOOR_MS = Date.parse(FLOOR_ISO);
const CHAIR = "a0000052-0000-4000-8000-000000000055";

describe("chairReachesFloor", () => {
  it("reaches the floor when the walk says so, whatever its earliest instant", () => {
    expect(chairReachesFloor({ coverage: { reachesSince: true }, floorMs: FLOOR_MS })).toBe(true);
  });

  it("does not reach it with no earliest instant to compare", () => {
    expect(chairReachesFloor({ coverage: { earliestIso: undefined, reachesSince: false }, floorMs: FLOOR_MS })).toBe(
      false,
    );
  });

  it("reaches it from exactly the floor, and not from half a millisecond after it", () => {
    expect(chairReachesFloor({ coverage: { earliestIso: FLOOR_ISO, reachesSince: false }, floorMs: FLOOR_MS })).toBe(
      true,
    );
    expect(
      chairReachesFloor({
        coverage: { earliestIso: "2026-10-02T10:00:00.0005Z", reachesSince: false },
        floorMs: FLOOR_MS,
      }),
    ).toBe(false);
  });
});

describe("unreadableAfterFloor", () => {
  it("keeps the gap for a chair whose tenure is still open", () => {
    expect(
      unreadableAfterFloor({
        floorMs: FLOOR_MS,
        unreadable: { claudeSessionId: CHAIR, untilIso: undefined, why: "no transcript on disk" },
      }),
    ).toBe(true);
  });

  it("drops it for a chair that stopped holding the pin at or before the floor", () => {
    expect(
      unreadableAfterFloor({
        floorMs: FLOOR_MS,
        unreadable: { claudeSessionId: CHAIR, untilIso: FLOOR_ISO, why: "no transcript on disk" },
      }),
    ).toBe(false);
    expect(
      unreadableAfterFloor({
        floorMs: FLOOR_MS,
        unreadable: { claudeSessionId: CHAIR, untilIso: "2026-10-01T09:00:00.000Z", why: "no transcript on disk" },
      }),
    ).toBe(false);
  });

  it("keeps it for a tenure that ended after the floor, or whose end will not parse", () => {
    expect(
      unreadableAfterFloor({
        floorMs: FLOOR_MS,
        unreadable: { claudeSessionId: CHAIR, untilIso: "2026-10-02T10:00:01.000Z", why: "no transcript on disk" },
      }),
    ).toBe(true);
    expect(
      unreadableAfterFloor({
        floorMs: FLOOR_MS,
        unreadable: { claudeSessionId: CHAIR, untilIso: "not an instant", why: "no transcript on disk" },
      }),
    ).toBe(true);
  });
});
