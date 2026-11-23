/**
 * `store share`'s renderer, checked on the cells that can lie.
 *
 * A size column is the one place this verb can mislead without being wrong: "0.0 MiB" printed for a register
 * nobody walked reads as migrated, and "absent" printed for one that is merely unmeasured reads as deleted.
 * Each of those is a distinct branch of `sizeCell`/`storeCell`, so each gets its own case.
 */
import { describe, expect, it } from "vitest";

import { homeShareLines } from "../../../cli/storeShare.js";
import type { HomeShareReport, RegisterShare } from "../../../store/homeShare.js";

/**
 * A register fixture with every field at its absent value unless overridden.
 *
 * @param over the fields this case cares about
 * @returns the register row
 */
const reg = (over: Partial<RegisterShare> & { kind: string }): RegisterShare => ({
  homeBytes: undefined,
  homeRecords: undefined,
  path: `/tmp/home/${over.kind}`,
  present: true,
  relativePath: over.kind,
  storeRows: undefined,
  storeUnreadBecause: undefined,
  table: undefined,
  tier: "durable",
  unmeasuredBecause: undefined,
  unmirroredBecause: undefined,
  ...over,
});

/**
 * A report fixture carrying one register list and zeroed totals.
 *
 * @param registers the rows to render
 * @returns the report
 */
const report = ({ registers }: { registers: readonly RegisterShare[] }): HomeShareReport => ({
  dataClassCensus: {
    homePaths: [{ entry: { kind: "unclassified", reason: "scratch" }, name: "tmp" }],
    registers: [{ entry: { kind: "unclassified", reason: "a place" }, name: "runs" }],
    tables: [
      { entry: { column: "data_class", kind: "row-classified" }, name: "content" },
      { entry: { kind: "unclassified", reason: "state" }, name: "run" },
      { entry: undefined, name: "orphan_rows" },
    ],
    undeclaredTables: [],
  },
  durableMirrored: 1,
  durableUnmirrored: 2,
  durableUnmirroredBytes: 3 * 1024 * 1024,
  observedAtIso: "2026-09-20T00:00:00Z",
  registers,
  residue: { sample: ["scratch"], topLevelEntries: 12, unclassified: 4 },
  scratchRegisters: ["orchestration"],
  unclassifiedTables: [],
});

describe("homeShareLines", () => {
  it("leads with the remainder the migration still owes, in the owner's own terms", () => {
    const lines = homeShareLines({ report: report({ registers: [] }) });
    expect(lines[0]).toBe(
      "store share: 1/3 durable registers mirrored into the store; 2 are not, holding 3.0 MiB\n" +
        "  recompute: slopweaver store share --json",
    );
  });

  it("says a register was never measured rather than printing a zero that reads as migrated", () => {
    const lines = homeShareLines({
      report: report({ registers: [reg({ kind: "orchestration", unmeasuredBecause: "too expensive to walk" })] }),
    });
    expect(lines[1]).toBe("  orchestration         not measured               — unmirrored");
  });

  it("distinguishes an absent path from an empty one", () => {
    const lines = homeShareLines({
      report: report({ registers: [reg({ homeBytes: 0, homeRecords: 0, kind: "grants", present: false })] }),
    });
    expect(lines[1]).toBe("  grants                absent                     — unmirrored");
  });

  it("prints a mirrored register's own row count against its table", () => {
    const lines = homeShareLines({
      report: report({
        registers: [
          reg({ homeBytes: 2 * 1024 * 1024, homeRecords: 40, kind: "corpus", storeRows: 99, table: "records" }),
        ],
      }),
    });
    expect(lines[1]).toBe("  corpus                2.0 MiB / 40 rec           records 99 rows");
  });

  it("marks a mirrored table the store could not be read for as unread with why, never as zero rows", () => {
    const lines = homeShareLines({
      report: report({
        registers: [
          reg({
            homeBytes: 1024,
            homeRecords: 1,
            kind: "corpus",
            storeUnreadBecause: "the store did not answer: connect ECONNREFUSED",
            table: "records",
          }),
        ],
      }),
    });
    expect(lines[1]).toBe(
      "  corpus                0.0 MiB / 1 rec            records (unread: the store did not answer: connect ECONNREFUSED)",
    );
  });

  it("says the store holds no such table when nothing failed and no count came back", () => {
    const lines = homeShareLines({
      report: report({ registers: [reg({ homeBytes: 1024, homeRecords: 1, kind: "corpus", table: "records" })] }),
    });
    expect(lines[1]).toBe("  corpus                0.0 MiB / 1 rec            records (no such table in the store)");
  });

  it("appends the unclassified tables only when there are some", () => {
    const withTables = homeShareLines({
      report: { ...report({ registers: [] }), unclassifiedTables: ["orphan_rows"] },
    });
    expect(withTables[withTables.length - 1]).toBe("  UNCLASSIFIED TABLES: orphan_rows");
    const without = homeShareLines({ report: report({ registers: [] }) });
    expect(without.filter((line) => line.includes("UNCLASSIFIED"))).toEqual([]);
  });

  it("names the row-classified tables and counts what holds no data class, saying unclassified fails closed", () => {
    const lines = homeShareLines({ report: report({ registers: [] }) });
    expect(lines.filter((line) => line.startsWith("  data classes:"))).toEqual([
      "  data classes: 1 table(s) classify each row (content); 1 table(s), 1 register(s) and 1 home path(s) are " +
        "unclassified\n" +
        "  unclassified fails closed: a consumer treats it as restricted; reasons: slopweaver store share --json",
    ]);
    expect(lines.filter((line) => line.includes("NO DATA-CLASS DECLARATION"))).toEqual([]);
  });

  it("names a table with no data-class declaration at all", () => {
    const base = report({ registers: [] });
    const lines = homeShareLines({
      report: { ...base, dataClassCensus: { ...base.dataClassCensus, undeclaredTables: ["orphan_rows"] } },
    });
    expect(lines.filter((line) => line.includes("NO DATA-CLASS DECLARATION"))).toEqual([
      "  NO DATA-CLASS DECLARATION: orphan_rows",
    ]);
  });
});
