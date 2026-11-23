/**
 * The concurrent-whole-corpus-load guard: the derived limit, the lanes and their takeover, and the refusal.
 *
 * This is the companion the interim heap ceiling ships with. The ceiling is derived from host RAM, so one
 * process may grow far larger than V8's default allowed — and three of those at once is the failure that
 * replaces the one the ceiling removed. Every case here is a real temp-dir round trip, which `testing.md`
 * allows for a genuine fixture; nothing is mocked, and the "dead holder" cases use a pid that cannot be
 * alive rather than a stubbed liveness probe. That acquisition is EXCLUSIVE across processes is the subprocess
 * lane's to prove (`subprocess/lib/loadSlotRace.test.ts`): one process cannot race itself.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { leaseFromMarker, slotMarker } from "../../../lib/loadSlotMarker.js";
import {
  acquireLoadSlot,
  concurrentLoadLimit,
  type LoadSlot,
  liveSlots,
  MACHINE_SHARE,
  releaseLoadSlot,
  type SlotVerdict,
  slotHolderLive,
  slotRefusalLines,
} from "../../../lib/loadSlots.js";
import type { ProcessIdentity } from "../../../lib/processIdentity.js";

const GIB = 1024 * 1024 * 1024;

let dir = "";

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "slopweaver-slots-")), "load-slots");
  mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/**
 * When a planted live holder took its slot. A planted slot records no start stamp, so it is judged by ORDER — its
 * holder started before it was written — and one planted for `process.ppid` must carry an instant after that real
 * process started: a fixed instant far past any test run, rather than a read of the clock.
 */
const HELD_SINCE = "2099-01-01T00:00:00.000Z";

/** A fixed lease id, so a planted marker's exact name is known to the assertion. */
const LEASE = "00000000-0000-4000-8000-000000000000";

/** Plant one lane holding exactly this marker file. */
function plantMarker({ lane, marker }: { lane: number; marker: string }): void {
  mkdirSync(join(dir, `lane-${String(lane)}`), { recursive: true });
  writeFileSync(join(dir, `lane-${String(lane)}`, marker), "");
}

/**
 * Plant a lane held by `pid`, with a recorded start stamp when one is given, under `limit` — 3 by default, the
 * largest any caller here derives, so a planted holder never lowers a caller's bound unless a case says so.
 */
function writeSlot({
  pid,
  lane = 0,
  limit = 3,
  startedAtIso = HELD_SINCE,
  start,
}: {
  pid: number;
  lane?: number;
  limit?: number;
  startedAtIso?: string;
  start?: string;
}): string {
  const base = { ceilingMib: 12480, pid, startedAtIso };
  const slot: LoadSlot = start === undefined ? base : { ...base, start };
  const marker = slotMarker({ lease: { limit, slot }, leaseId: LEASE });
  plantMarker({ lane, marker });
  return marker;
}

/** Every lane and the one marker each holds, as `lane-<k>/<marker>`, lanes in name order. */
function lanes(): readonly string[] {
  return readdirSync(dir)
    .filter((name) => name.startsWith("lane-"))
    .toSorted()
    .flatMap((lane) =>
      readdirSync(join(dir, lane))
        .toSorted()
        .map((marker) => `${lane}/${marker}`),
    );
}

/** The pid each lane's marker names, `free` for a free lane, lanes in name order. */
function laneHolders(): readonly string[] {
  return lanes().map((entry) => {
    const marker = entry.split("/")[1]!;
    return marker === "free" ? "free" : String(leaseFromMarker({ marker })!.slot.pid);
  });
}

/** A legacy slot — no recorded start stamp. */
const LEGACY_SLOT: LoadSlot = { ceilingMib: 12480, pid: 4242, startedAtIso: "2026-08-24T07:00:00.500Z" };

/** The same slot as the current code writes it, carrying its holder's start stamp. */
const STAMPED_SLOT: LoadSlot = { ...LEGACY_SLOT, start: "Mon Aug 24 06:59:58 2026" };

/** A running, non-zombie process with the given start stamp. */
function runningSince({ start }: { start: string | undefined }): ProcessIdentity {
  return { running: true, start, zombie: false };
}

