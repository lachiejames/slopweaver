/**
 * THE HYGIENE LEDGER — the pure line and fold, plus one real round trip through a throwaway home.
 *
 * Two properties are what this file exists to hold down:
 *
 *  - **a refusal is TERMINAL.** The fold's one asymmetry, so the case feeds a later `proposed` row after the
 *    refusal and asserts it did not revive. An implementation reading "the last row wins" passes every other test
 *    here and re-proposes something the owner already killed.
 *  - **`daysSeen` counts distinct CALENDAR DAYS.** Two runs in one day must not inflate it, which a counter of
 *    rows would.
 *
 * The round trip writes to a `mkdtempSync` home it removes, and never to the ambient one.
 *
 * Everything here is invented. This is a public repository, and a fixture is the easiest place for a private
 * string to arrive unnoticed.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import {
  foldHygieneLedger,
  HYGIENE_ANSWERS,
  HYGIENE_DISPOSITIONS,
  type HygieneRow,
  hygieneLedgerLine,
  hygieneLedgerPath,
  parseHygieneRows,
  readHygieneLedgerRows,
  recordHygieneRows,
} from "../../../../memory/hygiene/ledger.js";

/** A row carrying only what a case varies. */
function rowOf(over: Partial<HygieneRow> = {}): HygieneRow {
  return {
    check: "duplicate",
    disposition: "proposed",
    id: "abc123abc123",
    recommendation: "adjust",
    subject: "a.md + b.md",
    tsIso: "2026-09-18T08:00:00.000Z",
    ...over,
  };
}

describe("hygieneLedgerLine", () => {
  it("renders keys in a fixed order, so two runs writing the same row are byte-identical", () => {
    expect(hygieneLedgerLine({ row: rowOf() })).toBe(
      '{"check":"duplicate","disposition":"proposed","id":"abc123abc123","recommendation":"adjust","schemaVersion":1,"subject":"a.md + b.md","tsIso":"2026-09-18T08:00:00.000Z"}',
    );
  });

  it("omits `why` entirely rather than writing a null", () => {
    expect(hygieneLedgerLine({ row: rowOf() })).not.toContain("why");
    expect(hygieneLedgerLine({ row: rowOf({ why: "both stand" }) })).toContain('"why":"both stand"');
  });
});

describe("parseHygieneRows", () => {
  it("round-trips a row through its own rendering", () => {
    const row = rowOf({ disposition: "refused", why: "both stand" });
    expect(parseHygieneRows({ text: `${hygieneLedgerLine({ row })}\n` })).toEqual([row]);
  });

  it("tolerates a truncated final line, which is what a process dying mid-append leaves", () => {
    const good = hygieneLedgerLine({ row: rowOf() });
    const truncated = good.slice(0, 20);
    expect(parseHygieneRows({ text: `${good}\n${truncated}` }).map((row) => row.id)).toEqual(["abc123abc123"]);
  });

  it("skips a row whose check, disposition or recommendation this version cannot read", () => {
    const lines = [
      '{"check":"not-a-check","disposition":"proposed","id":"x","recommendation":"adjust","subject":"s","tsIso":"t"}',
      '{"check":"duplicate","disposition":"pondered","id":"x","recommendation":"adjust","subject":"s","tsIso":"t"}',
      '{"check":"duplicate","disposition":"proposed","id":"x","recommendation":"maybe","subject":"s","tsIso":"t"}',
      '{"check":"duplicate","disposition":"proposed","id":42,"recommendation":"adjust","subject":"s","tsIso":"t"}',
      hygieneLedgerLine({ row: rowOf() }),
    ];
    expect(parseHygieneRows({ text: lines.join("\n") }).map((row) => row.id)).toEqual(["abc123abc123"]);
  });

  it("reads an empty ledger as no rows", () => {
    expect(parseHygieneRows({ text: "" })).toEqual([]);
    expect(parseHygieneRows({ text: "\n\n  \n" })).toEqual([]);
  });

  it("drops a blank `why` rather than carrying an empty reason", () => {
    const line =
      '{"check":"duplicate","disposition":"refused","id":"x","recommendation":"adjust","subject":"s","tsIso":"t","why":"   "}';
    expect(parseHygieneRows({ text: line })[0]!.why).toBe(undefined);
  });
});

