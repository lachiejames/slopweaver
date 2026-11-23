/*
 * `livenessOf`: live until something closed the finding with an instant, and then what closed it and when.
 */
import { describe, expect, it } from "vitest";

import { livenessOf } from "../../../../reflect/briefingSection.js";
import { ranked } from "./harness.js";

describe("livenessOf", () => {
  it("is live when nothing closed it", () => {
    expect(livenessOf({ candidate: ranked() })).toEqual({ kind: "live" });
  });

  it("is live when a closing reference arrived without its instant, since the ledger sets both together", () => {
    expect(livenessOf({ candidate: ranked({ closedBy: "slopweaver#1180" }) })).toEqual({ kind: "live" });
  });

  it("carries what closed it and when", () => {
    const candidate = ranked({ closedAtIso: "2026-09-19T01:30:00.000Z", closedBy: "slopweaver#1180" });
    expect(livenessOf({ candidate })).toEqual({
      closedAtIso: "2026-09-19T01:30:00.000Z",
      closedBy: "slopweaver#1180",
      kind: "regressed",
    });
  });
});
