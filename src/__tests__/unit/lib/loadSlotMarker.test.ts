/**
 * A load-slot lane's marker as pure text: the busy name a lease is written as, the lease read back out of one, and
 * what a lane's listing says it holds. No filesystem — the renames between these states are `loadSlotLanes.test.ts`'s.
 */
import { describe, expect, it } from "vitest";

import {
  FREE_MARKER,
  laneIndex,
  laneMarkerOf,
  laneName,
  leaseFromMarker,
  type SlotLease,
  slotMarker,
} from "../../../lib/loadSlotMarker.js";

/** A fixed lease id, so a marker's exact name is known to the assertion. */
const LEASE = "00000000-0000-4000-8000-000000000000";

/** A lease with no recorded start stamp, taken under a limit of 1. */
const UNSTAMPED: SlotLease = {
  limit: 1,
  slot: { ceilingMib: 12480, pid: 4242, startedAtIso: "2026-08-24T07:00:00.500Z" },
};

/** The same lease carrying its holder's start stamp, as the current code writes it. */
const STAMPED: SlotLease = { ...UNSTAMPED, slot: { ...UNSTAMPED.slot, start: "Mon Aug 24 06:59:58 2026" } };

describe("slotMarker and leaseFromMarker", () => {
  it("round-trips a stamped lease and an unstamped one through the marker name", () => {
    expect(leaseFromMarker({ marker: slotMarker({ lease: STAMPED, leaseId: LEASE }) })).toEqual(STAMPED);
    expect(leaseFromMarker({ marker: slotMarker({ lease: UNSTAMPED, leaseId: LEASE }) })).toEqual(UNSTAMPED);
  });

  it("writes the whole lease into the name, its limit included and the start stamp in base64url", () => {
    expect(slotMarker({ lease: STAMPED, leaseId: LEASE })).toBe(
      `busy.4242.1787554800500.12480.1.TW9uIEF1ZyAyNCAwNjo1OTo1OCAyMDI2.${LEASE}`,
    );
    expect(slotMarker({ lease: { ...UNSTAMPED, limit: 3 }, leaseId: LEASE })).toBe(
      `busy.4242.1787554800500.12480.3.-.${LEASE}`,
    );
  });

  it("gives each lease a fresh id, so no two leases share a name", () => {
    expect(slotMarker({ lease: STAMPED })).not.toBe(slotMarker({ lease: STAMPED }));
  });

  it("reads a pid that is not a positive integer as malformed — kill would probe a process GROUP", () => {
    expect(leaseFromMarker({ marker: `busy.0.1787554800500.12480.1.-.${LEASE}` })).toBeUndefined();
    expect(leaseFromMarker({ marker: `busy.-1.1787554800500.12480.1.-.${LEASE}` })).toBeUndefined();
  });

  it("reads a limit that is not a positive integer as malformed", () => {
    expect(leaseFromMarker({ marker: `busy.4242.1787554800500.12480.0.-.${LEASE}` })).toBeUndefined();
    expect(leaseFromMarker({ marker: `busy.4242.1787554800500.12480.-.${LEASE}` })).toBeUndefined();
  });

  it("reads an instant past any Date as malformed", () => {
    expect(leaseFromMarker({ marker: `busy.4242.9999999999999999.12480.1.-.${LEASE}` })).toBeUndefined();
  });

  it("reads a start stamp that does not decode to a usable stamp, or is not canonical, as malformed", () => {
    const garbage = Buffer.from("garbage", "utf8").toString("base64url");
    expect(leaseFromMarker({ marker: `busy.4242.1787554800500.12480.1.${garbage}.${LEASE}` })).toBeUndefined();
    // A trailing base64url character that decodes to the same bytes is not the name this module writes.
    const canonical = Buffer.from("Mon Aug 24 06:59:58 2026", "utf8").toString("base64url");
    expect(leaseFromMarker({ marker: `busy.4242.1787554800500.12480.1.${canonical}A.${LEASE}` })).toBeUndefined();
  });

  it("reads a marker with no lease id as malformed", () => {
    expect(leaseFromMarker({ marker: "busy.4242.1787554800500.12480.1.-" })).toBeUndefined();
  });
});

describe("laneIndex and laneName", () => {
  it("round-trips a lane's index through its name", () => {
    expect(laneName({ index: 0 })).toBe("lane-0");
    expect(laneIndex({ name: laneName({ index: 17 }) })).toBe(17);
  });

  it("reads anything else as no lane — a leading zero would give one lane two names", () => {
    expect(laneIndex({ name: "lane-01" })).toBeUndefined();
    expect(laneIndex({ name: ".mint-abc123" })).toBeUndefined();
    expect(laneIndex({ name: "4242.json" })).toBeUndefined();
  });
});

describe("laneMarkerOf", () => {
  it("reads a lane that does not exist, or holds nothing, as there to mint", () => {
    expect(laneMarkerOf({ entries: undefined })).toEqual({ kind: "absent" });
    expect(laneMarkerOf({ entries: [] })).toEqual({ kind: "absent" });
  });

  it("reads the free marker as free and a busy one as its lease", () => {
    const marker = slotMarker({ lease: STAMPED, leaseId: LEASE });
    expect(laneMarkerOf({ entries: [FREE_MARKER] })).toEqual({ kind: "free" });
    expect(laneMarkerOf({ entries: [marker] })).toEqual({ kind: "held", lease: STAMPED, marker });
  });

  it("reads one entry it would never have written as malformed, and two as crowded — never guessed free", () => {
    expect(laneMarkerOf({ entries: ["stray"] })).toEqual({ kind: "malformed", marker: "stray" });
    expect(laneMarkerOf({ entries: [FREE_MARKER, "stray"] })).toEqual({ entries: 2, kind: "crowded" });
  });
});
