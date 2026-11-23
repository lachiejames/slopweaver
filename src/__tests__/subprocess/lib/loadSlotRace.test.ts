/**
 * Load-slot acquisition is EXCLUSIVE, proved with real processes rather than described.
 *
 * Before this landed `acquireLoadSlot` listed the directory, counted the live holders, then wrote a file named for its
 * own pid, so two callers racing an empty directory could both be admitted — two refreshes of one source at
 * `REFRESH_SLOT_LIMIT` 1 — and a reaper's `rmSync` could unlink a slot rewritten between its read and the unlink. The
 * unit lane cannot see either: one process cannot race itself. So the witness is eight `tsx` processes released at
 * one instant against one slot directory, each holding what it took for a few hundred milliseconds.
 *
 * The property asserted is that no instant has more holders than the limit. A contender's measured interval runs
 * from the moment `acquireLoadSlot` returned to the moment before it released, which sits inside the span it really
 * held a lane, so a measured overlap is a real one; the hold is long against the skew the barrier leaves, so a real
 * one is visible rather than a hair.
 *
 * Timing is a witness, not a schedule, exactly as `../admit/operationLockRace.test.ts` sets out:
 *
 * - **It establishes that the run contended at all.** A refusal is written only by a contender that met live holders
 *   filling the limit, and each case requires at least one, so a schedule that ran every acquisition end to end
 *   fails rather than meeting the bound without putting two processes at one lane.
 * - **It does NOT establish that two contenders judged one lane at the same moment.** No outcome line can say so.
 * - **What covers that is the negative control.** This same file, its contender pointed at the list-count-write
 *   module this replaced, fails every case — so the harness's schedule does put contenders inside that window.
 *   Measured on a darwin laptop: main's module admitted all eight contenders in each case, peak overlap 8
 *   at limit 1 (twice) and 8 at limit 2, zero refusals; this module, same harness, peak 1, 1 and 2 with 7, 7 and 6
 *   refused. Repro: copy `loadSlotContender.entry.ts` to import main's `src/lib/loadSlots.ts` (its refusal carries no
 *   `obstacles`, so write `0` there), point `CONTENDER` at the copy, and run this file with `--retry=0`.
 *
 * ANY excess is a failure to investigate even where the lane's `retry: 1` would have re-run it green.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { slotMarker } from "../../../lib/loadSlotMarker.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const TSX = join(repoRoot, "node_modules", ".bin", "tsx");
const CONTENDER = join(repoRoot, "src", "__tests__", "subprocess", "lib", "loadSlotContender.entry.ts");

const CONTENDERS = 8;
/** Long against the skew the clock barrier leaves, so a holder past the limit overlaps visibly rather than by a hair. */
const HOLD_MS = 300;
/** Long enough for eight `tsx` processes to boot before the barrier opens — the operation-lock race's measured lead. */
const BARRIER_LEAD_MS = 3000;

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

interface Entered {
  readonly kind: "entered";
  readonly pid: number;
  readonly enteredAt: number;
  readonly leftAt: number;
}

interface Refused {
  readonly kind: "refused";
  readonly pid: number;
  readonly obstacles: number;
  readonly holders: readonly number[];
}

/** One contender's outcome line. */
function parseOutcome({ line }: { line: string }): Entered | Refused {
  const [kind, pid, ...rest] = line.trim().split(" ");
  if (kind === "entered") {
    const [enteredAt, leftAt] = rest;
    return { enteredAt: Number(enteredAt), kind: "entered", leftAt: Number(leftAt), pid: Number(pid) };
  }
  const [obstacles, holders] = rest;
  const named = holders === undefined ? [] : holders.split(",").map(Number);
  return { holders: named, kind: "refused", obstacles: Number(obstacles), pid: Number(pid) };
}

/** A race's outcomes, and the slot directory it ran against. */
interface Race {
  readonly dir: string;
  readonly outcomes: readonly (Entered | Refused)[];
}

/** A pid that is genuinely finished, so a seeded holder reads as dead. */
function deadPid(): number {
  return spawnSync("true", [], { stdio: "ignore" }).pid;
}

