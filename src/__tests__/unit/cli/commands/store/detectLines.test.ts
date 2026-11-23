/**
 * The report `store detect` prints for a planned wave: the discovery lead names what its two absences mean,
 * and a lead bound to a keyword and a source prints both.
 */
import { describe, expect, it } from "vitest";

import { type DetectAssignment, waveLines } from "../../../../../cli/commands/store/detectLines.js";
import type { Lead } from "../../../../../detective/fanout.js";

/** One lead, defaulted to the discovery lead the cases vary from. */
const lead = (over: Partial<Lead> = {}): Lead => ({
  keyword: null,
  rows: 12,
  source: null,
  startShape: null,
  why: "read what the store holds before choosing a keyword",
  ...over,
});

/** The numbered line one assignment prints first. */
const firstAssignmentLine = ({ briefs }: { briefs: readonly DetectAssignment[] }): string =>
  waveLines({
    atlasNote: null,
    briefs,
    datadogAge: null,
    datadogNote: null,
    finding: null,
    hexNote: null,
    nameSkipped: null,
    outNote: null,
    question: "why did staging roll back",
    wave: { deferred: [], detectives: briefs.length, leads: briefs.map((each) => each.lead), tooWide: [] },
  })[2]!;

describe("waveLines' assignment line", () => {
  it("names the discovery lead's missing keyword and source for what they mean", () => {
    const discovery = lead();
    expect(firstAssignmentLine({ briefs: [{ brief: "b1.md", lead: discovery, report: "r1.md" }] })).toBe(
      "  1. (discovery) / (any source) — read what the store holds before choosing a keyword\n     brief: b1.md\n     report: r1.md",
    );
  });

  it("prints a bound lead's own keyword and source", () => {
    const bound = lead({ keyword: "rollback", source: "slack", why: "12 rows at exact" });
    expect(firstAssignmentLine({ briefs: [{ brief: "b2.md", lead: bound, report: "r2.md" }] })).toBe(
      "  1. rollback / slack — 12 rows at exact\n     brief: b2.md\n     report: r2.md",
    );
  });
});
