/**
 * The stale-lock takeover is mutually exclusive, proved with real processes rather than described.
 *
 * Previously `acquireOperationLock` overwrote a stale lock with a plain `writeFileSync`, so two
 * contenders that both read the same dead holder both entered the guarded body. This race is the repro: run
 * it against that code and the first run reported two holders over the identical interval, both claiming
 * to have stolen from the same dead pid. The unit lane cannot see this — one process cannot race itself —
 * so the witness is eight `tsx` processes released at one instant against one lock left by a dead pid.
 * What that buys, and what it does not, is set out under "Timing is a witness" below.
 *
 * The property asserted is disjoint hold intervals, and the bounded claim in the module header is why that
 * is the right property here: every successful acquisition in this race is a live holder well under the
 * stale threshold, so nothing in it can be revoked by age, and a second holder can only mean the takeover
 * seated two. Both lock shapes are raced — the directory the module writes, and the plain file the previous
 * shape left behind, which the module still clears once.
 *
 * Timing is a witness, not a schedule, and the clock barrier does NOT guarantee one. It removes the part of
 * the skew this test can control — the seconds eight `tsx` processes take to boot, absorbed by spinning to a
 * shared instant — and nothing more. So be exact about what one green run establishes, because overstating
 * it is how a test like this stops being read:
 *
 * - **It establishes that the run contended at all.** A contender that finds a live holder writes a refusal,
 *   and the test requires at least one, so a schedule that ran all eight acquisitions end to end fails here
 *   rather than meeting the disjointness assertion without ever putting two processes at one lock. Measured:
 *   40 runs of 8 contenders, every one carrying at least one such refusal.
 * - **It does NOT establish that two contenders judged the stale holder at the same moment.** No outcome
 *   line can say so: a contender that judged it and then lost the rename is refused by the winner, and its
 *   refusal reads like any other. A run where one contender took the lock over uncontested and the rest
 *   simply met it is green, and is a weaker run than it looks.
 * - **What covers that is the negative control**, which is also what makes the disjointness assertion known
 *   to fire: this same file against the previous module fails with an observed overlap pair, and an overlap
 *   is reachable only through two contenders taking one stale lock over together. The schedule this harness
 *   produces on this machine does exercise the takeover path — the old code's defect is how we know.
 *
 * ANY overlap is a failure to investigate even where the lane's `retry: 1` would have re-run it green.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const TSX = join(repoRoot, "node_modules", ".bin", "tsx");
const CONTENDER = join(repoRoot, "src", "__tests__", "subprocess", "admit", "operationLockContender.entry.ts");

const CONTENDERS = 8;
/** Long against the skew the clock barrier leaves, so a second holder overlaps visibly rather than by a hair. */
const HOLD_MS = 300;
/** Long enough for eight `tsx` processes to boot before the barrier opens — measured at ~1.2s on this
 * machine, so the margin absorbs a loaded lane. A contender slower than this is late, not excluded. */
const BARRIER_LEAD_MS = 3000;

/** The shape every refusal in this race carries. No `g` flag: a global regex keeps `lastIndex` between
 * calls, so `test` and `exec` sharing one would skip every other refusal and pass on a reason it never read. */
const HELD_BY_PID = /^held by pid (\d+) since /;

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** The lock path for key `race`, computed the way the module computes it. */
function lockPathIn({ home }: { home: string }): string {
  const name = createHash("sha256").update("race", "utf8").digest("hex").slice(0, 32);
  return join(home, "ledgers", "operation-locks", `${name}.lock`);
}

/** A pid that is genuinely finished, so the seeded holder reads as dead to `holderIsAlive`. */
function deadPid(): number {
  return spawnSync("true", [], { stdio: "ignore" }).pid;
}

interface Entered {
  readonly kind: "entered";
  readonly pid: number;
  readonly enteredAt: number;
  readonly leftAt: number;
  readonly stoleFromPid: string;
}

interface Refused {
  readonly kind: "refused";
  readonly pid: number;
  readonly reason: string;
}

/** The contender reports its OWN pid: `tsx` is a shim, so the spawned pid is not the node process's. */
function parseOutcome({ line }: { line: string }): Entered | Refused {
  const [kind, pid, ...rest] = line.trim().split(" ");
  if (kind === "entered") {
    const [enteredAt, leftAt, stoleFromPid] = rest;
    return {
      enteredAt: Number(enteredAt),
      kind: "entered",
      leftAt: Number(leftAt),
      pid: Number(pid),
      stoleFromPid: stoleFromPid!,
    };
  }
  return { kind: "refused", pid: Number(pid), reason: rest.join(" ") };
}

