/**
 * The renames that move a load-slot lane between free, held and taken over, over a real throwaway directory, with
 * liveness injected as a plain function. One process cannot race itself, so exclusivity across processes is
 * `subprocess/lib/loadSlotRace.test.ts`'s to prove; this pins each single-caller transition.
 */
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { claimLane, freeLane, freeLanesOf, type HolderLive, observeLanes } from "../../../lib/loadSlotLanes.js";
import { type SlotLease, slotMarker } from "../../../lib/loadSlotMarker.js";

let root = "";
let dir = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "slopweaver-lanes-"));
  dir = join(root, "slots");
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** A lease for `pid` under `limit`. */
function lease({ pid, limit = 2 }: { pid: number; limit?: number }): SlotLease {
  return { limit, slot: { ceilingMib: 4096, pid, startedAtIso: "2026-11-07T00:00:00.000Z" } };
}

/** Plant one lane holding exactly these entries. */
function plant({ index, entries }: { index: number; entries: readonly string[] }): void {
  mkdirSync(join(dir, `lane-${String(index)}`), { recursive: true });
  for (const entry of entries) {
    writeFileSync(join(dir, `lane-${String(index)}`, entry), "");
  }
}

/** The one entry each lane holds, lanes in name order. */
function markers(): readonly string[] {
  return readdirSync(dir)
    .filter((name) => name.startsWith("lane-"))
    .toSorted()
    .map((lane) => readdirSync(join(dir, lane)).join(","));
}

/** Liveness by pid alone: only these pids run. */
function running({ pids }: { pids: readonly number[] }): HolderLive {
  return (slot) => pids.includes(slot.pid);
}

describe("observeLanes", () => {
  it("holds no lanes and no obstacles for a directory that does not exist", () => {
    expect(observeLanes({ dir, isLive: running({ pids: [] }) })).toEqual({ live: [], obstacles: [] });
  });

  it("returns the live leases lowest lane first, skips dead and free ones, and writes nothing", () => {
    const live = slotMarker({ lease: lease({ pid: 11 }) });
    plant({ entries: [slotMarker({ lease: lease({ pid: 22 }) })], index: 0 });
    plant({ entries: ["free"], index: 2 });
    plant({ entries: [live], index: 10 });
    const before = markers();
    expect(observeLanes({ dir, isLive: running({ pids: [11] }) })).toEqual({
      live: [{ index: 10, lease: lease({ pid: 11 }), marker: live }],
      obstacles: [],
    });
    expect(markers()).toEqual(before);
  });

  it("names a crowded lane as an obstacle rather than guessing it free", () => {
    plant({ entries: ["free", "stray"], index: 0 });
    expect(observeLanes({ dir, isLive: running({ pids: [] }) }).obstacles).toEqual([
      `${join(dir, "lane-0")} holds 2 entries, which this module never writes — skipped, never guessed free`,
    ]);
  });

  it("names a slot directory that will not list as an obstacle, never an empty machine", () => {
    writeFileSync(dir, "");
    const seen = observeLanes({ dir, isLive: running({ pids: [] }) });
    expect(seen.live).toEqual([]);
    expect(seen.obstacles[0]).toContain(`${dir} will not list`);
  });
});

