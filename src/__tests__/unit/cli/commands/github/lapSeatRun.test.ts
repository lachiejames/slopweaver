/*
 * `github lap-seat set|clear|show`: the parse, and each action over the real store in a throwaway home with plain
 * fakes for the clock and the session id.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { acquireLapLock, readStandingLapLock } from "../../../../../cli/commands/github/lapLock.js";
import {
  type GithubLapSeatDeps,
  LapSeatUsageErrors,
  parseGithubLapSeatArgs,
  runGithubLapSeat,
} from "../../../../../cli/commands/github/lapSeatRun.js";
import {
  clearLapSeat,
  lapSeatRunClosed,
  readLapSeat,
  writeLapSeat,
} from "../../../../../cli/commands/github/lapSeatStore.js";
import type { RunEvent } from "../../../../../handover/ledger.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const AT = "2026-11-11T12:00:00.000Z";
const LATER = "2026-11-11T12:05:00.000Z";
const SLUG = "lap-seat-run";
/** A lock this test process holds, so it reads live; its phase and subject vary per case. */
const LOCK = { pid: process.pid, startedIso: AT };

let homes: string[] = [];
afterEach(() => {
  for (const home of homes) {
    rmSync(home, { force: true, recursive: true });
  }
  homes = [];
});

/** A fresh home holding a started journal for {@link SLUG}. */
function homeWithRun(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-lap-seat-run-"));
  homes.push(home);
  const runs = stateHomePaths({ home }).runs;
  mkdirSync(runs, { recursive: true });
  const started: RunEvent = { atIso: AT, branch: SLUG, docHash: "h", kind: "started" };
  writeFileSync(join(runs, `${SLUG}.jsonl`), `${JSON.stringify(started)}\n`);
  return home;
}

/** The verb's edges over the real store under `home`, its output collected. */
function depsFor({ home, lines }: { home: string; lines: string[] }): GithubLapSeatDeps {
  return {
    clearSeat: clearLapSeat,
    home: () => home,
    now: () => new Date(AT),
    out: (line) => lines.push(line),
    readLapLock: readStandingLapLock,
    readSeat: readLapSeat,
    runClosed: lapSeatRunClosed,
    sessionId: () => "chair-session",
    writeDiagnostic: (line) => lines.push(line),
    writeSeat: writeLapSeat,
  };
}

describe("parseGithubLapSeatArgs", () => {
  it("parses set with its slug and a home", () => {
    expect(unwrap(parseGithubLapSeatArgs({ rest: ["set", SLUG, "--home", "/h"] }))).toEqual({
      action: "set",
      home: "/h",
      slug: SLUG,
    });
  });

  it("parses show and clear with no operand", () => {
    expect(unwrap(parseGithubLapSeatArgs({ rest: ["show"] }))).toEqual({ action: "show", home: undefined });
    expect(unwrap(parseGithubLapSeatArgs({ rest: ["clear"] }))).toEqual({ action: "clear", home: undefined });
  });

  it("refuses set without exactly one slug", () => {
    expect(unwrapErr(parseGithubLapSeatArgs({ rest: ["set"] }))).toEqual(LapSeatUsageErrors.setArity());
    expect(unwrapErr(parseGithubLapSeatArgs({ rest: ["set", "a", "b"] }))).toEqual({
      code: "SET_ARITY",
      lines: ["`lap-seat set` takes exactly one run slug"],
      message: "`lap-seat set` takes exactly one run slug",
    });
  });

  it("refuses a slug that is not a run name", () => {
    const refused = unwrapErr(parseGithubLapSeatArgs({ rest: ["set", "../x"] }));
    expect(refused.code).toBe("NOT_A_SLUG");
    expect(refused.lines).toEqual(['"../x" is not a run slug (letters, digits, . _ -)']);
  });

  it("refuses an operand on show, and a missing or unknown action", () => {
    const operand = unwrapErr(parseGithubLapSeatArgs({ rest: ["show", SLUG] }));
    expect(operand.code).toBe("OPERAND_GIVEN");
    expect(operand.lines).toEqual(["`lap-seat show` takes no operand"]);
    expect(unwrapErr(parseGithubLapSeatArgs({ rest: [] })).lines).toEqual([
      "name one action: set <slug>, clear or show",
    ]);
    expect(unwrapErr(parseGithubLapSeatArgs({ rest: ["take"] })).code).toBe("NO_ACTION");
  });

  it("carries every flag problem the shared parser names, one line each", () => {
    const refused = unwrapErr(parseGithubLapSeatArgs({ rest: ["show", "--bogus"] }));
    expect(refused.code).toBe("FLAGS_REFUSED");
    expect(refused.lines.length).toBeGreaterThan(0);
    expect(refused.message).toBe(refused.lines.join("; "));
  });
});

