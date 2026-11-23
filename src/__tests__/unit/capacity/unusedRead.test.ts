/**
 * `tickSampleOf` — which tick ledger rows count as a machine reading for `machine unused`, and which are
 * unknown time rather than idle time.
 */
import { describe, expect, it } from "vitest";

import { tickSampleOf } from "../../../capacity/unusedRead.js";

const AT = "2026-09-28T09:00:00.000Z";

/** A ledger row whose capacity source carries `status`, `facts` and `observedAtIso` as given. */
function row({
  status = "read",
  facts = { hold: false, load1: 12.5 },
  observedAtIso = AT,
}: {
  status?: unknown;
  facts?: unknown;
  observedAtIso?: unknown;
} = {}): unknown {
  return { sources: { capacity: { facts, observedAtIso, status } } };
}

describe("tickSampleOf", () => {
  it("reads the load, hold and instant off a read or partial capacity source", () => {
    expect(tickSampleOf({ row: row() })).toStrictEqual({ hold: false, load1: 12.5, observedAtIso: AT });
    expect(tickSampleOf({ row: row({ facts: { hold: true, load1: 40 }, status: "partial" }) })).toStrictEqual({
      hold: true,
      load1: 40,
      observedAtIso: AT,
    });
  });

  it("counts a tick whose capacity was unavailable as no reading, never as an idle machine", () => {
    expect(tickSampleOf({ row: row({ status: "unavailable" }) })).toBe(undefined);
  });

  it("refuses a row with no sources, no capacity, or a malformed load, hold or instant", () => {
    const samples = [
      null,
      { sources: "capacity" },
      { sources: {} },
      row({ facts: "load 12" }),
      row({ facts: { hold: false, load1: "12.5" } }),
      row({ facts: { hold: "no", load1: 12.5 } }),
      row({ observedAtIso: 1_727_510_400 }),
    ].map((one) => tickSampleOf({ row: one }));

    expect(samples).toStrictEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });
});
