/*
 * Everything a headline does not carry sits in its fold: provenance, every evidence line and every cross-reference
 * lane, a long lane counted inline with each of its names in its own nested fold.
 */
import { describe, expect, it } from "vitest";

import { sectionSchema } from "../../../../outbound/briefing/sectionSchema.js";
import type { BriefingBlock } from "../../../../outbound/briefing/types.js";
import { textOfContent } from "../../../../outbound/briefing/vocabulary.js";
import type { RankedFinding } from "../../../../reflect/rank.js";
import { EVIDENCE_LINES } from "../../../../reflect/substrate.js";
import { finding, headlineText, ranked, render } from "./harness.js";

describe("renderSelfImprovementSection — everything else is folded", () => {
  const foldOf = ({ candidate }: { candidate: RankedFinding }): readonly BriefingBlock[] =>
    render({ findings: [candidate] }).notes[0]!.detail!.blocks;
  const provenanceText = ({ candidate }: { candidate: RankedFinding }): string => {
    const block = foldOf({ candidate })[0]!;
    if (block.kind !== "para") throw new Error(`provenance is a ${block.kind}, not a para`);
    return textOfContent({ content: block.content });
  };

  it("the fold holds provenance, the evidence and the cross-reference, and no nested fold when every lane is short", () => {
    const blocks = foldOf({ candidate: ranked() });
    expect(blocks.map((block) => block.kind)).toEqual(["para", "list", "para"]);
  });

  it("provenance carries the locus, the source, both full instants, the class, the score arithmetic and the owner's history", () => {
    const candidate = ranked({
      closedAtIso: "2026-09-19T01:30:00.000Z",
      closedBy: "slopweaver#1180",
      grade: "keep",
    });
    expect(foldOf({ candidate })[0]).toEqual({
      content: [
        {
          kind: "text",
          text:
            "Seen at handover amend by the run-journal reader, 4 time(s) this window (first 2026-09-19T01:00:00.000Z, " +
            "last 2026-09-19T02:00:00.000Z) and on 2 day(s) in all, shown 1 time(s) before, as class probe-filter. Score 6.00 is impact 3 (3 before recurrence) times safety 4 over cost 2. " +
            "Graded keep; closed by slopweaver#1180 at 2026-09-19T01:30:00.000Z.",
        },
      ],
      kind: "para",
    });
  });

  it("a closing reference with no instant still reaches the fold, though the headline reads it as live", () => {
    const candidate = ranked({ closedBy: "slopweaver#1180" });
    expect(provenanceText({ candidate })).toContain("Not graded yet; closed by slopweaver#1180.");
    expect(headlineText({ note: render({ findings: [candidate] }).notes[0]! })).toContain("still happening");
  });

  it("a closing instant with no reference still reaches the fold", () => {
    const candidate = ranked({ closedAtIso: "2026-09-19T01:30:00.000Z" });
    expect(provenanceText({ candidate })).toContain("Not graded yet; closed at 2026-09-19T01:30:00.000Z.");
  });

  it("a score two places cannot represent carries its exact value beside the rounded one", () => {
    const candidate = ranked({ finding: finding({ cost: 3, impact: 1, safety: 4 }), score: 4 / 3 });
    expect(provenanceText({ candidate })).toContain("Score 1.33 (exactly 1.3333333333333333) is impact 1");
  });

  it("an open finding's provenance ends on its grade, naming no closure", () => {
    expect(provenanceText({ candidate: ranked() })).toMatch(/cost 2\. Not graded yet\.$/);
  });

  it("every cross-reference lane is written out, 'nothing recorded' included, a short lane inline", () => {
    const candidate = ranked({
      finding: finding({ coveredBy: ["b-doc", "a-doc"], knownBy: ["probe-memory"] }),
    });
    expect(foldOf({ candidate })[2]).toEqual({
      content: [
        {
          kind: "text",
          text:
            "On the board: b-doc, a-doc. Already refuted in the register: nothing recorded. " +
            "Already in a memory, and it happened anyway: probe-memory.",
        },
      ],
      kind: "para",
    });
  });

  it("every lane carries its own names inline — board, register and memory alike", () => {
    const candidate = ranked({
      finding: finding({ coveredBy: ["a-doc"], knownBy: ["probe-memory"], refutedBy: ["register-entry"] }),
    });
    expect(foldOf({ candidate })[2]).toEqual({
      content: [
        {
          kind: "text",
          text:
            "On the board: a-doc. Already refuted in the register: register-entry. " +
            "Already in a memory, and it happened anyway: probe-memory.",
        },
      ],
      kind: "para",
    });
  });

  it("each long lane gets its OWN nested fold holding every one of its names, in lane order", () => {
    const coveredBy = ["d-doc", "c-doc", "b-doc", "a-doc"];
    const refutedBy = Array.from({ length: 40 }, (_, index) => `r${String(40 - index)}`);
    const knownBy = Array.from({ length: 60 }, (_, index) => `m${String(60 - index)}`);
    const blocks = foldOf({ candidate: ranked({ finding: finding({ coveredBy, knownBy, refutedBy }) }) });
    const nested = ({ names, summary }: { names: readonly string[]; summary: string }): BriefingBlock => ({
      fold: {
        blocks: [{ items: names.map((name) => [{ kind: "code", text: name }]), kind: "list", ordered: false }],
        summary,
      },
      kind: "fold",
    });
    expect(blocks.slice(3)).toEqual([
      nested({ names: coveredBy, summary: "All 4 board docs match" }),
      nested({ names: refutedBy, summary: "All 40 register entries refuted it" }),
      nested({ names: knownBy, summary: "All 60 memories say it" }),
    ]);
    expect(
      sectionSchema.safeParse(render({ findings: [ranked({ finding: finding({ coveredBy, knownBy, refutedBy }) })] }))
        .success,
    ).toBe(true);
  });

  it("a lane too long to list inline is COUNTED, and a nested fold lists every name, none dropped or re-sorted", () => {
    const coveredBy = ["d-doc", "c-doc", "b-doc", "a-doc"];
    const blocks = foldOf({ candidate: ranked({ finding: finding({ coveredBy }) }) });
    expect(blocks[2]).toEqual({
      content: [
        {
          kind: "text",
          text:
            "On the board: 4 board docs match, every one listed below. Already refuted in the register: nothing " +
            "recorded. Already in a memory, and it happened anyway: nothing recorded.",
        },
      ],
      kind: "para",
    });
    expect(blocks[3]).toEqual({
      fold: {
        blocks: [
          {
            items: coveredBy.map((name) => [{ kind: "code", text: name }]),
            kind: "list",
            ordered: false,
          },
        ],
        summary: "All 4 board docs match",
      },
      kind: "fold",
    });
  });

  it("every name of 118 matched docs reaches the section — the measured worst lane", () => {
    const coveredBy = Array.from({ length: 118 }, (_, index) => `doc-${String(index)}`);
    const section = render({ findings: [ranked({ finding: finding({ coveredBy }) })] });
    expect(section.notes[0]!.detail!.blocks[3]).toEqual({
      fold: {
        blocks: [{ items: coveredBy.map((name) => [{ kind: "code", text: name }]), kind: "list", ordered: false }],
        summary: "All 118 board docs match",
      },
      kind: "fold",
    });
    expect(sectionSchema.safeParse(section).success).toBe(true);
  });

  it("every evidence line reaches the fold, in the order given, well past the collectors' own cap", () => {
    const evidence = Array.from(
      { length: EVIDENCE_LINES * 3 },
      (_, index) => `evidence line ${String(EVIDENCE_LINES * 3 - index)}`,
    );
    expect(evidence.length).toBe(12);
    expect(foldOf({ candidate: ranked({ finding: finding({ evidence }) }) })[1]).toEqual({
      items: evidence.map((text) => [{ kind: "text", text }]),
      kind: "list",
      ordered: false,
    });
  });

  it("a finding with no evidence lines says so rather than dropping the list", () => {
    expect(foldOf({ candidate: ranked({ finding: finding({ evidence: [] }) }) })[1]).toEqual({
      items: [[{ kind: "text", text: "no evidence lines were recorded" }]],
      kind: "list",
      ordered: false,
    });
  });

  it("does not mutate the finding's own lists", () => {
    const coveredBy = ["d-doc", "c-doc", "b-doc", "a-doc"];
    const candidate = ranked({ finding: finding({ coveredBy }) });
    render({ findings: [candidate] });
    expect(coveredBy).toEqual(["d-doc", "c-doc", "b-doc", "a-doc"]);
  });
});
