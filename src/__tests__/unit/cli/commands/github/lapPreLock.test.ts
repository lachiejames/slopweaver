/*
 * The lap lock covers a lap's PRE-LOCK phase: its reads, its fetch and the landing check's fresh tree. Two laps
 * once ran at once because a second session read no lock and no lap seat while the first was still building that
 * tree. These drive the real `acquireLapLock` over a throwaway home — never the compile lease, never
 * the operator's home — with the lap's other edges as the shared plain fakes.
 */

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { GithubLapDeps } from "../../../../../cli/commands/github/lapDeps.js";
import { acquireLapLock, readStandingLapLock } from "../../../../../cli/commands/github/lapLock.js";
import { runGithubLap } from "../../../../../cli/commands/github/lapRun.js";
import { type GithubLapSeatDeps, runGithubLapSeat } from "../../../../../cli/commands/github/lapSeatRun.js";
import {
  clearLapSeat,
  lapSeatRunClosed,
  readLapSeat,
  writeLapSeat,
} from "../../../../../cli/commands/github/lapSeatStore.js";
import { ok } from "../../../../../lib/result.js";
import { ARGS, depsFor, HEAD, type Observed, observe, takeLapHomes } from "../../../../lapRunFixture.js";

afterEach(() => {
  for (const home of takeLapHomes()) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** The fixture's clock, which names when each lap took the lock. */
const NOW = "2026-11-10T03:00:00.000Z";

/** A lap's fakes over `home` with the REAL lock, held by this live process, recording each token read in `reached`. */
function realLockDeps({
  observed,
  home,
  reached,
}: {
  observed: Observed;
  home: string;
  reached: string[];
}): GithubLapDeps {
  return {
    ...depsFor({ observed }),
    acquireLock: ({ home: at, lock }) => acquireLapLock({ home: at, lock }),
    home: () => home,
    pid: process.pid,
    token: () => {
      reached.push("token");
      return "token";
    },
  };
}

/** `github lap-seat`'s edges over the real store and lock reader under `home`, its output collected. */
function seatDeps({ home, lines }: { home: string; lines: string[] }): GithubLapSeatDeps {
  return {
    clearSeat: clearLapSeat,
    home: () => home,
    now: () => new Date(NOW),
    out: (line) => lines.push(line),
    readLapLock: readStandingLapLock,
    readSeat: readLapSeat,
    runClosed: lapSeatRunClosed,
    sessionId: () => undefined,
    writeDiagnostic: (line) => lines.push(line),
    writeSeat: writeLapSeat,
  };
}

describe("the lap lock over a lap's preflight", () => {
  it("refuses a second lap started during the first one's landing-check tree build, and lap-seat show names it", async () => {
    const first = observe();
    const second = observe();
    const secondReached: string[] = [];
    const seatLines: string[] = [];
    const during: { seatExit: number | undefined; secondExit: number | undefined } = {
      secondExit: undefined,
      seatExit: undefined,
    };
    const home = depsFor({ observed: observe() }).home();
    const firstDeps = realLockDeps({ home, observed: first, reached: [] });
    let builds = 0;
    const deps: GithubLapDeps = {
      ...firstDeps,
      checkout: async (at) => {
        builds += 1;
        if (builds === 1) {
          during.seatExit = runGithubLapSeat({ deps: seatDeps({ home, lines: seatLines }), rest: ["show"] });
          const secondDeps = realLockDeps({ home, observed: second, reached: secondReached });
          during.secondExit = await runGithubLap({ deps: secondDeps, rest: ARGS });
        }
        return firstDeps.checkout(at);
      },
    };
    expect(await runGithubLap({ deps, rest: [...ARGS, "--land"] })).toBe(0);
    expect(during.secondExit).toBe(1);
    expect(second.diagnostic).toEqual([
      `github lap: refused — another lap holds this machine: o/r#7, pid ${String(process.pid)}, since ${NOW}, ` +
        "still in its preflight, before its lanes. One lap at a time, because two would each starve the other " +
        "into timeouts; run again once it finishes",
    ]);
    expect(secondReached).toEqual([]);
    expect([second.posted, second.ran, second.landing]).toEqual([[], [], []]);
    expect(during.seatExit).toBe(3);
    expect(seatLines).toEqual([
      "github lap-seat: none stands; any session may lap",
      `github lap-seat: a lap holds the machine: o/r#7, pid ${String(process.pid)}, since ${NOW}, still in its preflight, before its lanes`,
    ]);
    expect(first.posted.map((status) => status.state)).toEqual(["pending", "pending", "success", "success"]);
    expect(existsSync(join(home, "laps", "lock.json"))).toBe(false);
  });

  it("names the lap running once it advanced on its head, for a lap started during its lanes", async () => {
    const first = observe();
    const second = observe();
    const home = depsFor({ observed: observe() }).home();
    const firstDeps = realLockDeps({ home, observed: first, reached: [] });
    const deps: GithubLapDeps = {
      ...firstDeps,
      startStore: async (input) => {
        await runGithubLap({ deps: realLockDeps({ home, observed: second, reached: [] }), rest: ARGS });
        return firstDeps.startStore(input);
      },
    };
    expect(await runGithubLap({ deps, rest: ARGS })).toBe(0);
    expect(second.diagnostic[0]!).toContain(
      `another lap holds this machine: o/r#7@${HEAD}, pid ${String(process.pid)}, since ${NOW}, running its lanes or landing.`,
    );
  });

  it("releases the lock on every early return, a missing token included", async () => {
    const observed = observe();
    const home = depsFor({ observed: observe() }).home();
    const deps: GithubLapDeps = { ...realLockDeps({ home, observed, reached: [] }), token: () => undefined };
    expect(await runGithubLap({ deps, rest: ARGS })).toBe(1);
    expect(observed.diagnostic).toEqual(["no GitHub token configured; run `slopweaver connect github`"]);
    expect(existsSync(join(home, "laps", "lock.json"))).toBe(false);
  });

  it("releases the real lock after a red lane, so the next lap on the machine runs rather than refusing", async () => {
    const observed = observe();
    const red = depsFor({ observed, red: ["lint"] });
    const home = red.home();
    const realLock: Pick<GithubLapDeps, "acquireLock" | "pid"> = {
      acquireLock: ({ home: at, lock }) => acquireLapLock({ home: at, lock }),
      pid: process.pid,
    };
    expect(await runGithubLap({ deps: { ...red, ...realLock }, rest: ARGS })).toBe(1);
    expect(observed.ran.slice(-2)).toEqual(["integration", "lint"]);
    expect(existsSync(join(home, "laps", "lock.json"))).toBe(false);
    const next = depsFor({ observed: observe() });
    expect(await runGithubLap({ deps: { ...next, ...realLock, home: () => home }, rest: ARGS })).toBe(0);
  });

  it("never takes the lock on a dry run, which posts and runs nothing", async () => {
    const observed = observe();
    const taken: string[] = [];
    const deps: GithubLapDeps = {
      ...depsFor({ observed }),
      acquireLock: ({ lock }) => {
        taken.push(lock.subject);
        return ok({ dispose: () => Promise.resolve(), value: { advance: () => ok(undefined) } });
      },
    };
    expect(await runGithubLap({ deps, rest: [...ARGS, "--land", "--dry-run"] })).toBe(0);
    expect(taken).toEqual([]);
  });
});
