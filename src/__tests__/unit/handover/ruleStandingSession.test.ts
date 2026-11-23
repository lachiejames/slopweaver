/**
 * The standing-session half of `handover rule`: how its two flags read, and what the verb says once one is recorded.
 */
import { describe, expect, it } from "vitest";

import {
  standingSessionAnnouncement,
  standingSessionPlan,
} from "../../../cli/commands/handover/ruleStandingSession.js";

const UNTIL = "2026-11-17T13:00:00.000Z";

describe("standingSessionPlan", () => {
  it("declares none by default, an open one bare, and a bounded one with --standing-until", () => {
    expect([
      standingSessionPlan({ values: {} }),
      standingSessionPlan({ values: { "standing-session": true } }),
      standingSessionPlan({ values: { "standing-session": true, "standing-until": ` ${UNTIL} ` } }),
    ]).toEqual([{ standingSession: undefined }, { standingSession: {} }, { standingSession: { untilIso: UNTIL } }]);
  });

  it("refuses a bound with no standing session, and a bound that is not a canonical instant", () => {
    expect([
      standingSessionPlan({ values: { "standing-until": UNTIL } }),
      standingSessionPlan({ values: { "standing-session": true, "standing-until": "2026-11-17" } }),
    ]).toEqual([
      { refusal: expect.stringContaining("pass --standing-session with it") },
      { refusal: expect.stringContaining("is not a canonical UTC instant") },
    ]);
  });
});

describe("standingSessionAnnouncement", () => {
  it("says the seat now stands until its bound, or until a later ruling, and that a bound already past ENDS it", () => {
    const atIso = "2026-11-04T03:00:00.000Z";
    expect([
      standingSessionAnnouncement({ atIso, standingSession: { untilIso: UNTIL } }),
      standingSessionAnnouncement({ atIso, standingSession: {} }),
      standingSessionAnnouncement({ atIso, standingSession: { untilIso: atIso } }),
    ]).toEqual([
      expect.stringContaining(`STANDING SESSION until ${UNTIL}: close-done never parks it`),
      expect.stringContaining("STANDING SESSION until a later --standing-session ruling ends it"),
      `  it ENDS this row's standing session as of ${atIso}: close-done may park the seat again`,
    ]);
  });
});
