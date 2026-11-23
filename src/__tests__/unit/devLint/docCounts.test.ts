import { readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { AUTHORITY_DOCS, authorityDocsIn, scanDocCounts } from "../../../devLint/docCounts.js";

describe("scanDocCounts", () => {
  it("catches a multi-digit count with a modifier — the original AGENTS.md claim", () => {
    const hits = scanDocCounts({ content: "`src/__tests__` (201 unit files, zero mocks).", path: "AGENTS.md" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('states a count ("201 unit files")');
    expect(hits[0]!.line).toBe(1);
    expect(hits[0]!.path).toBe("AGENTS.md");
  });

  it("catches a SINGLE-digit count, which the original grammar required two digits to see", () => {
    // `7 bespoke ratchets` sat on the same AGENTS.md line as the 201 claim and was missed twice: once by the
    // old `\d[\d,]*\d` shape, and once by the human who only noticed the first number.
    const hits = scanDocCounts({ content: "`src/devLint` (7 bespoke ratchets)", path: "AGENTS.md" });
    expect(hits.map((h) => h.message)).toEqual([
      'states a count ("7 bespoke ratchets") — give the command that produces it instead, because a number goes stale',
    ]);
  });

  it("catches a SPELLED-OUT count, which no digit-anchored grammar can see", () => {
    const hits = scanDocCounts({ content: "Fifteen static checks including seven bespoke ratchets.", path: "d.md" });
    expect(hits.map((h) => h.message.match(/"([^"]+)"/)![1])).toEqual([
      "Fifteen static checks",
      "seven bespoke ratchets",
    ]);
  });

  it("reports every claim on one line separately, with the right line number", () => {
    const hits = scanDocCounts({ content: "intro\n3 files and 4 checks\n", path: "d.md" });
    expect(hits.map((h) => h.line)).toEqual([2, 2]);
  });

  it("leaves a version pin alone — a number is not automatically a count claim", () => {
    expect(scanDocCounts({ content: "TypeScript is pinned to 5.9, width 120, complexity 12.", path: "d.md" })).toEqual(
      [],
    );
  });

  it("leaves prose with no count alone", () => {
    expect(scanDocCounts({ content: "Run `yarn lint` to see the checks that actually run.\n", path: "d.md" })).toEqual(
      [],
    );
  });
});

describe("authorityDocsIn", () => {
  it("has at least one entry in AUTHORITY_DOCS, so the guards below are not vacuously green", () => {
    expect(AUTHORITY_DOCS.length).toBeGreaterThan(0);
  });

  it("selects only the authority docs that are tracked", () => {
    const { present } = authorityDocsIn({ paths: ["AGENTS.md", "src/index.ts", "docs/constraints.md"] });
    expect(present).toEqual(["AGENTS.md", "docs/constraints.md"]);
  });

  it("REPORTS a listed doc that is no longer tracked rather than skipping it", () => {
    // A rename would otherwise remove a file from the gate in silence — the same shape as a scanner that
    // skips what it cannot read.
    const { missing } = authorityDocsIn({ paths: ["AGENTS.md"] });
    expect(missing).toContain("README.md");
  });

  it("finds nothing missing when every authority doc is tracked", () => {
    expect(authorityDocsIn({ paths: [...AUTHORITY_DOCS] }).missing).toEqual([]);
  });

  it("lists every page of the constraint set, so a page split out of the index stays under the gate", () => {
    const pages = readdirSync("docs/constraints").map((file) => `docs/constraints/${file}`);
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.filter((page) => !AUTHORITY_DOCS.includes(page))).toEqual([]);
  });
});
