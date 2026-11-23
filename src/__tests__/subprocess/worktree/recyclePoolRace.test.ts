/**
 * The recycle pool's two races, run with real processes rather than described: claimers released at one instant
 * against fewer entries than claimers, and depositors released at one instant against fewer slots than
 * depositors. The unit lane cannot see either — one process cannot race itself.
 *
 * The properties are the ones `src/worktree/recyclePool.ts` rests on: of two renames of one source exactly one
 * succeeds, so no entry is claimed twice and none is lost; and a slot is a `mkdir`, so the pool never holds more
 * than its capacity however many deposits see room at once. A losing claimer leaves its reservation removed and
 * nothing at its destination.
 *
 * Timing is a witness, not a schedule: the clock barrier absorbs `tsx` boot skew and guarantees no
 * interleaving, so a green run shows the invariants held under whatever contention this machine produced.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { safeJsonParse } from "../../../lib/safeJson.js";
import { depositRecycled, RECYCLE_POOL_CAPACITY } from "../../../worktree/recyclePool.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const TSX = join(repoRoot, "node_modules", ".bin", "tsx");
const CONTENDER = join(repoRoot, "src", "__tests__", "subprocess", "worktree", "recyclePoolContender.entry.ts");

const CONTENDERS = 6;
/** Long enough for six `tsx` processes to boot before the barrier opens; a slower one is late, not excluded. */
const BARRIER_LEAD_MS = 3000;

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A root `node_modules` yarn installed for the package `repo`, carrying a marker naming it. */
function installedTree({ at, marker }: { at: string; marker: string }): void {
  mkdirSync(at, { recursive: true });
  writeFileSync(join(at, ".yarn-state.yml"), '"repo@workspace:.":\n  locations:\n    - ""\n');
  writeFileSync(join(at, "marker"), marker);
}

/** Release every contender at one instant and collect each one's outcome record. */
async function race({
  mode,
  pool,
  trash,
  targets,
  root,
}: {
  mode: "claim" | "deposit";
  pool: string;
  trash: string;
  targets: readonly string[];
  root: string;
}): Promise<readonly Record<string, unknown>[]> {
  const outcomes = join(root, `outcomes-${mode}`);
  mkdirSync(outcomes);
  const startAt = Date.now() + BARRIER_LEAD_MS;
  const children = targets.map((target, index) => {
    const outcomeFile = join(outcomes, `${String(index)}.json`);
    const child = spawn(TSX, [CONTENDER, mode, pool, target, trash, outcomeFile, String(startAt)], {
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
  return children.map(({ outcomeFile }) =>
    Object(safeJsonParse({ label: "recycle pool race outcome", text: readFileSync(outcomeFile, "utf8") })),
  );
}

describe("the recycle pool under real concurrent processes", () => {
  it("hands each of two entries to exactly one of six claimers, and leaves every loser with nothing", async () => {
    const root = mkdtempSync(join(tmpdir(), "recycle-race-"));
    fixtureDirs.push(root);
    const pool = join(root, "pool");
    for (const marker of ["a", "b"]) {
      const source = join(root, `src-${marker}`);
      installedTree({ at: source, marker });
      expect(depositRecycled({ entryName: marker, pool, source }).kind).toBe("deposited");
    }
    const targets = Array.from({ length: CONTENDERS }, (_, index) => {
      mkdirSync(join(root, `w${String(index)}`));
      return join(root, `w${String(index)}`, "node_modules");
    });

    const outcomes = await race({ mode: "claim", pool, root, targets, trash: join(root, "trash") });

    const claimed = outcomes.flatMap((outcome, index) => (outcome["kind"] === "claimed" ? [index] : []));
    const markers = claimed.map((index) => readFileSync(join(targets[index]!, "marker"), "utf8"));
    expect(markers.toSorted()).toEqual(["a", "b"]);
    const losers = targets.filter((_, index) => !claimed.includes(index));
    expect(losers.filter((target) => existsSync(target))).toEqual([]);
    expect(readdirSync(pool)).toEqual([]);
  });

  it("seats at most the pool's capacity of six simultaneous deposits, one tree per slot", async () => {
    const root = mkdtempSync(join(tmpdir(), "recycle-race-"));
    fixtureDirs.push(root);
    const pool = join(root, "pool");
    const targets = Array.from({ length: CONTENDERS }, (_, index) => {
      const source = join(root, `src-${String(index)}`);
      installedTree({ at: source, marker: String(index) });
      return source;
    });

    const outcomes = await race({ mode: "deposit", pool, root, targets, trash: join(root, "trash") });

    const deposited = outcomes.filter((outcome) => outcome["kind"] === "deposited");
    const full = outcomes.filter((outcome) => outcome["reason"] === "pool-full");
    expect([deposited.length, full.length]).toEqual([RECYCLE_POOL_CAPACITY, CONTENDERS - RECYCLE_POOL_CAPACITY]);
    const slots = readdirSync(pool).toSorted();
    expect(slots).toEqual(["0", "1", "2", "3"]);
    expect(slots.map((slot) => readdirSync(join(pool, slot)).length)).toEqual([1, 1, 1, 1]);
    expect(targets.filter((source) => existsSync(join(source, "marker"))).length).toBe(
      CONTENDERS - RECYCLE_POOL_CAPACITY,
    );
  });
});