/**
 * A pid that cannot name a live process. The kernel's own maximum is well below this on both platforms
 * this runs on, so `process.kill(pid, 0)` is guaranteed to report it dead.
 */
const DEAD_PID = 4_194_303;

/** Narrow to the refused verdict, or throw — the which-verdict check stays an explicit assertion. */
function refused(verdict: SlotVerdict): Extract<SlotVerdict, { admitted: false }> {
  if (verdict.admitted) {
    throw new Error("expected a refusal, got an admission");
  }
  return verdict;
}

/** The pids a refusal names. */
function refusedHolders(verdict: SlotVerdict): readonly number[] {
  return refused(verdict).holders.map((slot) => slot.pid);
}

describe("concurrentLoadLimit", () => {
  it("divides the machine's share by the per-process ceiling", () => {
    // The owner's own machine: 48 GiB, and the interim launcher ceiling of 12,288 MiB.
    expect(concurrentLoadLimit({ ceilingBytes: 12_288 * 1024 * 1024, totalBytes: 48 * GIB })).toBe(3);
    // In production the guard reads `heap_size_limit`, which V8 pads above what the flag asked for —
    // 12,480 MiB for a 12,288 MiB request. Three of THOSE is 36.6 GiB, past the 36 GiB share, so the real
    // machine carries two. Asserted because the padding is a surprise worth writing down, not a bug.
    expect(concurrentLoadLimit({ ceilingBytes: 12_480 * 1024 * 1024, totalBytes: 48 * GIB })).toBe(2);
    // A smaller ceiling is the point of the real fix: the same machine then carries more concurrent asks
    // without anyone editing a constant.
    expect(concurrentLoadLimit({ ceilingBytes: 2 * GIB, totalBytes: 48 * GIB })).toBe(18);
  });

  it("never returns less than one, however small the machine", () => {
    expect(concurrentLoadLimit({ ceilingBytes: 12 * GIB, totalBytes: 4 * GIB })).toBe(1);
    expect(concurrentLoadLimit({ ceilingBytes: 0, totalBytes: 48 * GIB })).toBe(1);
  });

  it("honours an explicit machine share", () => {
    expect(concurrentLoadLimit({ ceilingBytes: 4 * GIB, machineShare: 0.5, totalBytes: 32 * GIB })).toBe(4);
    expect(MACHINE_SHARE).toBe(0.75);
  });
});

