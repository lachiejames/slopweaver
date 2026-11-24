import { describe, expect, it } from "vitest";

import { runStoreRow, runStoreRows, runStoreTables } from "../../../../../cli/commands/store/browseRun.js";
import {
  STORE_ROW_USAGE,
  STORE_ROWS_FLAG_SPEC,
  STORE_ROWS_USAGE,
  STORE_TABLES_USAGE,
} from "../../../../../cli/commands/store/browseUsage.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { rowMeta, rowsMeta, tablesMeta } from "../../../../../cli/manifests/storeBrowseMeta.js";

/** The argv a spoken `store <verb>` arrives as. */
const argvOf = ({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] => [
  "node",
  "slopweaver",
  "store",
  verb,
  ...rest,
];

describe("the store browsing verbs, before any store is opened", () => {
  it("answer --help with success on all three verbs", async () => {
    const exits = await Promise.all([
      runStoreTables(argvOf({ rest: ["--help"], verb: "tables" })),
      runStoreRows(argvOf({ rest: ["-h"], verb: "rows" })),
      runStoreRow(argvOf({ rest: ["--help"], verb: "row" })),
    ]);
    expect(exits).toEqual([EXIT_OK, EXIT_OK, EXIT_OK]);
  });

  it("refuse a rows read naming no table, and a row read naming no locator, as usage, plain and as JSON", async () => {
    const exits = await Promise.all([
      runStoreRows(argvOf({ rest: [], verb: "rows" })),
      runStoreRows(argvOf({ rest: ["--json"], verb: "rows" })),
      runStoreRow(argvOf({ rest: [], verb: "row" })),
      runStoreRow(argvOf({ rest: ["--locator-hex", "7B7D", "--json"], verb: "row" })),
    ]);
    expect(exits).toEqual([EXIT_USAGE, EXIT_USAGE, EXIT_USAGE, EXIT_USAGE]);
  });
});

describe("the browsing manifest entries", () => {
  it("print the usage the verbs themselves print", () => {
    expect([tablesMeta.usage, rowsMeta.usage, rowMeta.usage]).toEqual([
      STORE_TABLES_USAGE,
      STORE_ROWS_USAGE,
      STORE_ROW_USAGE,
    ]);
  });

  it("advertise every flag the rows usage names", () => {
    const named = [...STORE_ROWS_USAGE.matchAll(/--([a-z-]+)/g)].map((match) => match[1]!);
    expect(new Set(named)).toEqual(new Set([...STORE_ROWS_FLAG_SPEC.string, ...STORE_ROWS_FLAG_SPEC.boolean]));
  });
});