describe("claimLane", () => {
  it("mints the lowest lane, creating the directory, and leaves no mint litter", () => {
    const claim = claimLane({ dir, isLive: running({ pids: [] }), lease: lease({ pid: 11 }) });
    expect(claim).toMatchObject({ index: 0, kind: "won" });
    expect(readdirSync(dir)).toEqual(["lane-0"]);
  });

  it("passes a live holder's lane for the next one, and takes a free lane by its free marker", () => {
    plant({ entries: [slotMarker({ lease: lease({ pid: 22 }) })], index: 0 });
    plant({ entries: ["free"], index: 1 });
    const claim = claimLane({ dir, isLive: running({ pids: [22] }), lease: lease({ pid: 11 }) });
    expect(claim).toMatchObject({ index: 1, kind: "won" });
    expect(markers()[1]).toMatch(/^busy\.11\./u);
  });

  it("takes a dead holder's lane over by renaming its exact name", () => {
    plant({ entries: [slotMarker({ lease: lease({ pid: 22 }) })], index: 0 });
    const claim = claimLane({ dir, isLive: running({ pids: [] }), lease: lease({ limit: 1, pid: 11 }) });
    expect(claim).toMatchObject({ index: 0, kind: "won" });
    expect(markers()).toEqual([expect.stringMatching(/^busy\.11\./u)]);
  });

  it("wins nothing, with no obstacle, when live holders fill every lane below the limit", () => {
    plant({ entries: [slotMarker({ lease: lease({ pid: 22 }) })], index: 0 });
    expect(claimLane({ dir, isLive: running({ pids: [22] }), lease: lease({ limit: 1, pid: 11 }) })).toEqual({
      kind: "lost",
      obstacles: [],
    });
  });

  it("FAILS CLOSED: a lease whose marker no reader parses back is refused before anything is written", () => {
    // A NaN ceiling minted `.NaN.`, which release skipped as malformed and so never freed or reported.
    const nan: SlotLease = { limit: 1, slot: { ...lease({ pid: 11 }).slot, ceilingMib: Number.NaN } };
    const claim = claimLane({ dir, isLive: running({ pids: [] }), lease: nan });
    expect(claim).toMatchObject({
      kind: "lost",
      obstacles: [expect.stringMatching(/^busy\.11\.\d+\.NaN\.1\..* is a marker no reader parses back/u)],
    });
    expect(observeLanes({ dir, isLive: running({ pids: [] }) })).toEqual({ live: [], obstacles: [] });
    expect(() => readdirSync(dir)).toThrow(/ENOENT/u);
  });

  it("FAILS CLOSED: a slot directory it cannot create is a loss naming why, never a win", () => {
    writeFileSync(dir, "");
    const claim = claimLane({ dir, isLive: running({ pids: [] }), lease: lease({ pid: 11 }) });
    expect(claim.kind).toBe("lost");
    expect(claim).toMatchObject({ obstacles: [expect.stringContaining(`${dir} would not take a lane`)] });
  });
});

describe("freeLane and freeLanesOf", () => {
  it("frees exactly the marker named, and tolerates one already gone", () => {
    const marker = slotMarker({ lease: lease({ pid: 11 }) });
    plant({ entries: [marker], index: 0 });
    expect(freeLane({ dir, index: 0, marker })).toEqual([]);
    expect(markers()).toEqual(["free"]);
    expect(freeLane({ dir, index: 0, marker })).toEqual([]);
    expect(markers()).toEqual(["free"]);
  });

  it("SAYS a lane that will not free, rather than swallowing it — the lane stays counted until its holder exits", () => {
    // Counterexample: a lane readable but not writable leaves the busy marker in place.
    const marker = slotMarker({ lease: lease({ pid: 11 }) });
    plant({ entries: [marker], index: 0 });
    const lane = join(dir, "lane-0");
    chmodSync(lane, 0o555);
    try {
      const stuck = freeLane({ dir, index: 0, marker });
      expect(stuck).toHaveLength(1);
      expect(stuck[0]).toContain(`${lane} would not free (`);
      expect(stuck[0]).toContain("held, and counted live, until this process exits");
      expect(markers()).toEqual([marker]);
      expect(freeLanesOf({ dir, pid: 11 })).toEqual(stuck);
    } finally {
      chmodSync(lane, 0o755);
    }
  });

  it("SAYS a lane it cannot read on release, since it may be this pid's and stay counted", () => {
    // A second counterexample: a lane unreadable at release was dropped from the live list and never reported.
    plant({ entries: [slotMarker({ lease: lease({ pid: 11 }) })], index: 0 });
    const lane = join(dir, "lane-0");
    chmodSync(lane, 0o000);
    try {
      const stuck = freeLanesOf({ dir, pid: 11 });
      expect(stuck).toHaveLength(1);
      expect(stuck[0]).toContain(`not checked for pid 11's lane, so possibly still held: ${lane} will not list (`);
    } finally {
      chmodSync(lane, 0o755);
    }
  });

  it("frees every lane naming the pid and leaves another pid's alone", () => {
    const other = slotMarker({ lease: lease({ pid: 22 }) });
    plant({ entries: [slotMarker({ lease: lease({ pid: 11 }) })], index: 0 });
    plant({ entries: [other], index: 1 });
    plant({ entries: [slotMarker({ lease: lease({ pid: 11 }) })], index: 2 });
    expect(freeLanesOf({ dir, pid: 11 })).toEqual([]);
    expect(markers()).toEqual(["free", other, "free"]);
  });
});