describe("acquireLoadSlot", () => {
  it("admits when the machine has room, minting the lowest lane for this process", () => {
    const verdict = acquireLoadSlot({ ceilingMib: 12480, dir, limit: 2 });
    expect(verdict).toEqual({ admitted: true, inFlight: 1, limit: 2 });
    expect(laneHolders()).toEqual([String(process.pid)]);
  });

  it("refuses once live holders fill the limit, naming them", () => {
    const marker = writeSlot({ pid: process.ppid });
    const verdict = acquireLoadSlot({ ceilingMib: 12480, dir, limit: 1 });
    expect(verdict.admitted).toBe(false);
    expect(refusedHolders(verdict)).toEqual([process.ppid]);
    expect(refused(verdict).obstacles).toEqual([]);
    // Nothing was written — a refused caller must not consume the slot it was denied.
    expect(lanes()).toEqual([`lane-0/${marker}`]);
  });

  it("takes the next lane below the limit when a lower one is held", () => {
    writeSlot({ pid: process.ppid });
    expect(acquireLoadSlot({ ceilingMib: 12480, dir, limit: 2 })).toEqual({ admitted: true, inFlight: 2, limit: 2 });
    expect(laneHolders()).toEqual([String(process.ppid), String(process.pid)]);
  });

  it("takes over a dead holder's lane rather than letting it wedge the machine forever", () => {
    writeSlot({ pid: DEAD_PID });
    const verdict = acquireLoadSlot({ ceilingMib: 12480, dir, limit: 1 });
    expect(verdict.admitted).toBe(true);
    expect(laneHolders()).toEqual([String(process.pid)]);
  });

  it("takes a free lane by its free marker", () => {
    plantMarker({ lane: 0, marker: "free" });
    expect(acquireLoadSlot({ ceilingMib: 12480, dir, limit: 1 }).admitted).toBe(true);
    expect(laneHolders()).toEqual([String(process.pid)]);
  });

  it("is re-entrant on its own lease, so a verb that loads twice never refuses itself and never takes a second lane", () => {
    expect(acquireLoadSlot({ ceilingMib: 12480, dir, limit: 2 }).admitted).toBe(true);
    expect(acquireLoadSlot({ ceilingMib: 12480, dir, limit: 2 })).toEqual({ admitted: true, inFlight: 1, limit: 2 });
    expect(laneHolders()).toEqual([String(process.pid)]);
  });

  it("holds a re-entrant call to its SMALLER limit, refusing it while leaving the outer call's lane held", () => {
    // Counterexample: this process holds lane-0 under limit 2 and another live holder took lane-1 under 2;
    // a nested call deriving limit 1 used to be admitted with two holders standing.
    expect(acquireLoadSlot({ ceilingMib: 12480, dir, limit: 2 }).admitted).toBe(true);
    writeSlot({ lane: 1, limit: 2, pid: process.ppid });
    const verdict = acquireLoadSlot({ ceilingMib: 12480, dir, limit: 1 });
    expect(refusedHolders(verdict)).toEqual([process.ppid]);
    expect(refused(verdict).obstacles).toEqual([]);
    expect(laneHolders()).toEqual([String(process.pid), String(process.ppid)]);
  });

  it("is re-entrant on its own UNSTAMPED lease when ps gives this process no start stamp", () => {
    // Counterexample: with no stamp, the second call missed its own lane-0 and wrote lane-1, inFlight 2.
    const identityOf = (): ProcessIdentity => runningSince({ start: undefined });
    expect(acquireLoadSlot({ ceilingMib: 12480, dir, identityOf, limit: 2 }).admitted).toBe(true);
    expect(acquireLoadSlot({ ceilingMib: 12480, dir, identityOf, limit: 2 })).toEqual({
      admitted: true,
      inFlight: 1,
      limit: 2,
    });
    expect(laneHolders()).toEqual([String(process.pid)]);
  });

  it("FAILS CLOSED with a named reason when a RE-ENTRANT call passes a limit no marker can record", () => {
    // Re-entry took no lane, so it never reached claimLane's check and refused naming nothing at all.
    const identityOf = (): ProcessIdentity => runningSince({ start: undefined });
    expect(acquireLoadSlot({ ceilingMib: 12480, dir, identityOf, limit: 1 }).admitted).toBe(true);
    const before = laneHolders();
    const reentrant = acquireLoadSlot({ ceilingMib: 12480, dir, identityOf, limit: 0.5 });
    expect(reentrant).toMatchObject({
      admitted: false,
      holders: [],
      limit: 0.5,
      obstacles: [expect.stringMatching(/^busy\.\d+\.\d+\.12480\.0\.5\..* is a marker no reader parses back/u)],
    });
    expect(laneHolders()).toEqual(before);
  });

  it("is NOT re-entrant on a marker naming its pid under another start stamp — that is a dead predecessor's", () => {
    writeSlot({ pid: process.pid, start: "Mon Aug 24 06:59:58 2026" });
    const identityOf = (): ProcessIdentity => runningSince({ start: "Tue Aug 25 09:00:00 2026" });
    expect(acquireLoadSlot({ ceilingMib: 12480, dir, identityOf, limit: 1 }).admitted).toBe(true);
    expect(liveSlots({ dir, identityOf })).toEqual([
      expect.objectContaining({ pid: process.pid, start: "Tue Aug 25 09:00:00 2026" }),
    ]);
  });

  it("gives a won lane back and refuses when a live holder took its lane under a SMALLER limit", () => {
    // A caller deriving limit 1 holds lane-0; this one derives 2 and wins lane-1 — but two holders would be past the
    // first holder's own limit, so it frees lane-1 and says why, though the holders do not fill its own limit.
    writeSlot({ limit: 1, pid: process.ppid });
    const verdict = acquireLoadSlot({ ceilingMib: 12480, dir, limit: 2 });
    expect(refusedHolders(verdict)).toEqual([process.ppid]);
    expect(refused(verdict).obstacles).toEqual([
      `pid ${String(process.ppid)} holds lane 0 under a limit of 1, below this caller's 2`,
    ]);
    expect(laneHolders()).toEqual([String(process.ppid), "free"]);
  });

  it("FAILS CLOSED: a slot directory that cannot be created refuses with the obstacle, never admits", () => {
    const blocked = join(dir, "not-a-directory");
    writeFileSync(blocked, "");
    const verdict = acquireLoadSlot({ ceilingMib: 12480, dir: blocked, limit: 2 });
    expect(refusedHolders(verdict)).toEqual([]);
    expect(refused(verdict).obstacles[0]).toContain(`${blocked} would not take a lane`);
  });

  it("counts a crowded lane it cannot read as a possible holder, refusing past the limit and naming it", () => {
    plantMarker({ lane: 5, marker: "free" });
    plantMarker({ lane: 5, marker: "stray" });
    const verdict = acquireLoadSlot({ ceilingMib: 12480, dir, limit: 1 });
    expect(refusedHolders(verdict)).toEqual([]);
    expect(refused(verdict).obstacles).toEqual([
      `${join(dir, "lane-5")} holds 2 entries, which this module never writes — skipped, never guessed free`,
    ]);
    expect(lanes()).toEqual(["lane-0/free", "lane-5/free", "lane-5/stray"]);
  });

  it("takes over a lane whose single marker it would never have written, by that marker's exact name", () => {
    plantMarker({ lane: 0, marker: "not a marker at all" });
    expect(acquireLoadSlot({ ceilingMib: 12480, dir, limit: 1 }).admitted).toBe(true);
    expect(laneHolders()).toEqual([String(process.pid)]);
  });

  it("never guesses a lane holding two entries free — it is skipped, and the next lane is minted", () => {
    plantMarker({ lane: 0, marker: "free" });
    plantMarker({ lane: 0, marker: "stray" });
    expect(acquireLoadSlot({ ceilingMib: 12480, dir, limit: 2 }).admitted).toBe(true);
    expect(lanes()).toEqual(["lane-0/free", "lane-0/stray", expect.stringMatching(/^lane-1\/busy\./u)]);
  });

  it("ignores a lane at or above its own limit when choosing, but counts its live holder", () => {
    // A caller deriving limit 2 left lane-1; this one derives limit 1, so lane-0 is its only lane — and having won
    // it, the lane-1 holder already fills its limit, so it gives lane-0 straight back and refuses.
    writeSlot({ lane: 1, pid: process.ppid });
    const verdict = acquireLoadSlot({ ceilingMib: 12480, dir, limit: 1 });
    expect(refusedHolders(verdict)).toEqual([process.ppid]);
    expect(refused(verdict).obstacles).toEqual([]);
    expect(laneHolders()).toEqual(["free", String(process.ppid)]);
  });

  it("admits when the slot directory does not exist yet, creating it", () => {
    const fresh = join(dir, "nested", "slots");
    expect(acquireLoadSlot({ ceilingMib: 4288, dir: fresh, limit: 1 }).admitted).toBe(true);
    expect(readdirSync(fresh)).toEqual(["lane-0"]);
  });

  it("ignores a slot file in the shape an earlier version wrote", () => {
    writeFileSync(join(dir, `${String(process.ppid)}.json`), JSON.stringify({ pid: process.ppid }), "utf8");
    expect(acquireLoadSlot({ ceilingMib: 12480, dir, limit: 1 }).admitted).toBe(true);
    expect(laneHolders()).toEqual([String(process.pid)]);
  });
});

