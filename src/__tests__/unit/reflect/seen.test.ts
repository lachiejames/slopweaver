import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import {
  foldSeenLedger,
  parseSeenRows,
  recordSeen,
  reflectLedgerDir,
  type SeenDisposition,
  type SeenRow,
  seenLine,
} from "../../../reflect/seen.js";

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const row = (over: Partial<SeenRow> = {}): SeenRow => ({
  classKey: "donewhen-probe-named-a-flag-that-does-not-exist",
  disposition: "surfaced",
  id: "abc123def456",
  locus: "handover amend",
  occurrences: 6,
  source: "run-journal",
  tsIso: "2026-08-27T01:00:00.000Z",
  ...over,
});

const at = ({ day, disposition = "surfaced" }: { day: string; disposition?: SeenDisposition }) =>
  row({ disposition, tsIso: `${day}T01:00:00.000Z` });

describe("seenLine", () => {
  it("renders a row a jq one-liner can read", () => {
    expect(seenLine({ row: row() })).toBe(
      '{"classKey":"donewhen-probe-named-a-flag-that-does-not-exist","disposition":"surfaced","id":"abc123def456","locus":"handover amend","occurrences":6,"schemaVersion":1,"source":"run-journal","tsIso":"2026-08-27T01:00:00.000Z"}',
    );
  });

  it("omits the key entirely when there is no reason, rather than writing a null", () => {
    expect(seenLine({ row: row() })).not.toContain("why");
  });

  it("carries the owner's reason when one was given", () => {
    expect(seenLine({ row: row({ disposition: "drop", why: "already covered" }) })).toContain(
      '"why":"already covered"',
    );
  });

  it("round-trips through the parser", () => {
    expect(parseSeenRows({ text: seenLine({ row: row() }) })).toStrictEqual([row()]);
  });
});

describe("parseSeenRows", () => {
  it("skips a truncated final line rather than losing the whole ledger", () => {
    const text = `${seenLine({ row: row() })}\n{"classKey":"half`;
    expect(parseSeenRows({ text })).toHaveLength(1);
  });

  it("skips a row whose disposition this version does not know", () => {
    expect(parseSeenRows({ text: seenLine({ row: row() }).replace('"surfaced"', '"pondered"') })).toStrictEqual([]);
  });

  it("skips a row whose source this version does not know", () => {
    expect(parseSeenRows({ text: seenLine({ row: row() }).replace('"run-journal"', '"astrology"') })).toStrictEqual([]);
  });

  it("reads an empty ledger as no rows", () => {
    expect(parseSeenRows({ text: "" })).toStrictEqual([]);
  });
});

describe("foldSeenLedger", () => {
  it("counts distinct calendar days, not rows", () => {
    const rows = [at({ day: "2026-08-25" }), at({ day: "2026-08-25" }), at({ day: "2026-08-26" })];
    expect(foldSeenLedger({ rows }).get("abc123def456")!.daysSeen).toBe(2);
  });

  it("counts a backlogged sighting towards recurrence, because the miner still found it", () => {
    const rows = [at({ day: "2026-08-25", disposition: "backlogged" }), at({ day: "2026-08-26" })];
    expect(foldSeenLedger({ rows }).get("abc123def456")!.daysSeen).toBe(2);
  });

  it("does NOT count a grade towards recurrence — a grade is not a sighting", () => {
    const rows = [at({ day: "2026-08-25" }), at({ day: "2026-08-26", disposition: "keep" })];
    expect(foldSeenLedger({ rows }).get("abc123def456")!.daysSeen).toBe(1);
  });

  it("makes a drop TERMINAL — a later sighting never revives it", () => {
    const rows = [at({ day: "2026-08-25" }), at({ day: "2026-08-26", disposition: "drop" }), at({ day: "2026-08-27" })];
    expect(foldSeenLedger({ rows }).get("abc123def456")!.dropped).toBe(true);
  });

  it("makes a drop terminal even when a later grade says keep", () => {
    const rows = [at({ day: "2026-08-26", disposition: "drop" }), at({ day: "2026-08-27", disposition: "keep" })];
    const state = foldSeenLedger({ rows }).get("abc123def456")!;
    expect(state.dropped).toBe(true);
    expect(state.grade).toBe("keep");
  });

  it("counts only the surfacings, separately from every sighting", () => {
    const rows = [
      at({ day: "2026-08-25", disposition: "backlogged" }),
      at({ day: "2026-08-26" }),
      at({ day: "2026-08-27" }),
    ];
    expect(foldSeenLedger({ rows }).get("abc123def456")!.surfacedCount).toBe(2);
  });

  it("remembers when the finding started and when it was last seen", () => {
    const rows = [at({ day: "2026-08-25" }), at({ day: "2026-08-27" })];
    const state = foldSeenLedger({ rows }).get("abc123def456")!;
    expect(state.firstSeenIso).toBe("2026-08-25T01:00:00.000Z");
    expect(state.lastSeenIso).toBe("2026-08-27T01:00:00.000Z");
  });

  it("folds an empty ledger to an empty map", () => {
    expect(foldSeenLedger({ rows: [] }).size).toBe(0);
  });
});

