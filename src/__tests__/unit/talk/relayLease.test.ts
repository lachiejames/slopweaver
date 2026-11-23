/**
 * The run lease, proven against a real home in a temp directory.
 *
 * Per `testing.md`, every write here goes to an explicit `home` this file minted — never the ambient one. A
 * process's start time is a plain function passed in, so a dead, recycled or racing holder is a fixture rather
 * than a process — and a race is staged by running the competing hold INSIDE that function, at the exact seam
 * between reading a holder and placing the next generation.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { TalkErrors } from "../../../talk/errors.js";
import { holdTurnRun } from "../../../talk/relayLease.js";

const TURN = "a0000017-0000-4000-8000-000000000019";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "talk-lease-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("holdTurnRun — one live run per turn", () => {
  const leaseDir = (): string => join(stateHomePaths({ home }).talkTurns, `${TURN}.run`);
  const generation = ({ n }: { n: number }): string => readFileSync(join(leaseDir(), String(n)), "utf8");
  type StartOf = Parameters<typeof holdTurnRun>[0]["startOf"];
  /** The running processes, each pid started at the stamp `t<pid>`; every other pid is not running. */
  const alive =
    (...pids: number[]): StartOf =>
    (pid) =>
      pids.includes(pid) ? { running: true, start: `t${String(pid)}` } : { running: false, start: undefined };

  it("places generation 0 naming this run, and its release marks it finished", () => {
    const held = unwrap(holdTurnRun({ home, startOf: alive(), pid: 101, turnId: TURN }));
    expect(generation({ n: 0 })).toBe("101 -\n");
    held.release();
    expect(generation({ n: 0 })).toBe("released\n");
  });

  it("turns a second run away while the first is alive, and places nothing", () => {
    unwrap(holdTurnRun({ home, startOf: alive(), pid: 101, turnId: TURN }));
    expect(unwrapErr(holdTurnRun({ home, startOf: alive(101), pid: 202, turnId: TURN }))).toEqual(
      TalkErrors.relayInFlight({ pid: 101, turnId: TURN }),
    );
    expect(readdirSync(leaseDir())).toEqual(["0"]);
  });

  it("takes over a released run's lease even when its pid is in use again", () => {
    unwrap(holdTurnRun({ home, startOf: alive(), pid: 101, turnId: TURN })).release();
    unwrap(holdTurnRun({ home, startOf: alive(101), pid: 202, turnId: TURN }));
    expect(generation({ n: 1 })).toBe("202 -\n");
  });

  it("takes over a dead run's lease, and the dead run's release leaves the new holder the highest", () => {
    const dead = unwrap(holdTurnRun({ home, startOf: alive(), pid: 101, turnId: TURN }));
    unwrap(holdTurnRun({ home, startOf: alive(), pid: 202, turnId: TURN }));
    dead.release();
    expect(unwrapErr(holdTurnRun({ home, startOf: alive(202), pid: 303, turnId: TURN }))).toEqual(
      TalkErrors.relayInFlight({ pid: 202, turnId: TURN }),
    );
  });

  it("records its own start time, and takes over a killed holder whose pid an unrelated process now has", () => {
    unwrap(holdTurnRun({ home, startOf: alive(101), pid: 101, turnId: TURN }));
    expect(generation({ n: 0 })).toBe("101 t101\n");
    const recycled: StartOf = (pid) => (pid === 101 ? { running: true, start: "a later process" } : alive(202)(pid));
    unwrap(holdTurnRun({ home, startOf: recycled, pid: 202, turnId: TURN }));
    expect(generation({ n: 1 })).toBe("202 t202\n");
  });

  it("turns a run away on a holder recorded without a start time while its pid is running", () => {
    unwrap(holdTurnRun({ home, startOf: alive(), pid: 101, turnId: TURN }));
    expect(unwrapErr(holdTurnRun({ home, startOf: alive(101), pid: 202, turnId: TURN }))).toEqual(
      TalkErrors.relayInFlight({ pid: 101, turnId: TURN }),
    );
  });

  it("turns a run away when ps cannot say when a running holder started", () => {
    unwrap(holdTurnRun({ home, startOf: alive(101), pid: 101, turnId: TURN }));
    const psFailed: StartOf = (pid) => (pid === 101 ? { running: true, start: undefined } : alive(202)(pid));
    expect(unwrapErr(holdTurnRun({ home, startOf: psFailed, pid: 202, turnId: TURN }))).toEqual(
      TalkErrors.relayInFlight({ pid: 101, turnId: TURN }),
    );
  });

  it("refuses, never takes over, a generation that names no holder", () => {
    mkdirSync(leaseDir(), { recursive: true });
    writeFileSync(join(leaseDir(), "0"), "garbage\n");
    const refused = unwrapErr(holdTurnRun({ home, startOf: alive(202), pid: 202, turnId: TURN }));
    expect([refused.code, refused.message, readdirSync(leaseDir())]).toEqual([
      "PATH_UNREADABLE",
      TalkErrors.pathUnreadable({ cause: new Error("the run lease names no holder"), path: join(leaseDir(), "0") })
        .message,
      ["0"],
    ]);
  });

  it("lets exactly one of two runs that found the same dead holder take it over", () => {
    unwrap(holdTurnRun({ home, startOf: alive(), pid: 100, turnId: TURN }));
    // Run B reads dead 100; before B places generation 1, run A reads the same dead holder and takes it.
    let aTookOver = false;
    const raced: StartOf = (pid) => {
      if (!aTookOver && pid === 100) {
        aTookOver = true;
        unwrap(holdTurnRun({ home, startOf: alive(201), pid: 201, turnId: TURN }));
      }
      return alive(201, 202)(pid);
    };
    expect(unwrapErr(holdTurnRun({ home, startOf: raced, pid: 202, turnId: TURN }))).toEqual(
      TalkErrors.relayInFlight({ pid: 201, turnId: TURN }),
    );
    expect([readdirSync(leaseDir()).toSorted(), generation({ n: 1 })]).toEqual([["0", "1"], "201 t201\n"]);
  });
});