describe("slotHolderLive — a slot carrying its holder's start stamp", () => {
  it("keeps the holder while the pid's start stamp still equals the recorded one", () => {
    expect(slotHolderLive({ now: runningSince({ start: "Mon Aug 24 06:59:58 2026" }), slot: STAMPED_SLOT })).toBe(true);
  });

  it("reads a REUSED pid dead: a running process with any other start stamp", () => {
    expect(slotHolderLive({ now: runningSince({ start: "Mon Aug 24 17:00:00 2026" }), slot: STAMPED_SLOT })).toBe(
      false,
    );
  });

  it("does no clock arithmetic, so a holder whose start postdates its own slot write still reads live", () => {
    // The backward clock step: the process started at 07:00:10, the wall clock was corrected, and it wrote its slot
    // at 07:00:00.500. Identity, not order, decides — so it is not reaped.
    const slot = { ...LEGACY_SLOT, start: "Mon Aug 24 07:00:10 2026" };
    expect(slotHolderLive({ now: runningSince({ start: "Mon Aug 24 07:00:10 2026" }), slot })).toBe(true);
  });

  it("reads a zombie dead, though its pid answers and its start stamp still matches", () => {
    expect(
      slotHolderLive({ now: { running: true, start: "Mon Aug 24 06:59:58 2026", zombie: true }, slot: STAMPED_SLOT }),
    ).toBe(false);
  });

  it("reads a pid that is not running dead", () => {
    expect(slotHolderLive({ now: { running: false, start: undefined, zombie: false }, slot: STAMPED_SLOT })).toBe(
      false,
    );
  });

  it("leaves the pid alone to decide when ps gives no stamp now", () => {
    expect(slotHolderLive({ now: runningSince({ start: undefined }), slot: STAMPED_SLOT })).toBe(true);
  });
});

