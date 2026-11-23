/**
 * The just-in-time refresh slot's real behaviour, over a real (throwaway) slot directory.
 *
 * Filesystem rather than a fake, deliberately: the whole value of reusing `lib/loadSlots.ts` here is that a
 * slot is a FILE whose holder is probed rather than a lock that has to be released, and a test that faked
 * the directory would assert the wiring while proving nothing about the property being reused.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  acquireRefreshSlot,
  compactSlotRefusalLines,
  liveRefreshes,
  REFRESH_SLOT_LIMIT,
  refreshSlotDir,
  refreshSlotRefusalLines,
  releaseRefreshSlot,
  slotUnavailableLines,
} from "../../../corpus/refreshSlot.js";
import { leaseFromMarker, slotMarker } from "../../../lib/loadSlotMarker.js";

/** A pid no process can hold — above the maximum any platform assigns. */
const DEAD_PID = 2_147_483_646;

/**
 * When a planted live holder took its slot. A slot binds to a process that started BEFORE it was written, so a
 * holder planted for `process.ppid` must carry an instant after that real process started — a fixed instant far
 * past any test run, rather than a read of the clock.
 */
const HELD_SINCE = "2099-01-01T00:00:00.000Z";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "slopweaver-jit-slot-test-"));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** Plant a source's only lane as though `pid` had taken it at `startedAtIso`. */
function plantSlot({
  pid,
  source,
  startedAtIso = HELD_SINCE,
}: {
  pid: number;
  source: "slack" | "notion";
  startedAtIso?: string;
}): void {
  const lane = join(refreshSlotDir({ root, source }), "lane-0");
  mkdirSync(lane, { recursive: true });
  writeFileSync(join(lane, slotMarker({ lease: { limit: 1, slot: { ceilingMib: 4096, pid, startedAtIso } } })), "");
}

/** The pid holding a source's only lane, `free`, or `none` when the lane was never minted. */
function laneHolder({ source }: { source: "slack" | "notion" }): string {
  const lane = join(refreshSlotDir({ root, source }), "lane-0");
  const [marker] = readdirSync(lane);
  if (marker === undefined) {
    return "none";
  }
  return marker === "free" ? "free" : String(leaseFromMarker({ marker })!.slot.pid);
}

describe("refreshSlotDir", () => {
  it("gives each source its own directory under the root", () => {
    expect(refreshSlotDir({ root: "/slots", source: "slack" })).toBe("/slots/slack");
    expect(refreshSlotDir({ root: "/slots", source: "notion" })).toBe("/slots/notion");
  });
});

describe("acquireRefreshSlot", () => {
  it("admits the first taker and holds its lane", () => {
    const verdict = acquireRefreshSlot({ root, source: "slack" });
    expect(verdict.admitted).toBe(true);
    expect(laneHolder({ source: "slack" })).toBe(String(process.pid));
  });

  it("is re-entrant by pid, so one process never refuses itself", () => {
    acquireRefreshSlot({ root, source: "slack" });
    expect(acquireRefreshSlot({ root, source: "slack" }).admitted).toBe(true);
  });

  it("refuses a second live holder and names it", () => {
    plantSlot({ pid: process.ppid, source: "slack" });
    expect(acquireRefreshSlot({ root, source: "slack" })).toEqual({
      admitted: false,
      holders: [{ ceilingMib: 4096, pid: process.ppid, startedAtIso: HELD_SINCE }],
      limit: REFRESH_SLOT_LIMIT,
      obstacles: [],
    });
  });

  it("refuses, naming the obstacle and no holder, when the source's slot directory is not a directory", () => {
    writeFileSync(refreshSlotDir({ root, source: "slack" }), "");
    const verdict = acquireRefreshSlot({ root, source: "slack" });
    expect(verdict.admitted).toBe(false);
    expect(verdict).toMatchObject({ holders: [], limit: REFRESH_SLOT_LIMIT });
    expect((verdict as { obstacles: readonly string[] }).obstacles[0]).toContain("would not take a lane");
  });

  it("admits over a dead holder, taking its lane over", () => {
    plantSlot({ pid: DEAD_PID, source: "slack" });
    expect(acquireRefreshSlot({ root, source: "slack" }).admitted).toBe(true);
    expect(laneHolder({ source: "slack" })).toBe(String(process.pid));
  });

  it("admits over a REUSED pid — a running process that started after the slot was written — taking its lane", () => {
    // The ~10h wedge: the holder died and the OS gave its pid to a live process. `process.ppid` is running, but it
    // started long after a slot taken in 2000, so it cannot be the process that took it.
    plantSlot({ pid: process.ppid, source: "slack", startedAtIso: "2000-01-01T00:00:00.000Z" });
    expect(acquireRefreshSlot({ root, source: "slack" }).admitted).toBe(true);
    expect(laneHolder({ source: "slack" })).toBe(String(process.pid));
  });

  it("holds one slot per source, so a slack holder never blocks notion", () => {
    plantSlot({ pid: process.ppid, source: "slack" });
    expect(acquireRefreshSlot({ root, source: "notion" }).admitted).toBe(true);
  });

  it("rations one refresh per source", () => {
    expect(REFRESH_SLOT_LIMIT).toBe(1);
  });
});