describe("foldHygieneLedger", () => {
  it("counts distinct calendar days, so two runs in one day do not inflate recurrence", () => {
    const rows = [
      rowOf({ tsIso: "2026-09-17T08:00:00.000Z" }),
      rowOf({ tsIso: "2026-09-17T19:00:00.000Z" }),
      rowOf({ tsIso: "2026-09-18T08:00:00.000Z" }),
    ];
    const state = foldHygieneLedger({ rows }).get("abc123abc123")!;
    expect(state.daysSeen).toBe(2);
    expect(state.firstSeenIso).toBe("2026-09-17T08:00:00.000Z");
    expect(state.lastSeenIso).toBe("2026-09-18T08:00:00.000Z");
  });

  it("makes a refusal TERMINAL — a later proposal does not revive it", () => {
    const rows = [
      rowOf({ tsIso: "2026-09-17T08:00:00.000Z" }),
      rowOf({ disposition: "refused", tsIso: "2026-09-17T09:00:00.000Z", why: "both stand" }),
      rowOf({ tsIso: "2026-09-18T08:00:00.000Z" }),
    ];
    const state = foldHygieneLedger({ rows }).get("abc123abc123")!;
    expect(state.refused).toBe(true);
    expect(state.why).toBe("both stand");
  });

  it("counts only `proposed` rows as days, so an answer does not read as another sighting", () => {
    const rows = [
      rowOf({ tsIso: "2026-09-17T08:00:00.000Z" }),
      rowOf({ disposition: "accepted", tsIso: "2026-09-18T08:00:00.000Z" }),
    ];
    const state = foldHygieneLedger({ rows }).get("abc123abc123")!;
    expect(state.daysSeen).toBe(1);
    expect(state.accepted).toBe(true);
    expect(state.refused).toBe(false);
  });

  it("carries the LATEST recommendation, because the arm legitimately demotes a drop between runs", () => {
    const rows = [
      rowOf({ check: "enforcement", recommendation: "drop", tsIso: "2026-09-17T08:00:00.000Z" }),
      rowOf({ check: "enforcement", recommendation: "keep", tsIso: "2026-09-18T08:00:00.000Z" }),
    ];
    expect(foldHygieneLedger({ rows }).get("abc123abc123")!.recommendation).toBe("keep");
  });

  it("keeps one state per id", () => {
    const rows = [rowOf({ id: "first-000000" }), rowOf({ id: "second-00000" })];
    expect([...foldHygieneLedger({ rows }).keys()]).toEqual(["first-000000", "second-00000"]);
  });

  it("folds an empty ledger to no states", () => {
    expect(foldHygieneLedger({ rows: [] }).size).toBe(0);
  });
});

describe("recordHygieneRows", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "hygiene-ledger-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("appends across two calls and folds both back into one state", () => {
    expect(unwrap(recordHygieneRows({ home, rows: [rowOf({ tsIso: "2026-09-17T08:00:00.000Z" })] }))).toBe(1);
    expect(
      unwrap(
        recordHygieneRows({
          home,
          rows: [rowOf({ disposition: "refused", tsIso: "2026-09-18T08:00:00.000Z", why: "both stand" })],
        }),
      ),
    ).toBe(1);
    const states = foldHygieneLedger({ rows: readHygieneLedgerRows({ home }) });
    const state = states.get("abc123abc123")!;
    expect(state.daysSeen).toBe(1);
    expect(state.refused).toBe(true);
    expect(hygieneLedgerPath({ home })).toBe(join(home, "ledgers", "memory", "hygiene.jsonl"));
  });

  it("writes nothing and reports zero for an empty batch", () => {
    expect(unwrap(recordHygieneRows({ home, rows: [] }))).toBe(0);
    expect(readHygieneLedgerRows({ home })).toEqual([]);
  });
});

describe("HYGIENE_DISPOSITIONS", () => {
  it("is the closed set the parser accepts, and the owner writes all of it but the first", () => {
    expect(HYGIENE_DISPOSITIONS.length).toBeGreaterThan(0);
    const rejected = HYGIENE_DISPOSITIONS.filter(
      (disposition) => parseHygieneRows({ text: hygieneLedgerLine({ row: rowOf({ disposition }) }) }).length === 0,
    );
    expect(rejected).toEqual([]);
    expect(HYGIENE_ANSWERS.filter((answer) => !HYGIENE_DISPOSITIONS.includes(answer))).toEqual([]);
    const answers: readonly string[] = HYGIENE_ANSWERS;
    expect([...HYGIENE_DISPOSITIONS].filter((disposition) => !answers.includes(disposition))).toEqual(["proposed"]);
  });
});