describe("slotHolderLive — a legacy slot with no recorded stamp, judged by order", () => {
  it("keeps a holder whose process started before it wrote its slot", () => {
    expect(slotHolderLive({ now: runningSince({ start: "Mon Aug 24 06:59:58 2026" }), slot: LEGACY_SLOT })).toBe(true);
  });

  it("keeps a holder that started within the slot's own second — lstart truncates, never rounds up", () => {
    expect(slotHolderLive({ now: runningSince({ start: "Mon Aug 24 07:00:00 2026" }), slot: LEGACY_SLOT })).toBe(true);
  });

  it("reads a REUSED pid dead: a running process that started after the slot was written", () => {
    expect(slotHolderLive({ now: runningSince({ start: "Mon Aug 24 17:00:00 2026" }), slot: LEGACY_SLOT })).toBe(false);
  });

  it("leaves the pid alone to decide when the ps stamp will not parse", () => {
    expect(slotHolderLive({ now: runningSince({ start: "yesterday" }), slot: LEGACY_SLOT })).toBe(true);
  });
});

describe("liveSlots over an injected identity probe", () => {
  it("reads a reused pid's lane and a zombie's as free to take, keeps a genuine holder's, and writes nothing", () => {
    writeSlot({ lane: 0, pid: 111, start: "Mon Aug 24 06:59:58 2026" });
    writeSlot({ lane: 1, pid: 222, start: "Mon Aug 24 06:59:58 2026" });
    writeSlot({ lane: 2, pid: 333, start: "Mon Aug 24 06:59:58 2026" });
    const before = lanes();
    const now = new Map<number, ProcessIdentity>([
      [111, runningSince({ start: "Mon Aug 24 06:59:58 2026" })],
      [222, runningSince({ start: "Mon Aug 24 17:00:00 2026" })],
      [333, { running: true, start: "Mon Aug 24 06:59:58 2026", zombie: true }],
    ]);
    const live = liveSlots({ dir, identityOf: (candidate) => now.get(candidate)! });
    expect(live.map((slot) => slot.pid)).toEqual([111]);
    // READ-ONLY: a dead holder's lane stays exactly as it was until a caller taking a slot renames it over.
    expect(lanes()).toEqual(before);
  });

  it("reads a lane whose marker it would never have written as no holder, though a pid runs", () => {
    plantMarker({ lane: 0, marker: `busy.0.1787554800500.12480.1.-.${LEASE}` });
    expect(liveSlots({ dir, identityOf: () => runningSince({ start: "Mon Aug 24 06:59:58 2026" }) })).toEqual([]);
  });

  it("admits over a reused pid rather than refusing behind it, recording its own start stamp", () => {
    writeSlot({ pid: 222, start: "Mon Aug 24 06:59:58 2026" });
    const verdict = acquireLoadSlot({
      ceilingMib: 12480,
      dir,
      identityOf: () => runningSince({ start: "Mon Aug 24 17:00:00 2026" }),
      limit: 1,
    });
    expect(verdict.admitted).toBe(true);
    expect(liveSlots({ dir, identityOf: () => runningSince({ start: "Mon Aug 24 17:00:00 2026" }) })).toEqual([
      expect.objectContaining({ pid: process.pid, start: "Mon Aug 24 17:00:00 2026" }),
    ]);
  });
});

