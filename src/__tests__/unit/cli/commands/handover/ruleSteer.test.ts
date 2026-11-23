/**
 * `handover rule --explicit-steer [--deliver-by <iso>]` read into the shape a ruling carries. An explicit steer
 * overrides every standing rule for that instance, and the instant the owner named is what
 * `steer-at-risk` watches, so it must be exact or refused.
 */
import { describe, expect, it } from "vitest";

import { explicitSteerPlan } from "../../../../../cli/commands/handover/ruleSteer.js";

describe("explicitSteerPlan", () => {
  it("reads no steer from an ordinary ruling", () => {
    expect(explicitSteerPlan({ values: {} })).toEqual({ explicitSteer: undefined });
  });

  it("reads a steer with no instant, and one with the canonical instant the owner named", () => {
    expect([
      explicitSteerPlan({ values: { "explicit-steer": true } }),
      explicitSteerPlan({ values: { "deliver-by": " 2026-10-22T05:00:00.000Z ", "explicit-steer": true } }),
    ]).toEqual([{ explicitSteer: {} }, { explicitSteer: { deliverByIso: "2026-10-22T05:00:00.000Z" } }]);
  });

  it("refuses an instant that is not canonical UTC, since the monitor compares it exactly", () => {
    expect(explicitSteerPlan({ values: { "deliver-by": "Friday 4pm", "explicit-steer": true } })).toEqual({
      refusal:
        '--deliver-by "Friday 4pm" is not a canonical UTC instant (YYYY-MM-DDTHH:MM:SS.sssZ, as toISOString() writes ' +
        "it) — the steer-at-risk monitor compares it exactly",
    });
  });

  it("refuses --deliver-by on a ruling that is not an explicit steer", () => {
    expect(explicitSteerPlan({ values: { "deliver-by": "2026-10-22T05:00:00.000Z" } })).toEqual({
      refusal: "--deliver-by names when an EXPLICIT STEER is due — pass --explicit-steer with it",
    });
  });
});
