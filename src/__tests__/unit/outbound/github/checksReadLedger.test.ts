/**
 * The checks-read register: what it stores, what it refuses to store, and the fold the gate asks.
 *
 * The fold is the part with teeth, and its two interesting cases are both in the brief that built it:
 *
 * - a read of a head an AMEND has since replaced still discharges its raise, because matching on head SHA
 *   would trap every session that amends before it looks;
 * - a read recorded BEFORE a raise discharges nothing, because the question is whether anybody looked at
 *   what was just pushed.
 *
 * The round trip writes into a `mkdtempSync` home and passes it explicitly, per `.claude/rules/testing.md`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  appendChecksReadRecord,
  type ChecksRaisedRecord,
  type ChecksReadRow,
  type ChecksSeenRecord,
  type ChecksWatchDoneRecord,
  type ChecksWatchingRecord,
  checksReadCommand,
  checksReadLedgerPath,
  readChecksReadLedger,
  unreadRaises,
} from "../../../../outbound/github/checksReadLedger.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  cleanups.splice(0).forEach((clean) => {
    clean();
  });
});

/** A throwaway state home this test owns outright, with its `ledgers/` directory already there. */
function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-cr-"));
  mkdirSync(join(dir, "ledgers"), { recursive: true });
  cleanups.push(() => {
    rmSync(dir, { force: true, recursive: true });
  });
  return dir;
}

function raise({
  number = 16415,
  branch = "work",
  headSha = "aaaaaaa",
  atIso = "2026-08-31T01:00:00.000Z",
  repo = "acme/acme-admin",
}: Partial<ChecksRaisedRecord> = {}): ChecksRaisedRecord {
  return { atIso, branch, headSha, kind: "raised", number, repo };
}

function read({
  number = 16415,
  headSha = "aaaaaaa",
  atIso = "2026-08-31T02:00:00.000Z",
  repo = "acme/acme-admin",
  rollup = "FAILURE",
}: Partial<ChecksSeenRecord> = {}): ChecksSeenRecord {
  return { atIso, headSha, kind: "read", number, repo, rollup };
}

function watching({
  number = 16415,
  headSha = "aaaaaaa",
  atIso = "2026-08-31T02:00:00.000Z",
  repo = "acme/acme-admin",
  session = "sess-a",
  mode = "wait",
  timeoutSeconds = 600,
}: Partial<ChecksWatchingRecord> = {}): ChecksWatchingRecord {
  return { atIso, headSha, kind: "watching", mode, number, repo, session, timeoutSeconds };
}

function watchDone({
  number = 16415,
  headSha = "aaaaaaa",
  atIso = "2026-08-31T02:05:00.000Z",
  repo = "acme/acme-admin",
  session = "sess-a",
  outcome = "done",
}: Partial<ChecksWatchDoneRecord> = {}): ChecksWatchDoneRecord {
  return { atIso, headSha, kind: "watch-done", number, outcome, repo, session };
}

describe("unreadRaises", () => {
  it("reports a raise nothing has read", () => {
    expect(unreadRaises({ branch: "work", rows: [raise()] })).toEqual([raise()]);
  });

  it("discharges a raise with a later read of the same pull request", () => {
    expect(unreadRaises({ branch: "work", rows: [raise(), read()] })).toEqual([]);
  });

  it("discharges a raise with a read of a head an amend has since replaced", () => {
    const rows: readonly ChecksReadRow[] = [raise(), read({ headSha: "bbbbbbb" })];
    expect(unreadRaises({ branch: "work", rows })).toEqual([]);
  });

  it("does not let a read recorded BEFORE the raise discharge it", () => {
    const rows: readonly ChecksReadRow[] = [read({ atIso: "2026-08-30T23:00:00.000Z" }), raise()];
    expect(unreadRaises({ branch: "work", rows })).toEqual([raise()]);
  });

  it("ignores a raise on another branch, so one session never blocks another's settle", () => {
    expect(unreadRaises({ branch: "work", rows: [raise({ branch: "somebody-else" })] })).toEqual([]);
  });

  it("does not let a read of a DIFFERENT pull request discharge this one", () => {
    expect(unreadRaises({ branch: "work", rows: [raise(), read({ number: 16416 })] })).toEqual([raise()]);
  });

  it("is not discharged by a watch row: watching is not the same as having read", () => {
    const rows: ChecksReadRow[] = [raise(), watching({ atIso: "2026-08-31T02:00:00.000Z" })];
    expect(unreadRaises({ branch: "work", rows })).toEqual([raise()]);
  });

  it("reports nothing for an empty register", () => {
    expect(unreadRaises({ branch: "work", rows: [] })).toEqual([]);
  });
});