describe("liveSlots and releaseLoadSlot", () => {
  it("ignores files that are not lanes", () => {
    writeFileSync(join(dir, "README.txt"), "hello", "utf8");
    writeSlot({ pid: process.ppid });
    expect(liveSlots({ dir }).map((slot) => slot.pid)).toEqual([process.ppid]);
  });

  it("release frees this process's lane, leaves another's alone, and tolerates nothing left to free", () => {
    writeSlot({ lane: 0, pid: process.ppid });
    acquireLoadSlot({ ceilingMib: 12480, dir, limit: 2 });
    expect(releaseLoadSlot({ dir })).toEqual([]);
    expect(laneHolders()).toEqual([String(process.ppid), "free"]);
    expect(releaseLoadSlot({ dir })).toEqual([]);
    expect(laneHolders()).toEqual([String(process.ppid), "free"]);
  });

  it("a NESTED release frees nothing; only the outermost one gives the shared lane back", () => {
    // Counterexample: the inner scope's release freed the lane its outer scope was still loading under.
    expect(acquireLoadSlot({ ceilingMib: 12480, dir, limit: 1 }).admitted).toBe(true);
    expect(acquireLoadSlot({ ceilingMib: 12480, dir, limit: 1 }).admitted).toBe(true);
    expect(releaseLoadSlot({ dir })).toEqual([]);
    expect(laneHolders()).toEqual([String(process.pid)]);
    expect(releaseLoadSlot({ dir })).toEqual([]);
    expect(laneHolders()).toEqual(["free"]);
  });

  it("counts the depth per DIRECTORY, not per spelling: a nested release through an alias frees nothing", () => {
    // Counterexample: `D/.` kept its own depth of 1, so its release freed the outer `D` scope's lane.
    const alias = `${dir}-alias`;
    symlinkSync(dir, alias);
    expect(acquireLoadSlot({ ceilingMib: 12480, dir, limit: 1 }).admitted).toBe(true);
    expect(acquireLoadSlot({ ceilingMib: 12480, dir: `${dir}/.`, limit: 1 }).admitted).toBe(true);
    expect(acquireLoadSlot({ ceilingMib: 12480, dir: alias, limit: 1 }).admitted).toBe(true);
    expect(releaseLoadSlot({ dir: `${dir}/.` })).toEqual([]);
    expect(releaseLoadSlot({ dir: alias })).toEqual([]);
    expect(laneHolders()).toEqual([String(process.pid)]);
    expect(releaseLoadSlot({ dir: `${dir}/` })).toEqual([]);
    expect(laneHolders()).toEqual(["free"]);
  });

  it("a REFUSED nested call adds no depth, so the outer release still frees the lane", () => {
    expect(acquireLoadSlot({ ceilingMib: 12480, dir, limit: 2 }).admitted).toBe(true);
    writeSlot({ lane: 1, limit: 2, pid: process.ppid });
    expect(acquireLoadSlot({ ceilingMib: 12480, dir, limit: 1 }).admitted).toBe(false);
    expect(releaseLoadSlot({ dir })).toEqual([]);
    expect(laneHolders()).toEqual(["free", String(process.ppid)]);
  });

  it("a released lane is taken again by its free marker", () => {
    acquireLoadSlot({ ceilingMib: 12480, dir, limit: 1 });
    releaseLoadSlot({ dir });
    expect(acquireLoadSlot({ ceilingMib: 12480, dir, limit: 1 }).admitted).toBe(true);
    expect(laneHolders()).toEqual([String(process.pid)]);
  });
});

