import { describe, expect, it } from "vitest";

import { parkClearedEvent, parkedEvent } from "../../../handover/parkLineDecode.js";

/** The instant every case carries, so an assertion is about the line rather than about the clock. */
const AT = "2026-10-16T11:01:43.217Z";

describe("parkClearedEvent", () => {
  it("decodes a clear bound to a whole, non-negative position", () => {
    expect(parkClearedEvent({ atIso: AT, payload: { parkIndex: 4, why: "the row is done" } })).toEqual({
      atIso: AT,
      kind: "park-cleared",
      parkIndex: 4,
      why: "the row is done",
    });
  });

  it("leaves a clear naming no whole position undecoded, so no default index clears whichever park sits there", () => {
    expect([
      parkClearedEvent({ atIso: AT, payload: { why: "the row is done" } }),
      parkClearedEvent({ atIso: AT, payload: { parkIndex: 1.5, why: "the row is done" } }),
      parkClearedEvent({ atIso: AT, payload: { parkIndex: "4", why: "the row is done" } }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe("parkedEvent", () => {
  it("leaves a checkpoint naming no session undecoded, so it cannot release a writer it does not name", () => {
    expect(parkedEvent({ atIso: AT, payload: { workspaceRef: "workspace:238" } })).toBeUndefined();
  });
});