/** Release eight contenders at one instant against the seeded lock, and collect every outcome. */
async function race({ seed }: { seed: (args: { lockPath: string; pid: number }) => void }): Promise<{
  readonly outcomes: readonly (Entered | Refused)[];
  readonly seededPid: number;
}> {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-oplock-race-"));
  fixtureDirs.push(home);
  const lockPath = lockPathIn({ home });
  mkdirSync(dirname(lockPath), { recursive: true });
  const seededPid = deadPid();
  seed({ lockPath, pid: seededPid });
  const outcomesDir = join(home, "outcomes");
  mkdirSync(outcomesDir);
  const startAt = Date.now() + BARRIER_LEAD_MS;
  const children = Array.from({ length: CONTENDERS }, (_, index) => {
    const outcomeFile = join(outcomesDir, `${String(index)}.txt`);
    const child = spawn(TSX, [CONTENDER, home, outcomeFile, String(startAt), String(HOLD_MS)], {
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
  return { outcomes, seededPid };
}

/** Every pair of hold intervals that overlaps, as `pidA/pidB` — empty is the property. */
function overlaps({ entered }: { entered: readonly Entered[] }): readonly string[] {
  const found: string[] = [];
  for (const a of entered) {
    for (const b of entered) {
      if (a.pid < b.pid && a.enteredAt < b.leftAt && b.enteredAt < a.leftAt) {
        found.push(`${String(a.pid)}/${String(b.pid)}`);
      }
    }
  }
  return found;
}

function assertExclusive({
  outcomes,
  seededPid,
}: {
  outcomes: readonly (Entered | Refused)[];
  seededPid: number;
}): void {
  const entered = outcomes.filter((outcome): outcome is Entered => outcome.kind === "entered");
  const refused = outcomes.filter((outcome): outcome is Refused => outcome.kind === "refused");
  expect(entered.length).toBeGreaterThan(0);
  // At least one contender reached the lock while another HELD it, which is what makes the disjointness
  // assertion below meaningful: eight acquisitions the scheduler spread far enough apart to never meet
  // would satisfy it without exercising anything. A refusal is only ever written by a contender that found
  // a live holder, so this is the run's own evidence that it contended — and only that. See the header for
  // what this witness does and does not cover.
  expect(refused.length).toBeGreaterThan(0);
  expect(overlaps({ entered })).toEqual([]);
  // A holder that saw a stale lock cleared on its way in names the dead pid and nothing else; one that
  // arrived after a peer had already cleared it names nobody. Either way no live pid is ever "stolen".
  const stolen = entered.map((outcome) => outcome.stoleFromPid).filter((pid) => pid !== "undefined");
  expect(stolen.filter((pid) => pid !== String(seededPid))).toEqual([]);
  // Every refusal in this race is a LIVE holder turning a contender away, so the reason's own shape is part
  // of the property and not a convenience for reading the pid out of it. Asserting the shape FIRST is what
  // makes the extraction below safe: a reason worded any other way fails here with its own text in the diff,
  // where the previous spelling non-null-asserted the match and threw `TypeError: Cannot read properties of
  // null (reading '1')` naming nothing. That is what reddened this lane on CI
  // (the plain-file case below, through both of vitest's attempts): the legacy
  // reader answered "a lock already exists at <path> and could not be read to check its age" about a path a
  // peer had already cleared. The module no longer says that — see `readPlainFileLock` — and the next wording
  // nobody expected arrives here as a legible failure instead of a stack trace.
  expect(refused.map((outcome) => outcome.reason).filter((reason) => !HELD_BY_PID.test(reason))).toEqual([]);
  // A refusal names a pid that really did hold the lock, never the dead one it should have cleared.
  const holders = new Set(entered.map((outcome) => String(outcome.pid)));
  const namedPids = refused.map((outcome) => HELD_BY_PID.exec(outcome.reason)![1]!);
  expect(namedPids.filter((pid) => !holders.has(pid))).toEqual([]);
}

describe("eight contenders at one lock left by a dead pid", () => {
  it("never hold it at the same time — directory shape", async () => {
    const { outcomes, seededPid } = await race({
      seed: ({ lockPath, pid }) => {
        mkdirSync(lockPath);
        writeFileSync(
          join(lockPath, `${String(pid)}-seeded`),
          JSON.stringify({ acquiredAtIso: "2026-09-13T00:00:00.000Z", pid }),
        );
      },
    });
    expect(outcomes).toHaveLength(CONTENDERS);
    assertExclusive({ outcomes, seededPid });
  });

  it("never hold it at the same time — plain-file shape left by the previous code", async () => {
    const { outcomes, seededPid } = await race({
      seed: ({ lockPath, pid }) => {
        writeFileSync(lockPath, JSON.stringify({ acquiredAtIso: "2026-09-13T00:00:00.000Z", pid }));
      },
    });
    expect(outcomes).toHaveLength(CONTENDERS);
    assertExclusive({ outcomes, seededPid });
    // The file shape is gone for good, and so is everything after the last release: the module's own
    // release removes the directory it wrote, so nothing at all stands at the path.
    const [home] = fixtureDirs;
    expect(existsSync(lockPathIn({ home: home! }))).toBe(false);
  });
});