describe("liveRefreshes", () => {
  it("reports a live foreign holder with its pid and start", () => {
    plantSlot({ pid: process.ppid, source: "slack" });
    expect(liveRefreshes({ root, sources: ["slack"] })).toEqual([
      { pid: process.ppid, source: "slack", startedAtIso: HELD_SINCE },
    ]);
  });

  it("never reports this process's own slot as somebody else's run", () => {
    acquireRefreshSlot({ root, source: "slack" });
    expect(liveRefreshes({ root, sources: ["slack"] })).toEqual([]);
  });

  it("reports nothing for a source nobody is refreshing", () => {
    expect(liveRefreshes({ root, sources: ["slack", "notion"] })).toEqual([]);
  });

  it("reports nothing for a dead holder", () => {
    plantSlot({ pid: DEAD_PID, source: "notion" });
    expect(liveRefreshes({ root, sources: ["notion"] })).toEqual([]);
  });
});

describe("refreshSlotRefusalLines", () => {
  it("names the RE-ASK remedy instead when the run is a turn's just-in-time wait", () => {
    expect(
      refreshSlotRefusalLines({
        holder: { pid: 4242, source: "slack", startedAtIso: "2026-09-05T11:00:00.000Z" },
        jit: true,
        source: "slack",
      })[1],
    ).toBe(
      "  to answer: let that run finish, then re-run the gate — nothing is queued, so re-asking is the whole remedy.",
    );
  });

  it("names the holder, why a second fetch is refused, and the operator's remedy by default", () => {
    const lines = refreshSlotRefusalLines({
      holder: { pid: 4242, source: "slack", startedAtIso: "2026-09-05T11:00:00.000Z" },
      source: "slack",
    });
    expect(lines[0]).toBe(
      "refresh slack · a refresh or compaction of slack is already running (pid 4242, since " +
        "2026-09-05T11:00:00.000Z) — not starting a refresh beside it, which would race it on slack's resume " +
        "cursor or window files.",
    );
    expect(lines[1]).toBe(
      "  let that run finish and run this again — nothing is queued, and there is no flag that waives the slot.",
    );
  });
});

describe("slotUnavailableLines", () => {
  it("names the verb, the source, every obstacle and the retry remedy", () => {
    expect(slotUnavailableLines({ obstacles: ["a", "b"], source: "notion", verb: "compact" })).toStrictEqual([
      "compact notion · notion's slot could not be taken: a; b — skipping notion rather than writing it beside a refresh or compaction this run could not count.",
      "  run this again — a lane changing hands settles in moments; a slot directory that will not list or rename is a filesystem fault to clear first.",
    ]);
  });
});

describe("compaction under the refresh slot", () => {
  it("holds a source against another writer until released, then frees it", () => {
    expect(acquireRefreshSlot({ root, source: "slack" }).admitted).toBe(true);
    expect(laneHolder({ source: "slack" })).toBe(String(process.pid));
    releaseRefreshSlot({ root, source: "slack" });
    expect(laneHolder({ source: "slack" })).toBe("free");
  });

  it("names the holder, the loss it avoids, and that the other sources still ran", () => {
    expect(
      compactSlotRefusalLines({
        holder: { pid: 4242, source: "slack", startedAtIso: "2026-09-05T11:00:00.000Z" },
        source: "slack",
      }),
    ).toStrictEqual([
      "compact slack · a refresh or compaction of slack is already running (pid 4242, since " +
        "2026-09-05T11:00:00.000Z) — skipping slack: unlinking its window files under a live writer would lose " +
        "the rows it appends.",
      "  let that run finish and run this again — nothing is queued, and every other source was still compacted.",
    ]);
  });
});
