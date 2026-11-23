/**
 * Two Codex passes released at one instant against an account with ONE point left under its usage limit: exactly
 * one reserves it, the other is refused, and the document holds one row — proved with real processes.
 *
 * The unit lane cannot see this, since one process cannot race itself; the witness is two `tsx` processes released
 * together, as in `admit/operationLockRace.test.ts`, whose header explains why a clock barrier is a witness and not a
 * schedule. Without the lock and the fresh read under it, both would read 49% of a 50% limit and both would spend —
 * the defect the reservation exists to close. Re-run with
 * `yarn vitest run --config config/vitest/subprocess.ts src/__tests__/subprocess/codex/passReservationRace.test.ts`.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { readCodexPassReservations } from "../../../codex/passReservationDocument.js";
import { unwrap } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { RESERVATION_NOW, reservationHome } from "../../codexPassReservationFixture.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const TSX = join(repoRoot, "node_modules", ".bin", "tsx");
const CONTENDER = join(repoRoot, "src", "__tests__", "subprocess", "codex", "passReservationContender.entry.ts");

/** Long enough for both `tsx` processes to boot before the barrier opens. */
const BARRIER_LEAD_MS = 3000;

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach((root) => {
    rmSync(root, { force: true, recursive: true });
  });
});

/**
 * Spawn the contenders and wait for every one to exit cleanly.
 *
 * @param count how many to release together
 * @returns each contender's `<pid> <outcome>` line, in spawn order
 */
async function race({
  count,
  home,
  outcomesDir,
  storeDir,
}: {
  count: number;
  home: string;
  outcomesDir: string;
  storeDir: string;
}): Promise<readonly string[]> {
  const startAt = Date.now() + BARRIER_LEAD_MS;
  const children = Array.from({ length: count }, (_, index) => {
    const outcomeFile = join(outcomesDir, `${String(index)}.txt`);
    const child = spawn(TSX, [CONTENDER, home, outcomeFile, String(startAt), storeDir, RESERVATION_NOW, "49"], {
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
  return children.map(({ outcomeFile }) => readFileSync(outcomeFile, "utf8").trim());
}

describe("two passes released at one instant on an account with one point left", () => {
  it("lets exactly one reserve it and refuses the other, leaving one owner-only row", async () => {
    const { home, root, storeOf } = reservationHome({ rows: [{ alias: "plan-one", usageLimitPercent: 50 }] });
    roots.push(root);
    const outcomesDir = join(root, "outcomes");
    mkdirSync(outcomesDir);

    const lines = await race({ count: 2, home, outcomesDir, storeDir: storeOf["plan-one"]! });

    const outcomes = lines.map((line) => line.split(" ")[1]);
    const winner = lines.find((line) => line.endsWith(" reserved"))!;
    const path = stateHomePaths({ home }).live.codexPassReservationsJson;
    const rows = unwrap(readCodexPassReservations({ path })).reservations;
    expect(outcomes.toSorted((a, b) => String(a).localeCompare(String(b)))).toEqual(["refused", "reserved"]);
    expect(rows.map((row) => [row.pid, row.weeklyPoints, row.destinationAlias])).toEqual([
      [Number(winner.split(" ")[0]), 1, "plan-one"],
    ]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
