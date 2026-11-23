/*
 * The lap-seat gate at the top of `github lap`: while a seat is designated, every mode but `--dry-run` refuses a
 * session off the seat BEFORE the token, the API or any lane — single, batch and `--land-only` alike — and the
 * `off-seat-lap` hatch opens it, while a designation that will not read refuses whether the hatch is open or not.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { GithubLapDeps } from "../../../../../cli/commands/github/lapDeps.js";
import { runGithubLap } from "../../../../../cli/commands/github/lapRun.js";
import type { LapSeatFacts } from "../../../../../cli/commands/github/lapSeat.js";
import { LapSeatErrors } from "../../../../../cli/commands/github/lapSeatStore.js";
import { err, ok } from "../../../../../lib/result.js";
import { ARGS, batchDeps, type Observed, observe } from "../../../../lapBatchFixture.js";

const SINGLE = ["--repo", "o/r", "--number", "7"];
const SEAT = { setIso: "2026-11-11T12:00:00.000Z", slug: "lap-seat-run" };
const OFF_SEAT: LapSeatFacts = { callerRun: "reseated-run", seat: SEAT, seatRunClosed: false };

let homes: string[] = [];
afterEach(() => {
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
  homes = [];
});

/** What the gate reached past itself: every token read and API built is recorded. */
interface Reached {
  tokens: number;
  apis: number;
}

/** The lap fakes over a fresh home, with the seat facts given and the token and API reads counted. */
function depsWith({
  observed,
  reached,
  facts,
  hatchOpen = false,
}: {
  observed: Observed;
  reached: Reached;
  facts: ReturnType<GithubLapDeps["lapSeatFacts"]>;
  hatchOpen?: boolean;
}): GithubLapDeps {
  const home = mkdtempSync(join(tmpdir(), "sw-lap-seat-gate-"));
  homes.push(home);
  const base = batchDeps({ home, observed });
  return {
    ...base,
    ambientEnv: hatchOpen ? { ...base.ambientEnv, SLOPWEAVER_ALLOW_OFF_SEAT_LAP: "1" } : base.ambientEnv,
    lapSeatFacts: () => facts,
    makeApi: (args) => {
      reached.apis += 1;
      return base.makeApi(args);
    },
    token: (args) => {
      reached.tokens += 1;
      return base.token(args);
    },
  };
}

describe("runGithubLap's lap-seat gate", () => {
  it("refuses an off-seat lap before the token, the API, the lock or any lane, naming the seat and the hatch", async () => {
    const observed = observe();
    const reached = { apis: 0, tokens: 0 };
    const deps = depsWith({ facts: ok(OFF_SEAT), observed, reached });
    expect(await runGithubLap({ deps, rest: [...SINGLE, "--land"] })).toBe(1);
    expect(reached).toEqual({ apis: 0, tokens: 0 });
    expect(observed.ran).toEqual([]);
    expect(observed.posted).toEqual([]);
    expect(observed.disposed).toEqual([]);
    const refusal = observed.diagnostic.join("\n");
    expect(refusal).toContain("the lap seat is lap-seat-run");
    expect(refusal).toContain("SLOPWEAVER_ALLOW_OFF_SEAT_LAP=1");
  });

  it("refuses an off-seat batch before its preflight", async () => {
    const observed = observe();
    const reached = { apis: 0, tokens: 0 };
    const deps = depsWith({ facts: ok(OFF_SEAT), observed, reached });
    expect(await runGithubLap({ deps, rest: [...ARGS, "--land"] })).toBe(1);
    expect(reached).toEqual({ apis: 0, tokens: 0 });
    expect(observed.out).toEqual([]);
  });

  it("refuses an off-seat --land-only before it reads a status or takes the lock", async () => {
    const observed = observe();
    const reached = { apis: 0, tokens: 0 };
    const deps = depsWith({ facts: ok(OFF_SEAT), observed, reached });
    expect(await runGithubLap({ deps, rest: [...SINGLE, "--land-only"] })).toBe(1);
    expect(reached).toEqual({ apis: 0, tokens: 0 });
    expect(observed.landing).toEqual([]);
  });

  it("refuses a caller whose run cannot be established", async () => {
    const observed = observe();
    const reached = { apis: 0, tokens: 0 };
    const facts = ok({ callerRun: undefined, seat: SEAT, seatRunClosed: false });
    expect(await runGithubLap({ deps: depsWith({ facts, observed, reached }), rest: SINGLE })).toBe(1);
    expect(observed.diagnostic.join("\n")).toContain("this session holds no run");
    expect(reached.tokens).toBe(0);
  });

  it("refuses a designation that will not read even with the hatch open", async () => {
    const observed = observe();
    const reached = { apis: 0, tokens: 0 };
    const facts = err(LapSeatErrors.runMissing({ slug: "lap-seat-run" }));
    const deps = depsWith({ facts, hatchOpen: true, observed, reached });
    expect(await runGithubLap({ deps, rest: SINGLE })).toBe(1);
    expect(reached.tokens).toBe(0);
    expect(observed.diagnostic.join("\n")).toContain("github lap: refused — the lap seat names lap-seat-run");
  });

  it("laps the seat's own run", async () => {
    const observed = observe();
    const reached = { apis: 0, tokens: 0 };
    const facts = ok({ callerRun: "lap-seat-run", seat: SEAT, seatRunClosed: false });
    expect(await runGithubLap({ deps: depsWith({ facts, observed, reached }), rest: SINGLE })).toBe(0);
    expect(reached).toEqual({ apis: 1, tokens: 1 });
    expect(observed.posted.map((status) => status.state)).toEqual(["pending", "pending", "success", "success"]);
  });

  it("laps off the seat with the hatch open, saying so", async () => {
    const observed = observe();
    const reached = { apis: 0, tokens: 0 };
    const deps = depsWith({ facts: ok(OFF_SEAT), hatchOpen: true, observed, reached });
    expect(await runGithubLap({ deps, rest: SINGLE })).toBe(0);
    expect(observed.out[0]).toContain("github lap: note — lapping off the seat, as the off-seat-lap hatch is open");
  });

  it("refuses every caller once the seat's run has closed, rather than lapsing the rota", async () => {
    const observed = observe();
    const reached = { apis: 0, tokens: 0 };
    const facts = ok({ ...OFF_SEAT, seatRunClosed: true });
    expect(await runGithubLap({ deps: depsWith({ facts, observed, reached }), rest: SINGLE })).toBe(1);
    expect(reached).toEqual({ apis: 0, tokens: 0 });
    expect(observed.posted).toEqual([]);
    expect(observed.diagnostic.join("\n")).toContain("the lap seat lap-seat-run names a closed run");
    expect(observed.diagnostic.join("\n")).toContain("SLOPWEAVER_ALLOW_OFF_SEAT_LAP=1");
  });

  it("never reads the seat on --dry-run, which runs and posts nothing", async () => {
    const observed = observe();
    const reached = { apis: 0, tokens: 0 };
    const facts = err(LapSeatErrors.runMissing({ slug: "lap-seat-run" }));
    expect(await runGithubLap({ deps: depsWith({ facts, observed, reached }), rest: [...SINGLE, "--dry-run"] })).toBe(
      0,
    );
    expect(observed.posted).toEqual([]);
    expect(observed.diagnostic).toEqual([]);
  });
});
