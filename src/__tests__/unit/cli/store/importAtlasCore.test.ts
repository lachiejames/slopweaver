/**
 * `slopweaver store import-atlas`'s arguments and its report lines.
 *
 * Pure: a parsed argv in, a refusal or a settled shape out; a counted report in, lines out. No filesystem,
 * no database, no clock — the split `../../../../cli/commands/store/importAtlasRun.ts` exists to allow.
 */
import { describe, expect, it } from "vitest";

import {
  type ImportAtlasReport,
  importAtlasLines,
  type KindOutcome,
  parseImportAtlasArgs,
} from "../../../../cli/commands/store/importAtlasCore.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

describe("parseImportAtlasArgs", () => {
  it("defaults to every platform, writing, and no force", () => {
    const args = unwrap(parseImportAtlasArgs({ argv: [] }));
    expect(args.platform).toBe(undefined);
    expect(args.home).toBe(undefined);
    expect(args.dryRun).toBe(false);
    expect(args.force).toBe(false);
    expect(args.json).toBe(false);
  });

  it("reads every flag it declares", () => {
    const args = unwrap(
      parseImportAtlasArgs({ argv: ["--platform", "vanta", "--home", "/tmp/h", "--dry-run", "--force", "--json"] }),
    );
    expect(args.platform).toBe("vanta");
    expect(args.home).toBe("/tmp/h");
    expect(args.dryRun).toBe(true);
    expect(args.force).toBe(true);
    expect(args.json).toBe(true);
  });

  it("refuses a --home with nothing after it", () => {
    expect(unwrapErr(parseImportAtlasArgs({ argv: ["--home"] }))).toEqual(["--home needs a directory"]);
  });

  it("refuses a --platform with nothing after it", () => {
    expect(unwrapErr(parseImportAtlasArgs({ argv: ["--platform"] }))[0]).toContain("--platform needs");
  });

  it("names an unexpected argument rather than ignoring it", () => {
    expect(unwrapErr(parseImportAtlasArgs({ argv: ["--everything"] }))).toEqual(["unexpected argument: --everything"]);
  });

  it("consumes a value flag's slot even when the value is missing, so it is reported once", () => {
    expect(unwrapErr(parseImportAtlasArgs({ argv: ["--home"] })).length).toBe(1);
  });
});

/** One kind outcome, with every count zero unless the case overrides it. */
function kind(over: Partial<KindOutcome> = {}): KindOutcome {
  return {
    channels: 0,
    coverage: 0,
    entities: 0,
    entitiesCollapsed: 0,
    file: "controls.jsonl",
    gaps: 0,
    gapsCollapsed: 0,
    kind: "control",
    nulsStripped: 0,
    platform: "vanta",
    refusalCount: 0,
    refusals: [],
    skipped: false,
    writeFailure: undefined,
    ...over,
  };
}

/** One report, with the fixed fields filled and the kinds supplied. */
const BLANK_REPORT: ImportAtlasReport = {
  dryRun: false,
  elapsedMs: 100,
  filesPlanned: 1,
  kinds: [],
  platformsPlanned: 1,
  refusedFiles: [],
};

function report(over: Partial<ImportAtlasReport> = {}): ImportAtlasReport {
  return { ...BLANK_REPORT, ...over };
}

describe("importAtlasLines", () => {
  it("folds a platform's kinds into one line rather than printing 834 of them", () => {
    const lines = importAtlasLines({
      report: report({
        filesPlanned: 2,
        kinds: [kind({ channels: 3, entities: 2 }), kind({ channels: 5, entities: 4, kind: "framework" })],
      }),
    });
    expect(lines[0]).toBe("vanta: 6 entit(ies), 8 channel view(s)");
  });

  it("says how many kinds were unchanged when a re-run skipped them", () => {
    const lines = importAtlasLines({ report: report({ kinds: [kind({ skipped: true })] }) });
    expect(lines[0]).toContain("1 kind(s) unchanged");
  });

  it("prints the on-disk duplicate collapse, because nothing else counts it", () => {
    const lines = importAtlasLines({
      report: report({ kinds: [kind({ entities: 5, entitiesCollapsed: 1, gapsCollapsed: 28949 })] }),
    });
    expect(lines.join("\n")).toContain("on-disk duplicates collapsed: 28949 gap(s), 1 entit(ies)");
  });

  it("says nothing about duplicates when there were none", () => {
    const lines = importAtlasLines({ report: report({ kinds: [kind({ entities: 5 })] }) });
    expect(lines.join("\n")).not.toContain("duplicates collapsed");
  });

  it("names the U+0000 strip Postgres forces, so the changed bytes are not silent", () => {
    const lines = importAtlasLines({ report: report({ kinds: [kind({ nulsStripped: 423 })] }) });
    expect(lines.join("\n")).toContain("423 U+0000 character(s) stripped");
  });

  it("names a kind whose slice failed to write, which an exit code alone would not explain", () => {
    const lines = importAtlasLines({
      report: report({ kinds: [kind({ kind: "policy-document", writeFailure: "unsupported Unicode escape" })] }),
    });
    expect(lines.join("\n")).toContain("vanta/policy-document was NOT written: unsupported Unicode escape");
  });

  it("leads with the dry-run banner so nobody reads a plan as a load", () => {
    const lines = importAtlasLines({ report: report({ dryRun: true }) });
    expect(lines[0]).toContain("DRY RUN");
  });

  it("caps the files it names and says how many it did not", () => {
    const refusedFiles = Array.from({ length: 13 }, (_unused, index) => ({
      error: {
        code: "UNUSABLE_ENVELOPE" as const,
        field: "it names no kind",
        message: `line 1 of file ${String(index)} is unusable`,
        path: `/atlas/p/f${String(index)}.jsonl`,
      },
      file: `/atlas/p/f${String(index)}.jsonl`,
      platform: "p",
    }));
    const lines = importAtlasLines({ refusalCap: 10, report: report({ refusedFiles }) });
    expect(lines.join("\n")).toContain("… and 3 more unreadable file(s)");
  });

  it("reports the totals against what was planned, so a partial run is visible", () => {
    const lines = importAtlasLines({
      report: report({ filesPlanned: 834, kinds: [kind({ channels: 2, entities: 1 })], platformsPlanned: 35 }),
    });
    expect(lines.join("\n")).toContain("35 platform(s), 834 kind file(s) planned");
    expect(lines.join("\n")).toContain("wrote 1 entit(ies), 2 channel view(s)");
  });
});
