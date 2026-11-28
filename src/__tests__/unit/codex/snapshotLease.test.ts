import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  busyMarkerFor,
  claimSlot,
  claimSlotForRemoval,
  classifySlotForRemoval,
  isErrno,
  releaseHeldSlot,
} from "../../../codex/snapshotLease.js";
import { SNAPSHOT_POOL_SLOTS } from "../../../worktree/snapshotPoolPath.js";

const BUSY = /^state\.busy\.\d+\.[0-9a-f]{12}\.[0-9a-f-]{36}$/;

let poolRoot: string;

beforeEach(() => {
  poolRoot = mkdtempSync(join(tmpdir(), "snapshot-lease-"));
});

afterEach(() => {
  rmSync(poolRoot, { force: true, recursive: true });
});

/** Every entry of a slot, sorted, so one assertion pins the whole marker state. */
const slotEntries = ({ index }: { index: number }): readonly string[] =>
  readdirSync(join(poolRoot, `slot-${String(index)}`)).toSorted();

describe("claimSlot", () => {
  it("mints slot-0 holding exactly this lease's busy marker", () => {
    const held = claimSlot({ poolRoot });

    expect(held.slot).toBe(join(poolRoot, "slot-0"));
    expect(held.tree).toBe(join(poolRoot, "slot-0", "tree"));
    expect(held.busyMarker).toMatch(BUSY);
    expect(held.busyMarker.split(".")[2]).toBe(String(process.pid));
    expect(slotEntries({ index: 0 })).toEqual([held.busyMarker]);
    expect(readdirSync(poolRoot)).toEqual(["slot-0"]);
  });

  it("gives two live leases two slots", () => {
    const first = claimSlot({ poolRoot });
    const second = claimSlot({ poolRoot });

    expect([first.slot, second.slot]).toEqual([join(poolRoot, "slot-0"), join(poolRoot, "slot-1")]);
  });

  it("takes a released slot back, under a fresh lease id", () => {
    const first = claimSlot({ poolRoot });
    releaseHeldSlot({ held: first });
    const again = claimSlot({ poolRoot });

    expect(again.slot).toBe(first.slot);
    expect(again.busyMarker === first.busyMarker).toBe(false);
    expect(slotEntries({ index: 0 })).toEqual([again.busyMarker]);
  });

  it("never reaps a lease whose holder is alive", () => {
    mkdirSync(join(poolRoot, "slot-0"));
    const live = busyMarkerFor({ pid: process.pid })!;
    writeFileSync(join(poolRoot, "slot-0", live), "");

    const held = claimSlot({ poolRoot });

    expect(held.slot).toBe(join(poolRoot, "slot-1"));
    expect(slotEntries({ index: 0 })).toEqual([live]);
  });

  it("reaps a lease whose pid a different process now holds", () => {
    mkdirSync(join(poolRoot, "slot-0"));
    const reused = `state.busy.${String(process.pid)}.000000000000.00000000-0000-4000-8000-000000000000`;
    writeFileSync(join(poolRoot, "slot-0", reused), "");

    const held = claimSlot({ poolRoot });

    expect(held.slot).toBe(join(poolRoot, "slot-0"));
    expect(slotEntries({ index: 0 })).toEqual([held.busyMarker]);
  });

  it("skips a slot carrying two markers rather than guessing it free", () => {
    mkdirSync(join(poolRoot, "slot-0"));
    writeFileSync(join(poolRoot, "slot-0", "state.free"), "");
    writeFileSync(join(poolRoot, "slot-0", "state.unknown"), "");

    const held = claimSlot({ poolRoot });

    expect(held.slot).toBe(join(poolRoot, "slot-1"));
    expect(slotEntries({ index: 0 })).toEqual(["state.free", "state.unknown"]);
  });

  it("refuses once every slot is leased", () => {
    const leases = Array.from({ length: SNAPSHOT_POOL_SLOTS }, () => claimSlot({ poolRoot }));

    expect(leases).toHaveLength(8);
    expect(() => claimSlot({ poolRoot })).toThrow(`every one of the 8 snapshot slots in ${poolRoot} is leased`);
  });
});

describe("releaseHeldSlot", () => {
  it("returns exactly this lease's marker to free", () => {
    const held = claimSlot({ poolRoot });
    releaseHeldSlot({ held });

    expect(slotEntries({ index: 0 })).toEqual(["state.free"]);
  });

  it("does not throw when the slot is already gone", () => {
    const held = claimSlot({ poolRoot });
    rmSync(held.slot, { force: true, recursive: true });

    expect(() => releaseHeldSlot({ held })).not.toThrow();
    expect(readdirSync(poolRoot)).toEqual([]);
  });
});