/** Release eight contenders at one instant against one slot directory, and collect every outcome. */
async function race({ limit, seed }: { limit: number; seed?: (args: { dir: string }) => void }): Promise<Race> {
  const root = mkdtempSync(join(tmpdir(), "slot-race-"));
  fixtureDirs.push(root);
  const dir = join(root, "slots");
  mkdirSync(dir);
  seed?.({ dir });
  const outcomesDir = join(root, "outcomes");
  mkdirSync(outcomesDir);
  const startAt = Date.now() + BARRIER_LEAD_MS;
  const children = Array.from({ length: CONTENDERS }, (_, index) => {
    const outcomeFile = join(outcomesDir, `${String(index)}.txt`);
    const child = spawn(TSX, [CONTENDER, dir, outcomeFile, String(startAt), String(HOLD_MS), String(limit)], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    return { child, outcomeFile };
  });
  try {
    await Promise.all(
      children.map(
        ({ child }) =>
          new Promise<void>((resolveExit, rejectExit) => {
            child.once("error", rejectExit);
            child.once("exit", (code) => {
              if (code === 0) {
                resolveExit();
              } else {
                rejectExit(new Error(`contender exited ${String(code)}`));
              }
            });
          }),
      ),
    );
  } finally {
    for (const { child } of children) {
      child.kill();
    }
  }
  return {
    dir,
    outcomes: children.map(({ outcomeFile }) => parseOutcome({ line: readFileSync(outcomeFile, "utf8") })),
  };
}

/**
 * The most holders any one instant saw. Intervals only ever start at some holder's `enteredAt`, so the maximum is
 * reached at one of them: count, for each, every holder whose interval contains that instant.
 */
function peakHolders({ entered }: { entered: readonly Entered[] }): number {
  return Math.max(
    0,
    ...entered.map((at) => entered.filter((b) => b.enteredAt <= at.enteredAt && at.enteredAt < b.leftAt).length),
  );
}

/**
 * Split a race's outcomes and assert the bound, the contention witness, that every refusal named real holders, and
 * that every lane ends free with no mint litter once every contender has released.
 */
function assertBounded({ limit, race: { dir, outcomes } }: { limit: number; race: Race }): void {
  const entered = outcomes.filter((outcome): outcome is Entered => outcome.kind === "entered");
  const refused = outcomes.filter((outcome): outcome is Refused => outcome.kind === "refused");
  expect(entered.length).toBeGreaterThan(0);
  // The run's own evidence that it contended: a refusal is written only by a contender that met live holders
  // filling the limit. See the header for what this does and does not cover.
  expect(refused.length).toBeGreaterThan(0);
  expect(peakHolders({ entered })).toBeLessThanOrEqual(limit);
  // A refusal names `limit` holders, each a contender that really entered — never the dead seed, never itself. One
  // naming fewer is legitimate only when it says why (a lane that changed hands under it), never silently.
  const holders = new Set(entered.map((outcome) => outcome.pid));
  expect(refused.filter((outcome) => outcome.holders.length !== limit && outcome.obstacles === 0)).toEqual([]);
  expect(refused.flatMap((outcome) => outcome.holders).filter((pid) => !holders.has(pid))).toEqual([]);
  const lanes = Array.from({ length: limit }, (_, index) => `lane-${String(index)}`);
  expect(readdirSync(dir).toSorted()).toEqual(lanes);
  expect(lanes.map((lane) => readdirSync(join(dir, lane)))).toEqual(lanes.map(() => ["free"]));
}

describe("eight contenders at one slot directory", () => {
  it("never seat two holders at limit 1 — an empty directory, every lane minted under contention", async () => {
    const empty = await race({ limit: 1 });
    expect(empty.outcomes).toHaveLength(CONTENDERS);
    assertBounded({ limit: 1, race: empty });
  });

  it("never seat two holders at limit 1 — a dead holder's lane, taken over under contention", async () => {
    const dead = { ceilingMib: 4096, pid: deadPid(), startedAtIso: "2026-11-07T00:00:00.000Z" };
    const seeded = await race({
      limit: 1,
      seed: ({ dir }) => {
        mkdirSync(join(dir, "lane-0"));
        writeFileSync(join(dir, "lane-0", slotMarker({ lease: { limit: 1, slot: dead } })), "");
      },
    });
    expect(seeded.outcomes).toHaveLength(CONTENDERS);
    // The seed's own marker is gone — taken over by name, never left beside a second marker — and the lane ends free.
    assertBounded({ limit: 1, race: seeded });
  });

  it("never seat three holders at limit 2", async () => {
    const two = await race({ limit: 2 });
    expect(two.outcomes).toHaveLength(CONTENDERS);
    assertBounded({ limit: 2, race: two });
  });
});
