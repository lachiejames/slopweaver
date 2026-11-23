/**
 * The `metadata.slopweaver` field parsers, called directly: each validator reports what its reader withholds,
 * so a malformed entry is both a finding and absent from what the reader returns.
 */
import { describe, expect, it } from "vitest";

import {
  amendsCanonFindings,
  correctionSubjectFindings,
  overlapsFindings,
  readAmendsCanon,
  readCorrectionSubject,
  readOverlaps,
} from "../../../memory/slopweaverMetadata.js";

describe("overlaps", () => {
  const value = { "kept-memory": "compatible", "AGENTS.md § Rules": "supersedes", typo: "fine" };

  it("reads the two answers and withholds anything else", () => {
    expect(readOverlaps({ value })).toEqual([
      { answer: "compatible", target: "kept-memory" },
      { answer: "supersedes", target: "AGENTS.md § Rules" },
    ]);
  });

  it("reports exactly the entry it withheld", () => {
    expect(overlapsFindings({ file: "leaf.md", value }).map((finding) => finding.message)).toEqual([
      "frontmatter `metadata.slopweaver.overlaps` answers `typo` with something other than supersedes or compatible",
    ]);
  });

  it("reports a list in place of a mapping, and reads nothing from it", () => {
    expect(overlapsFindings({ file: "leaf.md", value: ["kept-memory"] })).toEqual([
      {
        check: "schema",
        file: "leaf.md",
        line: null,
        message: "frontmatter `metadata.slopweaver.overlaps` must be a mapping",
      },
    ]);
    expect(readOverlaps({ value: ["kept-memory"] })).toEqual([]);
  });

  it("has nothing to say about an absent field", () => {
    expect(overlapsFindings({ file: "leaf.md", value: undefined })).toEqual([]);
  });
});

describe("amendsCanon", () => {
  it("reads a declaration naming its target and row, with the row not yet asked about", () => {
    expect(readAmendsCanon({ value: { row: "rule-10-lands", target: "AGENTS.md" } })).toEqual({
      row: "rule-10-lands",
      rowState: { kind: "unresolved" },
      target: "AGENTS.md",
    });
  });

  it("reads a declaration naming no row as a null row, leaving that defect to its own check", () => {
    expect(amendsCanonFindings({ file: "a.md", value: { target: "AGENTS.md" } })).toEqual([]);
    expect(readAmendsCanon({ value: { target: "AGENTS.md" } })).toEqual({
      row: null,
      rowState: { kind: "unresolved" },
      target: "AGENTS.md",
    });
  });

  it("flags and refuses to read a blank row", () => {
    expect(amendsCanonFindings({ file: "a.md", value: { row: " ", target: "AGENTS.md" } })).toEqual([
      {
        check: "schema",
        file: "a.md",
        line: null,
        message: "frontmatter `metadata.slopweaver.amendsCanon.row` must be a board slug when present",
      },
    ]);
    expect(readAmendsCanon({ value: { row: " ", target: "AGENTS.md" } })).toBeNull();
  });

  it("finds nothing when the key is absent", () => {
    expect(amendsCanonFindings({ file: "a.md", value: undefined })).toEqual([]);
  });
});

describe("correction subject", () => {
  it("reads a complete subject, trimmed, with its optional url", () => {
    expect(
      readCorrectionSubject({
        value: { container: " C1 ", source: "slack", sourceId: "123.4", url: "https://x.test/p" },
      }),
    ).toEqual({ container: "C1", source: "slack", sourceId: "123.4", url: "https://x.test/p" });
  });

  it("withholds a half-formed subject and names the missing field", () => {
    const value = { container: "C1", source: "slack" };

    expect(readCorrectionSubject({ value })).toBe(null);
    expect(correctionSubjectFindings({ file: "leaf.md", value }).map((finding) => finding.message)).toEqual([
      "frontmatter `metadata.slopweaver.correctionSubject.sourceId` must be a non-empty string",
    ]);
  });
});