describe("runGithubLapSeat", () => {
  it("sets a run with a started journal, attributing the setting session, and shows it back", () => {
    const home = homeWithRun();
    const lines: string[] = [];
    expect(runGithubLapSeat({ deps: depsFor({ home, lines }), rest: ["set", SLUG] })).toBe(0);
    expect(unwrap(readLapSeat({ home }))).toEqual({ setBy: "chair-session", setIso: AT, slug: SLUG });
    expect(runGithubLapSeat({ deps: depsFor({ home, lines }), rest: ["show"] })).toBe(0);
    expect(lines).toEqual([
      `github lap-seat: ${SLUG} holds the lap seat, set ${AT} by session chair-session`,
      `github lap-seat: ${SLUG} holds the lap seat, set ${AT} by session chair-session`,
      "github lap-seat: no lap holds the machine",
    ]);
  });

  it("names a lap in its preflight, before its lanes, even while no seat stands", async () => {
    const home = homeWithRun();
    const lines: string[] = [];
    const held = unwrap(acquireLapLock({ home, lock: { ...LOCK, phase: "preflight", subject: "o/r#7" } }));
    expect(runGithubLapSeat({ deps: depsFor({ home, lines }), rest: ["show"] })).toBe(3);
    await held.dispose();
    expect(lines).toEqual([
      "github lap-seat: none stands; any session may lap",
      `github lap-seat: a lap holds the machine: o/r#7, pid ${String(process.pid)}, since ${AT}, still in its preflight, before its lanes`,
    ]);
  });

  it("names a lap once it has advanced to running on its head", async () => {
    const home = homeWithRun();
    const lines: string[] = [];
    const held = unwrap(acquireLapLock({ home, lock: { ...LOCK, phase: "preflight", subject: "o/r#7" } }));
    unwrap(held.value.advance({ startedIso: LATER, subject: "o/r#7@abc" }));
    runGithubLapSeat({ deps: depsFor({ home, lines }), rest: ["show"] });
    await held.dispose();
    expect(lines.at(-1)).toBe(
      `github lap-seat: a lap holds the machine: o/r#7@abc, pid ${String(process.pid)}, since ${LATER}, running its lanes or landing`,
    );
  });

  it("refuses to set a run that has no journal, as a usage mistake, writing nothing", () => {
    const home = homeWithRun();
    const lines: string[] = [];
    expect(runGithubLapSeat({ deps: depsFor({ home, lines }), rest: ["set", "no-such-run"] })).toBe(2);
    expect(unwrap(readLapSeat({ home }))).toBe(undefined);
    expect(lines[0]).toContain("the lap seat names no-such-run, which has no started run journal");
  });

  it("refuses to set a closed run, since a closed seat refuses every lap, writing nothing", () => {
    const home = homeWithRun();
    const finished: RunEvent = { atIso: AT, kind: "finished", residue: [] };
    writeFileSync(join(stateHomePaths({ home }).runs, `${SLUG}.jsonl`), `${JSON.stringify(finished)}\n`, {
      flag: "a",
    });
    const lines: string[] = [];
    expect(runGithubLapSeat({ deps: depsFor({ home, lines }), rest: ["set", SLUG] })).toBe(2);
    expect(unwrap(readLapSeat({ home }))).toBe(undefined);
    expect(lines).toEqual([
      `github lap-seat: ${SLUG} is closed, and a closed seat refuses every lap; designate an open run, or reopen it first`,
    ]);
  });

  it("shows none as an expected-empty exit", () => {
    const lines: string[] = [];
    expect(runGithubLapSeat({ deps: depsFor({ home: homeWithRun(), lines }), rest: ["show"] })).toBe(3);
    expect(lines).toEqual([
      "github lap-seat: none stands; any session may lap",
      "github lap-seat: no lap holds the machine",
    ]);
  });

  it("clears a standing designation, then reports nothing to clear", () => {
    const home = homeWithRun();
    const lines: string[] = [];
    runGithubLapSeat({ deps: depsFor({ home, lines }), rest: ["set", SLUG] });
    expect(runGithubLapSeat({ deps: depsFor({ home, lines }), rest: ["clear"] })).toBe(0);
    expect(runGithubLapSeat({ deps: depsFor({ home, lines }), rest: ["clear"] })).toBe(0);
    expect(lines.slice(1)).toEqual([
      "github lap-seat: cleared; no rota stands, so any session may lap",
      "github lap-seat: none stood; nothing to clear",
    ]);
  });

  it("answers a parse mistake with the usage and exit 2", () => {
    const lines: string[] = [];
    expect(runGithubLapSeat({ deps: depsFor({ home: homeWithRun(), lines }), rest: ["take"] })).toBe(2);
    expect(lines[0]).toBe("name one action: set <slug>, clear or show");
    expect(lines[1]).toContain("usage: slopweaver github lap-seat");
  });
});
