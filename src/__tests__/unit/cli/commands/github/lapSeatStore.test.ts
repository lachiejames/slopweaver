/*
 * The lap seat's file edges, over a real throwaway home: the designation round-trips, every damaged state FAILS
 * CLOSED rather than reading as "no rota" or "rota lapsed", and the caller's run is the one whose journal names
 * this session as writer — so a fresh reseat does not hold the seat until it claims the run.
 */

import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  clearLapSeat,
  lapSeatFacts,
  lapSeatRunClosed,
  readLapSeat,
  writeLapSeat,
} from "../../../../../cli/commands/github/lapSeatStore.js";
import type { RunEvent } from "../../../../../handover/ledger.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const AT = "2026-11-11T12:00:00.000Z";
const SLUG = "lap-seat-run";
const STARTED: RunEvent = { atIso: AT, branch: SLUG, docHash: "h", kind: "started" };

/** A `launched` event naming the session that writes the run. */
function launched({ sessionId }: { sessionId: string }): RunEvent {
  return { atIso: AT, kind: "launched", pid: 4242, sessionId, worktree: `/w/${SLUG}` };
}

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  dirs = [];
});

/** A fresh state home this file removes after each test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-lap-seat-"));
  dirs.push(home);
  return home;
}

/** Write one run's journal under `home`, one event per line, or raw text when given. */
function writeJournal({
  home,
  slug,
  events = [],
  raw,
}: {
  home: string;
  slug: string;
  events?: readonly RunEvent[];
  raw?: string;
}): void {
  const runs = stateHomePaths({ home }).runs;
  mkdirSync(runs, { recursive: true });
  const path = join(runs, `${slug}.jsonl`);
  if (raw !== undefined) {
    writeFileSync(path, raw);
    return;
  }
  writeFileSync(path, events.map((event) => `${JSON.stringify(event)}\n`).join(""));
}

/** Write raw text where the seat file goes. */
function writeSeatText({ home, text }: { home: string; text: string }): void {
  mkdirSync(stateHomePaths({ home }).laps, { recursive: true });
  writeFileSync(stateHomePaths({ home }).lapSeatJson, text);
}

/** A directory named for a run, as `cmux spawn` seats a run in a worktree named for its slug. */
function cwdNamed({ slug }: { slug: string }): string {
  const parent = mkdtempSync(join(tmpdir(), "sw-lap-seat-cwd-"));
  dirs.push(parent);
  const cwd = join(parent, slug);
  mkdirSync(cwd);
  return cwd;
}

describe("readLapSeat / writeLapSeat / clearLapSeat", () => {
  it("reads no designation from a home that has none", () => {
    expect(unwrap(readLapSeat({ home: freshHome() }))).toBe(undefined);
  });

  it("round-trips a designation, owner-only", () => {
    const home = freshHome();
    const seat = { setBy: "session-1", setIso: AT, slug: SLUG };
    expect(unwrap(writeLapSeat({ home, seat }))).toBe(stateHomePaths({ home }).lapSeatJson);
    expect(unwrap(readLapSeat({ home }))).toEqual(seat);
    expect(statSync(stateHomePaths({ home }).lapSeatJson).mode & 0o777).toBe(0o600);
  });

  it("refuses a seat file that is not JSON", () => {
    const home = freshHome();
    writeSeatText({ home, text: "{ not json" });
    expect(unwrapErr(readLapSeat({ home })).code).toBe("SEAT_INVALID");
  });

  it("refuses a seat file whose fields do not decode", () => {
    const home = freshHome();
    writeSeatText({ home, text: JSON.stringify({ setIso: AT, slug: SLUG, who: "x" }) });
    expect(unwrapErr(readLapSeat({ home })).code).toBe("SEAT_INVALID");
  });

  it("clears a damaged designation without decoding it, then reports none", () => {
    const home = freshHome();
    writeSeatText({ home, text: "garbage" });
    expect(unwrap(clearLapSeat({ home }))).toBe("cleared");
    expect(unwrap(clearLapSeat({ home }))).toBe("absent");
    expect(unwrap(readLapSeat({ home }))).toBe(undefined);
  });
});

describe("lapSeatRunClosed", () => {
  it("refuses a seat whose run has no journal, rather than reading it as closed", () => {
    expect(unwrapErr(lapSeatRunClosed({ home: freshHome(), slug: SLUG })).code).toBe("RUN_MISSING");
  });

  it("refuses an empty journal, which never started", () => {
    const home = freshHome();
    writeJournal({ events: [], home, slug: SLUG });
    expect(unwrapErr(lapSeatRunClosed({ home, slug: SLUG })).code).toBe("RUN_MISSING");
  });

  it("refuses a journal holding a line this checkout cannot decode", () => {
    const home = freshHome();
    writeJournal({ home, raw: `${JSON.stringify(STARTED)}\n{ torn\n`, slug: SLUG });
    expect(unwrapErr(lapSeatRunClosed({ home, slug: SLUG })).code).toBe("RUN_UNREADABLE");
  });

  it("reads an open run as not closed", () => {
    const home = freshHome();
    writeJournal({ events: [STARTED, launched({ sessionId: "seat-session" })], home, slug: SLUG });
    expect(unwrap(lapSeatRunClosed({ home, slug: SLUG }))).toBe(false);
  });

  it("reads a finished run as closed", () => {
    const home = freshHome();
    writeJournal({ events: [STARTED, { atIso: AT, kind: "finished", residue: [] }], home, slug: SLUG });
    expect(unwrap(lapSeatRunClosed({ home, slug: SLUG }))).toBe(true);
  });
});

describe("lapSeatFacts", () => {
  it("reads no seat and no caller when no designation stands", () => {
    expect(unwrap(lapSeatFacts({ cwd: cwdNamed({ slug: SLUG }), env: {}, home: freshHome() }))).toEqual({
      callerRun: undefined,
      seat: undefined,
      seatRunClosed: false,
    });
  });

  it("names the caller's run when its journal names this session as writer", () => {
    const home = freshHome();
    writeJournal({ events: [STARTED, launched({ sessionId: "seat-session" })], home, slug: SLUG });
    unwrap(writeLapSeat({ home, seat: { setIso: AT, slug: SLUG } }));
    const facts = unwrap(
      lapSeatFacts({ cwd: cwdNamed({ slug: SLUG }), env: { CLAUDE_CODE_SESSION_ID: "seat-session" }, home }),
    );
    expect(facts.callerRun).toBe(SLUG);
    expect(facts.seatRunClosed).toBe(false);
  });

  it("names no run for a fresh session in the seat's own worktree that has not claimed it", () => {
    const home = freshHome();
    writeJournal({ events: [STARTED, launched({ sessionId: "seat-session" })], home, slug: SLUG });
    unwrap(writeLapSeat({ home, seat: { setIso: AT, slug: SLUG } }));
    const facts = unwrap(
      lapSeatFacts({ cwd: cwdNamed({ slug: SLUG }), env: { CLAUDE_CODE_SESSION_ID: "fresh-session" }, home }),
    );
    expect(facts.callerRun).toBe(undefined);
  });

  it("fails closed when the designated run's journal is gone", () => {
    const home = freshHome();
    unwrap(writeLapSeat({ home, seat: { setIso: AT, slug: SLUG } }));
    expect(unwrapErr(lapSeatFacts({ cwd: cwdNamed({ slug: SLUG }), env: {}, home })).code).toBe("RUN_MISSING");
  });
});
