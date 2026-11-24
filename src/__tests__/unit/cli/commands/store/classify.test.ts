/**
 * `store classify`'s pure half: every flag, its bounds, and the report it prints, which carries counts and declared
 * names only unless a sample was asked for.
 */
import { describe, expect, it } from "vitest";

import { runStoreClassify, storeClassifyCommand } from "../../../../../cli/commands/store/classify.js";
import {
  classifyFailureLine,
  classifyIncomplete,
  classifyLines,
  parseStoreClassifyArgs,
} from "../../../../../cli/commands/store/classifyCore.js";
import { storeCommandErrorLines } from "../../../../../cli/commands/store/errors.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { zeroDataClassCounts } from "../../../../../store/dataClassResolution.js";
import { StoreErrors } from "../../../../../store/errors.js";
import type { DataClassificationReport, DataClassTableReport } from "../../../../../store/resolveDataClasses.js";

/** A classified table's report row, its counts overridable. */
const tableRow = (over: Partial<DataClassTableReport> & Pick<DataClassTableReport, "table">): DataClassTableReport => ({
  classes: zeroDataClassCounts(),
  differing: 0,
  nulls: 0,
  outcomes: [],
  scanned: 0,
  written: 0,
  ...over,
});

/** A whole report: one content row classified unknown by no rule, one census table counted, one place. */
const report = (over: Partial<DataClassificationReport> = {}): DataClassificationReport => ({
  dryRun: false,
  places: ["memories"],
  samples: [],
  tables: [
    tableRow({
      classes: { ...zeroDataClassCounts(), unknown: 3 },
      differing: 3,
      outcomes: [{ dataClass: "unknown", kind: "unknown", rows: 3, ruleId: null }],
      scanned: 3,
      table: "content",
      written: 3,
    }),
    tableRow({ table: "owner_capture" }),
    tableRow({ table: "owner_turn" }),
  ],
  unclassifiedTables: [
    { rows: 4, table: "board_row" },
    { rows: null, table: "memories" },
  ],
  ...over,
});

describe("parseStoreClassifyArgs", () => {
  it("defaults to an applying pass with no sample", () => {
    expect(unwrap(parseStoreClassifyArgs({ rest: [] }))).toEqual({ dryRun: false, json: false });
  });

  it("reads every flag", () => {
    expect(
      unwrap(
        parseStoreClassifyArgs({
          rest: ["--dry-run", "--json", "--batch", "500", "--sample", "10", "--home", "/tmp/h"],
        }),
      ),
    ).toEqual({ batch: 500, dryRun: true, home: "/tmp/h", json: true, sample: 10 });
  });

  it("refuses a batch past the parameter bound", () => {
    const error = unwrapErr(parseStoreClassifyArgs({ rest: ["--batch", "30001"] }));
    expect(storeCommandErrorLines({ error })[0]).toContain("--batch is at most 30000, not 30001");
  });

  it("refuses a sample past its cap and one below one", () => {
    const over = unwrapErr(parseStoreClassifyArgs({ rest: ["--sample", "101"] }));
    expect(storeCommandErrorLines({ error: over })[0]).toContain("--sample is at most 100, not 101");
    const under = unwrapErr(parseStoreClassifyArgs({ rest: ["--sample", "0"] }));
    expect(under.code).toBe("BATCH_INVALID");
  });
});

describe("classifyLines", () => {
  it("prints counts and declared names, and no row id without a sample", () => {
    expect(classifyLines({ report: report() })).toEqual([
      "store classify (applied): 3 row(s) across 3 classified table(s), 3 written",
      "  content        scanned 3, differing 3, written 3; public 0, internal 0, personal 0, restricted 0, unknown 3; no class 0",
      "  owner_capture  scanned 0, differing 0, written 0; public 0, internal 0, personal 0, restricted 0, unknown 0; no class 0",
      "  owner_turn     scanned 0, differing 0, written 0; public 0, internal 0, personal 0, restricted 0, unknown 0; no class 0",
      "  by rule:",
      "    content (no rule) unknown → unknown 3",
      "  no class column, every row fails closed as unknown: 2 table(s), 4 row(s); board_row=4",
      "  not in this store: memories",
      "  places, never read and never classified, fail closed: 1; memories",
    ]);
  });

  it("prints sampled row ids only under a sample, and says none for an empty one", () => {
    const lines = classifyLines({
      report: report({
        samples: [
          { dataClass: "restricted", refs: [] },
          { dataClass: "unknown", refs: [{ id: "c-1", table: "content" }] },
        ],
      }),
    });
    expect(lines.slice(-2)).toEqual([
      "  sample restricted (owner only, never copied out): none",
      "  sample unknown (owner only, never copied out): content/c-1",
    ]);
  });

  it("says a dry run wrote nothing", () => {
    expect(classifyLines({ report: report({ dryRun: true }) })[0]).toBe(
      "store classify (dry run, nothing written; counts are what an apply would store): 3 row(s) across 3 classified table(s), 3 written",
    );
  });

  it("names an applying pass that left a row with no class", () => {
    const left = report({ tables: [tableRow({ nulls: 2, table: "owner_capture" })] });
    expect(classifyLines({ report: left }).at(-1)).toBe(
      "  NOT COMPLETE: 2 row(s) still hold no class — a write landed during the pass; run it again",
    );
    expect(classifyIncomplete({ report: left })).toBe(true);
  });
});

describe("classifyIncomplete", () => {
  it("is false for a complete applying pass, and for a dry run whatever it found", () => {
    expect(classifyIncomplete({ report: report() })).toBe(false);
    const dry = report({ dryRun: true, tables: [tableRow({ nulls: 5, table: "content" })] });
    expect(classifyIncomplete({ report: dry })).toBe(false);
  });
});

describe("classifyFailureLine", () => {
  it("withholds a database refusal's text, which can quote a stored value, and names its SQLSTATE", () => {
    const driver = Object.assign(new Error("TOP-SECRET-BODY"), { code: "P0001" });
    const wrapped = new Error("Failed query: update content …", { cause: driver });
    const line = classifyFailureLine({ error: StoreErrors.queryFailed({ cause: wrapped, what: "store classify" }) });
    expect(line).toBe(
      "store classify failed: the database refused a statement with SQLSTATE P0001; its message is withheld because it can quote a stored value",
    );
    expect(StoreErrors.queryFailed({ cause: wrapped, what: "store classify" }).message).toContain("TOP-SECRET-BODY");
  });

  it("says so when the database error carries no SQLSTATE", () => {
    const line = classifyFailureLine({
      error: StoreErrors.queryFailed({ cause: new Error("TOP-SECRET-BODY"), what: "store classify" }),
    });
    expect(line).toBe(
      "store classify failed: the database refused a statement with no SQLSTATE; its message is withheld because it can quote a stored value",
    );
  });

  it("prints a refusal the pass raised itself whole", () => {
    const error = StoreErrors.queryFailed({
      cause: "the data-class census declares no decision for new_table",
      what: "store classify",
    });
    expect(classifyFailureLine({ error })).toBe(
      "store classify failed: the data-class census declares no decision for new_table",
    );
  });
});

describe("storeClassifyCommand", () => {
  it("is the verb the manifest loads", () => {
    expect(storeClassifyCommand).toBe(runStoreClassify);
  });
});