describe("busyMarkerFor", () => {
  it("stamps a live process, and gives no marker for a pid no process holds", () => {
    expect(busyMarkerFor({ pid: process.pid })!).toMatch(BUSY);
    expect(busyMarkerFor({ pid: 2_147_483_646 })).toBe(undefined);
  });

  it("stamps one process the same whatever zone the caller runs in", () => {
    const callerZone = process.env["TZ"];
    process.env["TZ"] = "Australia/Melbourne";
    const melbourne = busyMarkerFor({ pid: process.pid })!.split(".")[3];
    process.env["TZ"] = "America/Los_Angeles";
    const losAngeles = busyMarkerFor({ pid: process.pid })!.split(".")[3];
    if (callerZone === undefined) {
      delete process.env["TZ"];
    } else {
      process.env["TZ"] = callerZone;
    }

    expect(melbourne).toBe(losAngeles);
  });
});

describe("isErrno", () => {
  it("matches a system error by its code and nothing else", () => {
    const enoent = Object.assign(new Error("gone"), { code: "ENOENT" });

    expect(isErrno({ codes: ["ENOENT", "EEXIST"], error: enoent })).toBe(true);
    expect(isErrno({ codes: ["EEXIST"], error: enoent })).toBe(false);
    expect(isErrno({ codes: ["ENOENT"], error: new Error("no code") })).toBe(false);
    expect(isErrno({ codes: ["ENOENT"], error: "ENOENT" })).toBe(false);
  });
});

/** A well-formed busy marker naming a pid no process holds. */
const DEAD_MARKER = "state.busy.2147483646.0123456789ab.00000000-0000-4000-8000-000000000000";

describe("classifySlotForRemoval", () => {
  const never = (): boolean => false;
  const always = (): boolean => true;

  it("reads an absent slot as absent", () => {
    expect(classifySlotForRemoval({ entries: undefined, isDead: never })).toEqual({ kind: "absent" });
  });

  it("claims a free slot without asking the holder test", () => {
    expect(classifySlotForRemoval({ entries: ["state.free", "tree"], isDead: never })).toEqual({
      kind: "claimable",
      marker: "state.free",
    });
  });

  it("claims a busy slot only when its holder is PROVEN dead", () => {
    expect(classifySlotForRemoval({ entries: [DEAD_MARKER, "tree"], isDead: always })).toEqual({
      kind: "claimable",
      marker: DEAD_MARKER,
    });
  });

  it("leaves a busy slot whose holder is not proven dead, as live", () => {
    expect(classifySlotForRemoval({ entries: [DEAD_MARKER, "tree"], isDead: never })).toEqual({
      kind: "blocked",
      reason: "live-holder",
    });
  });

  it("blocks a slot carrying two markers, none, or a marker of no known shape", () => {
    expect(classifySlotForRemoval({ entries: ["state.free", DEAD_MARKER], isDead: always })).toEqual({
      kind: "blocked",
      reason: "unknown-marker",
    });
    expect(classifySlotForRemoval({ entries: ["tree"], isDead: always })).toEqual({
      kind: "blocked",
      reason: "unknown-marker",
    });
    expect(classifySlotForRemoval({ entries: ["state.busy.12"], isDead: always })).toEqual({
      kind: "blocked",
      reason: "unknown-marker",
    });
  });
});

describe("claimSlotForRemoval", () => {
  it("mints a placeholder at an absent index, holding only this run's marker", () => {
    const claim = claimSlotForRemoval({ index: 5, poolRoot });

    expect(claim.kind).toBe("claimed");
    const claimed = claim as Extract<typeof claim, { kind: "claimed" }>;
    expect(claimed.existed).toBe(false);
    expect(claimed.held.slot).toBe(join(poolRoot, "slot-5"));
    expect(slotEntries({ index: 5 })).toEqual([claimed.held.busyMarker]);
  });

  it("takes a free slot's lease and leaves its tree in place", () => {
    mkdirSync(join(poolRoot, "slot-0", "tree"), { recursive: true });
    writeFileSync(join(poolRoot, "slot-0", "state.free"), "");
    const claim = claimSlotForRemoval({ index: 0, poolRoot });

    expect(claim.kind).toBe("claimed");
    const claimed = claim as Extract<typeof claim, { kind: "claimed" }>;
    expect(claimed.existed).toBe(true);
    expect(slotEntries({ index: 0 })).toEqual([claimed.held.busyMarker, "tree"].toSorted());
  });

  it("takes a dead holder's lease", () => {
    mkdirSync(join(poolRoot, "slot-1"));
    writeFileSync(join(poolRoot, "slot-1", DEAD_MARKER), "");

    expect(claimSlotForRemoval({ index: 1, poolRoot }).kind).toBe("claimed");
  });

  it("never takes a live holder's lease, leaving its marker exactly as found", () => {
    const live = busyMarkerFor({ pid: process.pid })!;
    mkdirSync(join(poolRoot, "slot-2"));
    writeFileSync(join(poolRoot, "slot-2", live), "");

    expect(claimSlotForRemoval({ index: 2, poolRoot })).toEqual({
      kind: "blocked",
      reason: "live-holder",
      slot: join(poolRoot, "slot-2"),
    });
    expect(slotEntries({ index: 2 })).toEqual([live]);
  });

  it("claims only the index it was asked for, never scanning on", () => {
    claimSlotForRemoval({ index: 3, poolRoot });

    expect(readdirSync(poolRoot)).toEqual(["slot-3"]);
  });
});
