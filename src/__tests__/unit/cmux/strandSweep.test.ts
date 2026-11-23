/**
 * The strand sweep's classification and its printed lines — pure, over readings the real `readComposer`
 * produces.
 *
 * What is pinned is the distinction the whole verb turns on: only a `typed` box is a stranded line, and a
 * `suggestion` Claude Code wrote itself is never one, so `--submit` can never reach it. The denominator is asserted too — a zero that does not say what it is zero OF is the over-claim
 * this repository's counts are written against.
 */
import { describe, expect, it } from "vitest";

import type { ComposerReading } from "../../../cmux/composer.js";
import { classifyStrands, describeStrandReport, describeStrandRow, type StrandRow } from "../../../cmux/strandSweep.js";

/** One row, named so a test reads as a fleet rather than as fixtures. */
function row({ ref, reading, title }: { ref: string; reading: ComposerReading; title?: string }): StrandRow {
  return { reading, title, workspaceId: `id-${ref}`, workspaceRef: ref };
}

const TYPED: ComposerReading = { kind: "typed", text: "Checkable fact, tier 1. #947 is rebased onto e0940f731" };
const SUGGESTION: ComposerReading = { kind: "suggestion", text: "approved, land it" };
const PLACEHOLDER: ComposerReading = { kind: "placeholder", text: 'Try "create a util logging.py that..."' };

describe("classifyStrands", () => {
  it("counts only a TYPED composer as stranded, and keeps every row", () => {
    const report = classifyStrands({
      rows: [
        row({ reading: { kind: "empty" }, ref: "workspace:1" }),
        row({ reading: TYPED, ref: "workspace:80" }),
        row({ reading: SUGGESTION, ref: "workspace:81" }),
        row({ reading: PLACEHOLDER, ref: "workspace:82" }),
        row({ reading: { kind: "unreadable", reason: "a menu has replaced the composer" }, ref: "workspace:83" }),
      ],
    });
    expect(report.examined).toBe(5);
    expect(report.rows).toHaveLength(5);
    expect(report.stranded.map((stranded) => stranded.workspaceRef)).toEqual(["workspace:80"]);
  });

  it("answers an empty fleet with a zero that carries its own denominator", () => {
    const report = classifyStrands({ rows: [] });
    expect(report.examined).toBe(0);
    expect(report.stranded).toEqual([]);
    expect(describeStrandReport({ report })).toBe(
      "cmux strands: 0 of 0 composer(s) are holding an unsubmitted line — nothing to press through",
    );
  });

  it("reproduces the live measurement: 2 of 20 stranded", () => {
    const clean = Array.from({ length: 18 }, (_unused, index) =>
      row({ reading: { kind: "empty" }, ref: `workspace:${String(index)}` }),
    );
    const report = classifyStrands({
      rows: [...clean, row({ reading: TYPED, ref: "workspace:80" }), row({ reading: TYPED, ref: "workspace:36" })],
    });
    expect(report.examined).toBe(20);
    expect(report.stranded).toHaveLength(2);
    expect(describeStrandReport({ report })).toContain("2 of 20 composer(s)");
  });
});

describe("describeStrandRow", () => {
  it("names the title beside the ref when the workspace has one", () => {
    expect(
      describeStrandRow({
        row: row({ reading: TYPED, ref: "workspace:80", title: "Docs site showcase screenshots and GIFs" }),
      }),
    ).toBe(
      "  workspace:80 (Docs site showcase screenshots and GIFs): TYPED, unsubmitted — " +
        "Checkable fact, tier 1. #947 is rebased onto e0940f731",
    );
  });

  it("falls back to the bare ref when there is no title", () => {
    expect(describeStrandRow({ row: row({ reading: TYPED, ref: "workspace:36" }) })).toBe(
      "  workspace:36: TYPED, unsubmitted — Checkable fact, tier 1. #947 is rebased onto e0940f731",
    );
  });

  it("prints an unreadable row rather than dropping it, so the denominator stays honest", () => {
    expect(
      describeStrandRow({
        row: row({ reading: { kind: "unreadable", reason: "a menu has replaced the composer" }, ref: "workspace:7" }),
      }),
    ).toBe("  workspace:7: unreadable");
  });

  it("does not call a suggestion an unsubmitted line", () => {
    expect(describeStrandRow({ row: row({ reading: SUGGESTION, ref: "workspace:81" }) })).toBe(
      "  workspace:81: suggestion",
    );
  });
});

describe("describeStrandReport", () => {
  it("names both rescue routes when something is stranded", () => {
    const report = classifyStrands({ rows: [row({ reading: TYPED, ref: "workspace:80" })] });
    const line = describeStrandReport({ report });
    expect(line).toContain("1 of 1 composer(s)");
    expect(line).toContain("slopweaver cmux submit --workspace <ref>");
    expect(line).toContain("--submit");
  });
});