describe("foldSeenLedger closedBy", () => {
  it("remembers what closed a finding and when, from the grade row that named it", () => {
    const rows = [
      at({ day: "2026-08-25" }),
      row({ closedBy: "#712", disposition: "keep", tsIso: "2026-08-26T01:00:00.000Z" }),
    ];
    const state = foldSeenLedger({ rows }).get("abc123def456")!;
    expect(state.closedBy).toBe("#712");
    expect(state.closedAtIso).toBe("2026-08-26T01:00:00.000Z");
  });

  it("keeps the closure when a later grade names none", () => {
    const rows = [
      row({ closedBy: "#712", disposition: "keep", tsIso: "2026-08-26T01:00:00.000Z" }),
      at({ day: "2026-08-27", disposition: "adjust" }),
    ];
    expect(foldSeenLedger({ rows }).get("abc123def456")!.closedBy).toBe("#712");
  });

  it("ignores a closedBy on a sighting row — only a grade closes a finding", () => {
    const rows = [row({ closedBy: "#712", disposition: "surfaced" })];
    expect(foldSeenLedger({ rows }).get("abc123def456")!.closedBy).toBeUndefined();
  });

  it("round-trips closedBy through the line and the parser", () => {
    const graded = row({ closedBy: "#712", disposition: "keep" });
    expect(parseSeenRows({ text: seenLine({ row: graded }) })).toStrictEqual([graded]);
  });
});

describe("recordSeen", () => {
  it("appends every row and reads back what it wrote", () => {
    const home = mkdtempSync(join(tmpdir(), "reflect-seen-"));
    fixtureDirs.push(home);
    const written = recordSeen({ home, rows: [row(), row({ id: "second" })] });
    expect(unwrap(written)).toBe(2);
    const text = readFileSync(join(reflectLedgerDir({ home }), "seen.jsonl"), "utf8");
    expect(parseSeenRows({ text })).toStrictEqual([row(), row({ id: "second" })]);
  });

  it("appends rather than replacing, so yesterday's recurrence survives", () => {
    const home = mkdtempSync(join(tmpdir(), "reflect-seen-"));
    fixtureDirs.push(home);
    recordSeen({ home, rows: [at({ day: "2026-08-25" })] });
    recordSeen({ home, rows: [at({ day: "2026-08-26" })] });
    const text = readFileSync(join(reflectLedgerDir({ home }), "seen.jsonl"), "utf8");
    expect(foldSeenLedger({ rows: parseSeenRows({ text }) }).get("abc123def456")!.daysSeen).toBe(2);
  });

  it("writes nothing and reports zero for an empty run", () => {
    const home = mkdtempSync(join(tmpdir(), "reflect-seen-"));
    fixtureDirs.push(home);
    expect(unwrap(recordSeen({ home, rows: [] }))).toBe(0);
  });
});
