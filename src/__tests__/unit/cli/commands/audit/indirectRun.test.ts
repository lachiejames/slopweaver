/**
 * `audit references --indirect`'s report lines (pure) and its input read over a temp home. Every term is synthetic.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  indirectReportLines,
  indirectReportRows,
  readIndirectInputs,
} from "../../../../../cli/commands/audit/indirectRun.js";
import type { IndirectClass } from "../../../../../hygiene/indirectScan.js";
import type { IndirectTreeScan } from "../../../../../hygiene/indirectTree.js";
import type { ExportedTreeProof } from "../../../../../hygiene/referenceExport.js";
import { unwrapErr } from "../../../../../lib/result.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const PROOF: ExportedTreeProof<IndirectTreeScan> = {
  committedIso: "2026-11-04T09:00:00Z",
  ref: "main",
  result: { binaryFiles: 1, filesScanned: 10, harvestSkipped: 0, places: [] },
  sha: "abcdef0123456789abcdef0123456789abcdef01",
  zipBytes: 100,
  zipPath: "/z/slopweaver-abcdef012345.zip",
};

/** A class with no term detail, for the counts the report prints. */
const counted = ({
  className,
  disposition,
  hits,
}: {
  className: string;
  disposition: IndirectClass["disposition"];
  hits: number;
}): IndirectClass => ({ className, disposition, files: 1, hits, terms: [] });

describe("indirectReportLines", () => {
  it("prints the commit, the remaining obvious places and one count line per class, never a term", () => {
    const lines = indirectReportLines({
      classes: [
        counted({ className: "map:issue-key", disposition: "remove", hits: 3 }),
        counted({ className: "map:locale", disposition: "aggregate", hits: 7 }),
      ],
      proof: PROOF,
    });
    expect(lines[0]).toBe(
      "audit references --indirect: abcdef012345 exported as a zip with no .git — 10 files scanned for indirect candidates",
    );
    expect(lines[1]).toBe("  3 obvious (remove) candidate place(s) remain");
    expect(lines[2]).toBe(`    ${"map:issue-key".padEnd(28)} remove         3 places     1 files    0 terms`);
    expect(lines.length).toBe(4);
  });

  it("says when no obvious candidate remains", () => {
    const lines = indirectReportLines({
      classes: [counted({ className: "map:person", disposition: "review", hits: 2 })],
      proof: PROOF,
    });
    expect(lines[1]).toBe("  0 obvious (remove) candidates remain");
  });
});

describe("indirectReportRows", () => {
  it("writes one row per term, identity first, each place cut to where it is and what it reads", () => {
    const place = {
      className: "map:issue-key",
      disposition: "remove" as const,
      excerpt: "see ABC-1",
      line: 4,
      path: "a.ts",
      replacement: "XYZ-1",
      term: "ABC-1",
    };
    const rows = indirectReportRows({
      classes: [
        {
          className: "map:issue-key",
          disposition: "remove",
          files: 1,
          hits: 1,
          terms: [{ files: 1, hits: 1, places: [place], term: "ABC-1" }],
        },
      ],
    });
    expect(rows).toEqual([
      {
        className: "map:issue-key",
        disposition: "remove",
        files: 1,
        hits: 1,
        places: [{ excerpt: "see ABC-1", line: 4, path: "a.ts" }],
        replacement: "XYZ-1",
        term: "ABC-1",
      },
    ]);
    expect(Object.keys(rows[0]!).slice(0, 3)).toEqual(["className", "disposition", "term"]);
  });
});

describe("readIndirectInputs", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "ind-home-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a home with no candidate map, naming the path", () => {
    const mapPath = stateHomePaths({ home }).indirectReferenceMap;
    expect(unwrapErr(readIndirectInputs({ home }))[0]).toBe(
      `${mapPath} is absent, so an indirect scan would read clean for a reason that is not the tree`,
    );
  });

  it("refuses a malformed map with the parser's message", () => {
    const mapPath = stateHomePaths({ home }).indirectReferenceMap;
    mkdirSync(join(mapPath, ".."), { recursive: true });
    writeFileSync(mapPath, "class\tflags\tdisposition\tpattern\treplacement\n");
    expect(unwrapErr(readIndirectInputs({ home }))[0]).toBe(
      "the indirect candidate map holds no row, so a clean scan over it would prove nothing",
    );
  });
});