describe("checksReadCommand", () => {
  it("names the repository and the number, so a session can paste it", () => {
    expect(checksReadCommand({ row: raise() })).toBe(
      "slopweaver github checks --repo acme/acme-admin --number 16415 --wait",
    );
  });
});

describe("the register on disk", () => {
  it("is empty on an install that has raised nothing", () => {
    const result = readChecksReadLedger({ home: home() });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual([]);
  });

  it("round-trips a raise and a read in the order they were written", () => {
    const dir = home();
    expect(appendChecksReadRecord({ home: dir, nowIso: raise().atIso, row: raise() }).isOk()).toBe(true);
    expect(appendChecksReadRecord({ home: dir, nowIso: read().atIso, row: read() }).isOk()).toBe(true);
    const result = readChecksReadLedger({ home: dir });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual([raise(), read()]);
  });

  it("round-trips a watching row and its watch-done, each with its session", () => {
    const dir = home();
    expect(appendChecksReadRecord({ home: dir, nowIso: watching().atIso, row: watching() }).isOk()).toBe(true);
    expect(appendChecksReadRecord({ home: dir, nowIso: watchDone().atIso, row: watchDone() }).isOk()).toBe(true);
    expect(unwrap(readChecksReadLedger({ home: dir }))).toEqual([watching(), watchDone()]);
  });

  it("refuses a watch row carrying no session, because nobody would be watching", () => {
    const dir = home();
    const { session: _dropped, ...noSession } = watching();
    writeFileSync(checksReadLedgerPath({ home: dir }), `${JSON.stringify(noSession)}\n`);
    const result = readChecksReadLedger({ home: dir });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("session");
  });

  it("refuses a watching row whose mode is not one the verb has", () => {
    const dir = home();
    writeFileSync(checksReadLedgerPath({ home: dir }), `${JSON.stringify({ ...watching(), mode: "forever" })}\n`);
    const result = readChecksReadLedger({ home: dir });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("mode");
  });

  it("refuses a watching row whose timeout is not positive, since staleness could never be judged", () => {
    const dir = home();
    writeFileSync(checksReadLedgerPath({ home: dir }), `${JSON.stringify({ ...watching(), timeoutSeconds: 0 })}\n`);
    const result = readChecksReadLedger({ home: dir });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("timeoutSeconds");
  });

  it("refuses a watch-done carrying no outcome", () => {
    const dir = home();
    const { outcome: _dropped, ...noOutcome } = watchDone();
    writeFileSync(checksReadLedgerPath({ home: dir }), `${JSON.stringify(noOutcome)}\n`);
    const result = readChecksReadLedger({ home: dir });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("outcome");
  });

  it("refuses a raise line carrying no branch, naming the line number", () => {
    const dir = home();
    writeFileSync(
      checksReadLedgerPath({ home: dir }),
      `${JSON.stringify({ atIso: "2026-08-31T01:00:00.000Z", headSha: "a", kind: "raised", number: 1, repo: "o/r" })}\n`,
    );
    const result = readChecksReadLedger({ home: dir });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("CORRUPT_ROW");
    expect(unwrapErr(result).message).toContain("line 1");
  });

  it("refuses a read line carrying no rollup", () => {
    const dir = home();
    writeFileSync(
      checksReadLedgerPath({ home: dir }),
      `${JSON.stringify({ atIso: "2026-08-31T02:00:00.000Z", headSha: "a", kind: "read", number: 1, repo: "o/r" })}\n`,
    );
    const result = readChecksReadLedger({ home: dir });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("rollup");
  });

  it("refuses a line whose atIso is not an instant", () => {
    const dir = home();
    writeFileSync(
      checksReadLedgerPath({ home: dir }),
      `${JSON.stringify({ atIso: "whenever", branch: "work", headSha: "a", kind: "raised", number: 1, repo: "o/r" })}\n`,
    );
    const result = readChecksReadLedger({ home: dir });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("atIso");
  });
});
