/**
 * `steerRiskEvent` — a `steer-risk` journal line decodes only with one of its two standings and a reason, so an
 * unknown word can neither silence a risk nor raise one nobody named.
 */
import { describe, expect, it } from "vitest";

import { steerRiskEvent } from "../../../handover/steerRiskLineDecode.js";

const AT = "2026-10-22T04:00:50.000Z";

describe("steerRiskEvent", () => {
  it("decodes an at-risk line with its reason", () => {
    expect(steerRiskEvent({ atIso: AT, payload: { standing: "at-risk", why: "no Linear verb" } })).toEqual({
      atIso: AT,
      kind: "steer-risk",
      standing: "at-risk",
      why: "no Linear verb",
    });
  });

  it("decodes a cleared line with its reason", () => {
    expect(steerRiskEvent({ atIso: AT, payload: { standing: "cleared", why: "posted it raw" } })).toEqual({
      atIso: AT,
      kind: "steer-risk",
      standing: "cleared",
      why: "posted it raw",
    });
  });

  it("refuses a standing that is neither word", () => {
    expect(steerRiskEvent({ atIso: AT, payload: { standing: "fine", why: "looks fine" } })).toBeUndefined();
  });

  it("refuses a line that names no reason", () => {
    expect(steerRiskEvent({ atIso: AT, payload: { standing: "at-risk" } })).toBeUndefined();
  });
});
