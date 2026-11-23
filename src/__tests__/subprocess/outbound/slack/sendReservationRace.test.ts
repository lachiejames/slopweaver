/**
 * No two identical concurrent Slack sends both claim the slot, proved with real processes.
 *
 * Before this test the reservation's takeover of an aged or unreadable slot was `unlink` then an exclusive
 * create, and `confirmSend` rewrote the file in place. So a contender holding a stale read could unlink a
 * peer's brand-new reservation and win its own create, and a reader that caught a confirm mid-rewrite saw an
 * empty file, judged it unreadable and took the slot over. MEASURED on main: twelve
 * `tsx` processes released at one instant against a slot seeded 48 hours old got fresh winners 2,2,1,1,3
 * across five laps, so three laps in five would have posted the same message twice or three times.
 *
 * The unit lane cannot see this — one process cannot race itself — so the witness is real `tsx` processes
 * released together, as in `admit/operationLockRace.test.ts`, whose header explains why a clock barrier is a
 * witness and not a schedule. The negative control is the point: run against the previous module, the aged
 * and confirm cases here fail with more than one fresh winner. Re-run the race with
 * `yarn vitest run --config config/vitest/subprocess.ts src/__tests__/subprocess/outbound/slack/sendReservationRace.test.ts`.
 *
 * ANY second winner is a failure to investigate even where the lane's `retry: 1` would have re-run it green.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const TSX = join(repoRoot, "node_modules", ".bin", "tsx");
const CONTENDER = join(
  repoRoot,
  "src",
  "__tests__",
  "subprocess",
  "outbound",
  "slack",
  "sendReservationContender.entry.ts",
);

/** The opaque send identity every contender shares — a hex digest in real use, any safe filename here. */
const KEY = "c".repeat(64);
const CONTENDERS = 12;
/** Long enough for twelve `tsx` processes to boot before the barrier opens, as in the operation-lock race. */
const BARRIER_LEAD_MS = 3000;
/** How long the looping modes keep working the slot after the barrier. */
const LOOP_MS = 1500;
/** Laps per aged-slot case: one lap double-won three times in five before the fix, so three laps is a fair net. */
const LAPS = 3;

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

interface Outcome {
  readonly pid: number;
  readonly fresh: number;
  readonly duplicate: number;
  readonly confirmed: number;
}

/** Parse one contender's `<pid> fresh=<n> duplicate=<n> confirmed=<n>` line. */
function parseOutcome({ line }: { line: string }): Outcome {
  const [pid, ...fields] = line.trim().split(" ");
  const count = ({ name }: { name: string }): number =>
    Number(fields.find((field) => field.startsWith(`${name}=`))!.slice(name.length + 1));
  return {
    confirmed: count({ name: "confirmed" }),
    duplicate: count({ name: "duplicate" }),
    fresh: count({ name: "fresh" }),
    pid: Number(pid),
  };
}

/** The slot directory under a home, laid out the way the module lays it out. */
function slotDir({ home }: { home: string }): string {
  return join(home, "ledgers", "slack-sends");
}

/** Release every contender at one instant against a slot seeded by `seed`, and collect every outcome. */
async function race({
  seed,
  modes,
}: {
  seed: (args: { slotPath: string }) => void;
  modes: readonly string[];
}): Promise<{ readonly home: string; readonly outcomes: readonly Outcome[] }> {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-send-race-"));
  fixtureDirs.push(home);
  mkdirSync(slotDir({ home }), { recursive: true });
  seed({ slotPath: join(slotDir({ home }), KEY) });
  const outcomesDir = join(home, "outcomes");
  mkdirSync(outcomesDir);
  const startAt = Date.now() + BARRIER_LEAD_MS;
  const children = modes.map((mode, index) => {
    const outcomeFile = join(outcomesDir, `${String(index)}.txt`);
    const child = spawn(TSX, [CONTENDER, home, outcomeFile, String(startAt), mode, String(LOOP_MS), KEY], {
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
  const outcomes = children.map(({ outcomeFile }) => parseOutcome({ line: readFileSync(outcomeFile, "utf8") }));
  return { home, outcomes };
}

/** Total fresh claims across every contender of one lap. */
function freshClaims({ outcomes }: { outcomes: readonly Outcome[] }): number {
  return outcomes.reduce((sum, outcome) => sum + outcome.fresh, 0);
}

/** Every name left in the slot directory, so a staging file left behind is visible. */
function slotNames({ home }: { home: string }): readonly string[] {
  return readdirSync(slotDir({ home })).toSorted();
}

const AGED_ISO = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

describe("twelve identical sends released at one instant", () => {
  it("against a slot that aged out, exactly ONE claims it fresh, lap after lap", async () => {
    const perLap: number[] = [];
    for (let lap = 0; lap < LAPS; lap += 1) {
      const { home, outcomes } = await race({
        modes: Array.from({ length: CONTENDERS }, () => "reserve"),
        seed: ({ slotPath }) => {
          writeFileSync(slotPath, JSON.stringify({ reservedIso: AGED_ISO }));
        },
      });
      expect(outcomes).toHaveLength(CONTENDERS);
      perLap.push(freshClaims({ outcomes }));
      // One slot, no staging file left beside it, and the aged record replaced by the winner's whole one.
      expect(slotNames({ home })).toEqual([KEY]);
      expect(readFileSync(join(slotDir({ home }), KEY), "utf8")).not.toContain(AGED_ISO);
    }
    expect(perLap).toEqual(Array.from({ length: LAPS }, () => 1));
  });

  it("against a slot whose record cannot be read, exactly ONE claims it fresh", async () => {
    const { home, outcomes } = await race({
      modes: Array.from({ length: CONTENDERS }, () => "reserve"),
      seed: ({ slotPath }) => {
        writeFileSync(slotPath, "{not a record");
      },
    });
    expect(outcomes).toHaveLength(CONTENDERS);
    expect(freshClaims({ outcomes })).toBe(1);
    expect(slotNames({ home })).toEqual([KEY]);
  });

  it("against a live slot being re-confirmed, NOBODY claims it fresh", async () => {
    // One process re-confirms a send that really went out, over and over, while eleven read the slot over and
    // over. The slot is inside its window the whole time, so every read must be a duplicate. Before the fix, a
    // reader that caught the in-place rewrite empty took the slot over and claimed it.
    const { outcomes } = await race({
      modes: ["confirm-loop", ...Array.from({ length: CONTENDERS - 1 }, () => "reserve-loop")],
      seed: ({ slotPath }) => {
        writeFileSync(slotPath, JSON.stringify({ reservedIso: new Date().toISOString(), sentTs: "1785000000.000001" }));
      },
    });
    const [confirmer, ...readers] = outcomes;
    // The run really interleaved: the confirmer rewrote the slot and the readers read it, many times each.
    expect(confirmer!.confirmed).toBeGreaterThan(0);
    expect(readers.reduce((sum, outcome) => sum + outcome.duplicate, 0)).toBeGreaterThan(0);
    expect(freshClaims({ outcomes })).toBe(0);
  });
});
