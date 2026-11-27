import { describe, expect, it } from "vitest";
import {
  coverageRefusalLines,
  type JudgedRecord,
  recordApplies,
  unprovenWideningLines,
} from "../../../codex/baselineBumpCoverage.js";
import type { BumpRecord } from "../../../codex/bumpRecordStore.js";
import { type BumpRow, digestOf, rowKey } from "../../../devLint/baselineBump.js";
import type { Loosening } from "../../../devLint/baselineRegistry.js";

const BASE = "a".repeat(40);
const SIZE = ".baselines/file-size-baseline.json";
const WIDE: BumpRow = { cause: "widening", entry: "offenders:tools/gen.ts", file: SIZE, from: null, to: 319 };
const GROW: BumpRow = { cause: "growth", entry: "offenders:src/a.ts", file: SIZE, from: 300, to: 310 };

/** A record declaring the given rows. */
function record({ rows, reason = "r" }: { rows: readonly BumpRow[]; reason?: string }): BumpRecord {
  const digest = digestOf({ base: BASE, rows });
  return { manifest: { base: BASE, digest, loosenings: rows, reason }, path: `ledgers/baseline-bumps/${digest}.json` };
}

const strip = ({ row }: { row: BumpRow }): Loosening => ({
  entry: row.entry,
  file: row.file,
  from: row.from,
  to: row.to,
});
const keys = ({ rows }: { rows: readonly BumpRow[] }): ReadonlySet<string> =>
  new Set(rows.map((row) => rowKey({ row: strip({ row }) })));

describe("recordApplies", () => {
  it("applies when every declared row is loosened, cause aside", () => {
    expect(recordApplies({ loosenedKeys: keys({ rows: [WIDE, GROW] }), record: record({ rows: [WIDE] }) })).toBe(true);
  });

  it("does not apply when one declared row is not loosened", () => {
    expect(recordApplies({ loosenedKeys: keys({ rows: [WIDE] }), record: record({ rows: [WIDE, GROW] }) })).toBe(false);
  });
});

describe("unprovenWideningLines", () => {
  it("names a widening row on a file the change touched, and passes a growth row on one", () => {
    const one = record({ rows: [WIDE, GROW] });
    expect(unprovenWideningLines({ changedPaths: new Set(["tools/gen.ts", "src/a.ts"]), record: one })).toEqual([
      `  ${one.path}: declares ${SIZE} offenders:tools/gen.ts as widening, but the change touches the file it ` +
        "names, so this record cannot cover the row",
    ]);
  });

  it("is empty when the widening file is untouched", () => {
    expect(unprovenWideningLines({ changedPaths: new Set(["src/a.ts"]), record: record({ rows: [WIDE] }) })).toEqual(
      [],
    );
  });

  it("names a widening row whose path holds # when the change touched that exact path, and only then", () => {
    const hashed: BumpRow = {
      cause: "widening",
      entry: "sites:src/a#b.ts#jsonl-read-whole",
      file: ".baselines/whole-file-json-baseline.json",
      from: null,
      identityTuple: ["sites", "src/a#b.ts", "jsonl-read-whole"],
      to: 1,
    };
    const one = record({ rows: [hashed] });
    expect(unprovenWideningLines({ changedPaths: new Set(["src/a#b.ts"]), record: one })).toEqual([
      `  ${one.path}: declares ${hashed.file} ${hashed.entry} as widening, but the change touches the file it ` +
        "names, so this record cannot cover the row",
    ]);
    expect(unprovenWideningLines({ changedPaths: new Set(["src/other.ts"]), record: one })).toEqual([]);
  });
});

describe("coverageRefusalLines", () => {
  const witnessed = ({ one }: { one: BumpRecord }): JudgedRecord => ({
    ineligible: [],
    record: one,
    witness: { kind: "witnessed" },
  });
  const unwitnessed = ({ one, contradicted }: { one: BumpRecord; contradicted: boolean }): JudgedRecord => ({
    ineligible: [],
    record: one,
    witness: { contradicted, detail: `${one.path} has no Codex witness`, kind: "unwitnessed" },
  });

  it("is empty when every row is covered by a witnessed record", () => {
    const both = record({ rows: [WIDE, GROW] });
    expect(
      coverageRefusalLines({
        judged: [witnessed({ one: both })],
        loosened: [strip({ row: WIDE }), strip({ row: GROW })],
      }),
    ).toEqual([]);
  });

  it("clears a row one witnessed record covers, whatever a stale record beside it declares", () => {
    const stale = record({ reason: "the first try", rows: [WIDE] });
    const good = record({ reason: "the second", rows: [WIDE, GROW] });
    expect(
      coverageRefusalLines({
        judged: [unwitnessed({ contradicted: false, one: stale }), witnessed({ one: good })],
        loosened: [strip({ row: WIDE }), strip({ row: GROW })],
      }),
    ).toEqual([]);
  });

  it("refuses a CURRENT BROKEN review beside a witnessed record, first, however covered the rows are", () => {
    const broken = record({ reason: "the first try", rows: [WIDE] });
    const good = record({ reason: "the second", rows: [WIDE, GROW] });
    expect(
      coverageRefusalLines({
        judged: [unwitnessed({ contradicted: true, one: broken }), witnessed({ one: good })],
        loosened: [strip({ row: WIDE }), strip({ row: GROW })],
      }),
    ).toEqual([`  ${broken.path} has no Codex witness`]);
  });

  it("names an undeclared row, and a declared row with why each declaring record could not cover it", () => {
    const misbased = record({ rows: [WIDE] });
    const lonely: JudgedRecord = { ineligible: ["  misbased line"], record: misbased, witness: undefined };
    expect(coverageRefusalLines({ judged: [lonely], loosened: [strip({ row: WIDE }), strip({ row: GROW })] })).toEqual([
      `  ${SIZE} offenders:tools/gen.ts: null -> 319 (no applicable store bump record declaring it has a qualifying Codex witness)`,
      `  ${SIZE} offenders:src/a.ts: 300 -> 310 (no applicable store bump record declares this loosening)`,
      "  misbased line",
    ]);
  });

  it("gives an unwitnessed record's reason once, though it declares two uncovered rows", () => {
    const both = record({ rows: [WIDE, GROW] });
    expect(
      coverageRefusalLines({
        judged: [unwitnessed({ contradicted: false, one: both })],
        loosened: [strip({ row: WIDE }), strip({ row: GROW })],
      }),
    ).toEqual([
      `  ${SIZE} offenders:tools/gen.ts: null -> 319 (no applicable store bump record declaring it has a qualifying Codex witness)`,
      `  ${SIZE} offenders:src/a.ts: 300 -> 310 (no applicable store bump record declaring it has a qualifying Codex witness)`,
      `  ${both.path} has no Codex witness`,
    ]);
  });
});