describe("slotRefusalLines", () => {
  it("names the holders, the remedy and why the limit is what it is", () => {
    const lines = slotRefusalLines({
      ceilingMib: 12480,
      holders: [{ ceilingMib: 12480, pid: 4242, startedAtIso: "2026-08-24T07:00:00.000Z" }],
      limit: 1,
      obstacles: [],
    });
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("pid 4242 since 2026-08-24T07:00:00.000Z (12480 MiB ceiling)");
    expect(lines[0]).toContain("the limit is 1");
    expect(lines[1]).toContain("retry");
    expect(lines[2]).toContain("what takes a slot");
    expect(lines[3]).toContain("INTERIM");
    expect(lines[3]).toContain("75%");
  });

  it("names the verbs that DO take a slot, and says a store query is not one of them", () => {
    const lines = slotRefusalLines({
      ceilingMib: 12480,
      holders: [{ ceilingMib: 12480, pid: 4242, startedAtIso: "2026-08-24T07:00:00.000Z" }],
      limit: 1,
      obstacles: [],
    });
    expect(lines[0]).toContain("memory-heavy corpus operation(s)");
    expect(lines[2]).toContain(
      "`derive`, which holds every record, and `distil`, `audit`, `pane` and `slice verify`, which hold one census entry per record",
    );
    expect(lines[2]).toContain("`store read` and `store cite` select from the store and take no slot at all");
  });

  it("counts the refused process itself when it names how many would be growing at once", () => {
    const lines = slotRefusalLines({
      ceilingMib: 12480,
      holders: [
        { ceilingMib: 12480, pid: 1, startedAtIso: "2026-08-24T07:00:00.000Z" },
        { ceilingMib: 12480, pid: 2, startedAtIso: "2026-08-24T07:00:01.000Z" },
      ],
      limit: 2,
      obstacles: [],
    });
    expect(lines[0]).toContain("letting 3 processes each grow toward a 12480 MiB ceiling");
  });

  it("keys its shape on the obstacles, never the holder count: fewer holders than the limit and none is still the full refusal", () => {
    // Keyed on `holders < limit`, this shape printed "...: . Refused" with nothing after the colon.
    const lines = slotRefusalLines({
      ceilingMib: 12480,
      holders: [{ ceilingMib: 12480, pid: 4242, startedAtIso: "2026-08-24T07:00:00.000Z" }],
      limit: 3,
      obstacles: [],
    });
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain(
      "1 memory-heavy corpus operation(s) are already in flight on this machine and the limit is 3",
    );
  });

  it("names a smaller-limit holder as the reason when that, not the count, refused it", () => {
    const lines = slotRefusalLines({
      ceilingMib: 12480,
      holders: [{ ceilingMib: 12480, pid: 4242, startedAtIso: "2026-08-24T07:00:00.000Z" }],
      limit: 3,
      obstacles: ["pid 4242 holds lane 0 under a limit of 1, below this caller's 3"],
    });
    expect(lines[0]).toBe(
      "no load slot could be taken on this machine (limit 3, 1 live holder(s): pid 4242 since 2026-08-24T07:00:00.000Z (12480 MiB ceiling)): pid 4242 holds lane 0 under a limit of 1, below this caller's 3. Refused rather than running as a holder the next caller could not count.",
    );
  });

  it("says the slot state could not be established, never that the machine is full, when holders do not fill it", () => {
    const lines = slotRefusalLines({
      ceilingMib: 12480,
      holders: [],
      limit: 2,
      obstacles: ["/slots will not list (EACCES)"],
    });
    expect(lines).toStrictEqual([
      "no load slot could be taken on this machine (limit 2, 0 live holder(s)): /slots will not list (EACCES). Refused rather than running as a holder the next caller could not count.",
      `  to answer now: retry — a lane changing hands settles in moments; a lane or directory that will not list or rename is a filesystem fault under ${tmpdir()} to clear first.`,
    ]);
  });
});
