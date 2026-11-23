import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { actId, renderJournalRow, type SweepJournalRow } from "../../../sweep/journalRow.js";
import { appendSweepRow, isJournalRow, readSweepLedger, sweepLedgerPath } from "../../../sweep/journalStore.js";

const dirs: string[] = [];

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "sweep-ledger-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

function row(over: Partial<SweepJournalRow> = {}): SweepJournalRow {
  return {
    act: "close",
    atIso: "2026-09-19T12:04:05.000Z",
    id: "sw-20260919120405-some-row",
    path: "/h/some-row.md",
    session: "workspace:151",
    slug: "some-row",
    verbLine: "slopweaver handover close some-row --summary the work is in",
    verdict: "SHIPPED",
    witness: "all 1 declared probe(s) pass against the tree — the work is in",
    ...over,
  };
}

describe("sweepLedgerPath", () => {
  it("puts the ledger under the named home's ledgers directory", () => {
    const dir = home();
    expect(sweepLedgerPath({ home: dir })).toBe(join(dir, "ledgers", "sweep.jsonl"));
  });
});

describe("readSweepLedger", () => {
  it("answers an empty list for a home that has never swept", () => {
    expect(unwrap(readSweepLedger({ path: sweepLedgerPath({ home: home() }) }))).toEqual([]);
  });

  it("reads back every appended act, oldest first", () => {
    const path = sweepLedgerPath({ home: home() });
    expect(unwrap(appendSweepRow({ path, row: row({ id: "sw-1", slug: "first-row" }) }))).toBe(true);
    expect(unwrap(appendSweepRow({ path, row: row({ id: "sw-2", slug: "second-row" }) }))).toBe(true);
    const rows = unwrap(readSweepLedger({ path }));
    expect(rows.map((stored) => stored.id)).toEqual(["sw-1", "sw-2"]);
    expect(rows[0]!.witness).toBe("all 1 declared probe(s) pass against the tree — the work is in");
  });

  it("refuses a line that is not JSON, naming the line number", () => {
    const path = sweepLedgerPath({ home: home() });
    expect(unwrap(appendSweepRow({ path, row: row() }))).toBe(true);
    writeFileSync(path, `${JSON.stringify(row())}\nnot json at all\n`, "utf8");
    const result = readSweepLedger({ path });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("CORRUPT_LEDGER_ROW");
    expect(result._unsafeUnwrapErr().message).toContain("line 2");
  });

  it("refuses a JSON line missing a required field, rather than reading it as a row", () => {
    const path = sweepLedgerPath({ home: home() });
    expect(unwrap(appendSweepRow({ path, row: row() }))).toBe(true);
    writeFileSync(path, `${JSON.stringify({ id: "sw-1", slug: "some-row" })}\n`, "utf8");
    const result = readSweepLedger({ path });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("CORRUPT_LEDGER_ROW");
  });

  it("skips a blank line rather than calling it corrupt", () => {
    const path = sweepLedgerPath({ home: home() });
    expect(unwrap(appendSweepRow({ path, row: row() }))).toBe(true);
    writeFileSync(path, `${JSON.stringify(row())}\n\n${JSON.stringify(row({ id: "sw-2" }))}\n`, "utf8");
    expect(unwrap(readSweepLedger({ path })).map((stored) => stored.id)).toEqual([
      "sw-20260919120405-some-row",
      "sw-2",
    ]);
  });
});

describe("isJournalRow", () => {
  it("accepts a complete row", () => {
    expect(isJournalRow(row())).toBe(true);
  });

  it("rejects a value that is not a record", () => {
    expect(isJournalRow("sw-1")).toBe(false);
  });

  it("rejects a record whose witness is not a string", () => {
    expect(isJournalRow({ ...row(), witness: 7 })).toBe(false);
  });
});

describe("actId", () => {
  it("derives the same id from the same instant and slug", () => {
    expect(actId({ atIso: "2026-09-19T12:04:05.000Z", slug: "some-row" })).toBe("sw-20260919120405-some-row");
  });

  it("truncates a long slug to keep the id bounded", () => {
    const id = actId({ atIso: "2026-09-19T12:04:05.000Z", slug: "a-very-long-board-row-slug-indeed-and-then-some" });
    expect(id).toBe("sw-20260919120405-a-very-long-board-row-sl");
  });
});

describe("renderJournalRow", () => {
  it("prints the id, verdict, slug, the verb line it ran and the witness", () => {
    expect(renderJournalRow({ row: row() })).toBe(
      "sw-20260919120405-some-row  2026-09-19T12:04:05.000Z  SHIPPED/close  some-row\n" +
        "    slopweaver handover close some-row --summary the work is in\n" +
        "    witness: all 1 declared probe(s) pass against the tree — the work is in",
    );
  });
});
