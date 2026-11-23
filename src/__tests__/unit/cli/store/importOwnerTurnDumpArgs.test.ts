/**
 * `store import-owner-turn-dump`'s arguments and report: `--from` is required, and a refused row says nothing was
 * written rather than reporting counts beside it.
 */
import { describe, expect, it } from "vitest";

import {
  importOwnerTurnDumpLines,
  parseImportOwnerTurnDumpArgs,
} from "../../../../cli/commands/store/importOwnerTurnDumpArgs.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const REPORT = {
  bodies: 750,
  bodiesWritten: 750,
  dryRun: false,
  from: "/k/owner-tables.sql",
  locations: 30_128,
  locationsWritten: 30_128,
  refused: [],
};

describe("parseImportOwnerTurnDumpArgs", () => {
  it("reads every flag", () => {
    expect(
      unwrap(parseImportOwnerTurnDumpArgs({ argv: ["--from", "/k.sql", "--dry-run", "--json", "--home", "/h"] })),
    ).toEqual({ dryRun: true, from: "/k.sql", home: "/h", json: true });
  });

  it("refuses a missing --from, a flag with no value, and an unknown argument", () => {
    expect(unwrapErr(parseImportOwnerTurnDumpArgs({ argv: [] }))).toEqual([
      "--from <owner-tables.sql> is required: the dump to load",
    ]);
    expect(unwrapErr(parseImportOwnerTurnDumpArgs({ argv: ["--from"] }))).toEqual(["--from needs a path"]);
    expect(unwrapErr(parseImportOwnerTurnDumpArgs({ argv: ["--from", "/k", "--force"] }))).toEqual([
      "unexpected argument: --force",
    ]);
  });
});

describe("importOwnerTurnDumpLines", () => {
  it("says what was new on a real load", () => {
    expect(importOwnerTurnDumpLines({ report: { ...REPORT, bodiesWritten: 3, locationsWritten: 0 } })).toEqual([
      "store import-owner-turn-dump: /k/owner-tables.sql carries 750 body(ies) at 30128 location(s)",
      "3 body(ies) and 0 location(s) were new; everything else the store already held",
    ]);
  });

  it("says a dry run checked everything and wrote nothing", () => {
    expect(importOwnerTurnDumpLines({ report: { ...REPORT, dryRun: true } })[1]).toBe(
      "DRY RUN — every row checked; nothing was written and no connection was opened",
    );
  });

  it("spells refusals, capped, and says nothing was written", () => {
    const lines = importOwnerTurnDumpLines({ refusalCap: 1, report: { ...REPORT, refused: ["first", "second"] } });

    expect(lines.slice(1)).toEqual(["2 row(s) refused, so nothing was written:", "  first", "  … and 1 more"]);
  });
});
