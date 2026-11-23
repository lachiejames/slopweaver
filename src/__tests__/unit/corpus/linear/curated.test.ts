import { describe, expect, it } from "vitest";
import { parseCuratedEdgeRef } from "../../../../corpus/curated/types.js";
import { issueAttachmentRefs, issueEdgeRefs, relationEventRefs } from "../../../../corpus/linear/curated.js";

describe("issueEdgeRefs", () => {
  it("emits sub-issue edges from children", () => {
    expect(issueEdgeRefs({ children: [{ identifier: "TEAM-2" }, { identifier: "TEAM-3" }], nodes: [] })).toEqual([
      "sub-issue|linear:TEAM-2",
      "sub-issue|linear:TEAM-3",
    ]);
  });

  it("maps relation types to typed edges (blocks/duplicate/relation)", () => {
    expect(
      issueEdgeRefs({
        children: [],
        nodes: [
          { relatedIssue: { identifier: "TEAM-9" }, type: "blocks" },
          { relatedIssue: { identifier: "TEAM-8" }, type: "duplicate" },
          { relatedIssue: { identifier: "TEAM-7" }, type: "related" },
        ],
      }),
    ).toEqual(["blocks|linear:TEAM-9", "duplicate|linear:TEAM-8", "relation|linear:TEAM-7"]);
  });

  it("dedupes and SORTS, so a reshuffled connection produces identical bytes", () => {
    const first = issueEdgeRefs({ children: [{ identifier: "TEAM-3" }, { identifier: "TEAM-2" }], nodes: [] });
    const reshuffled = issueEdgeRefs({
      children: [{ identifier: "TEAM-2" }, { identifier: "TEAM-3" }, { identifier: "TEAM-2" }],
      nodes: [],
    });
    // Array CONTENTS participate in the dedup fingerprint, so an unsorted connection would append a false new
    // bronze version on every refresh, forever.
    expect(reshuffled).toEqual(first);
  });

  it("returns empty for an issue with no children or relations", () => {
    expect(issueEdgeRefs({ children: [], nodes: [] })).toEqual([]);
  });
});

describe("relationEventRefs (the timestamped parallel attribute)", () => {
  it("keeps the relation's createdAt — the field whose absence killed the retro census", () => {
    expect(
      relationEventRefs({
        forward: [
          {
            createdAt: "2026-05-04T10:00:00.000Z",
            id: "r1",
            relatedIssue: { identifier: "TEAM-99" },
            type: "duplicate",
          },
        ],
        holder: "TEAM-42",
        inverse: [],
      }),
    ).toEqual(["2026-05-04T10:00:00.000Z duplicate linear:TEAM-42 linear:TEAM-99"]);
  });

  it("produces the BYTE-IDENTICAL line whichever side of the pair it is reached from", () => {
    const fromForwardSide = relationEventRefs({
      forward: [
        { createdAt: "2026-05-04T10:00:00.000Z", id: "r1", relatedIssue: { identifier: "TEAM-99" }, type: "blocks" },
      ],
      holder: "TEAM-42",
      inverse: [],
    });
    const fromInverseSide = relationEventRefs({
      forward: [],
      holder: "TEAM-99",
      inverse: [{ createdAt: "2026-05-04T10:00:00.000Z", id: "r1", issue: { identifier: "TEAM-42" }, type: "blocks" }],
    });
    // The direction is normalised INTO the line, so one logical link is one entry however it was seen — and an
    // inverse relation is never recorded with its direction reversed.
    expect(fromInverseSide).toEqual(fromForwardSide);
  });

  it("collapses a relation repeated within one connection into a single entry", () => {
    const node = {
      createdAt: "2026-05-04T10:00:00.000Z",
      id: "r1",
      relatedIssue: { identifier: "TEAM-99" },
      type: "blocks",
    };
    expect(relationEventRefs({ forward: [node, node], holder: "TEAM-42", inverse: [] }).length).toBe(1);
  });

  it("keeps two OPPOSING relations apart — they are different links, not one seen twice", () => {
    // A blocks B and B blocks A are two relations with two ids. Normalising direction must not merge them.
    expect(
      relationEventRefs({
        forward: [
          { createdAt: "2026-05-04T10:00:00.000Z", id: "r1", relatedIssue: { identifier: "TEAM-99" }, type: "blocks" },
        ],
        holder: "TEAM-42",
        inverse: [
          { createdAt: "2026-05-05T10:00:00.000Z", id: "r2", issue: { identifier: "TEAM-99" }, type: "blocks" },
        ],
      }),
    ).toEqual([
      "2026-05-04T10:00:00.000Z blocks linear:TEAM-42 linear:TEAM-99",
      "2026-05-05T10:00:00.000Z blocks linear:TEAM-99 linear:TEAM-42",
    ]);
  });

  it("cannot be mistaken for a curated-edge ref", () => {
    const line = relationEventRefs({
      forward: [
        { createdAt: "2026-05-04T10:00:00.000Z", id: "r1", relatedIssue: { identifier: "TEAM-9" }, type: "blocks" },
      ],
      holder: "TEAM-1",
      inverse: [],
    })[0]!;
    // The whole reason these live in a PARALLEL attr: `parseCuratedEdgeRef` takes everything after the FIRST
    // `|` as the target, so extending the edge encoding would silently corrupt every existing bronze record.
    expect(parseCuratedEdgeRef({ encoded: line })).toBeUndefined();
  });

  it("records an empty timestamp rather than dropping a relation that has none", () => {
    expect(
      relationEventRefs({
        forward: [{ id: "r1", relatedIssue: { identifier: "TEAM-9" }, type: "related" }],
        holder: "TEAM-1",
        inverse: [],
      }),
    ).toEqual([" relation linear:TEAM-1 linear:TEAM-9"]);
  });

  it("skips a node whose other side has no identifier", () => {
    expect(relationEventRefs({ forward: [{ id: "r1", type: "blocks" }], holder: "TEAM-1", inverse: [] })).toEqual([]);
  });
});

describe("issueAttachmentRefs — ref-only", () => {
  it("keeps title + url lines, never bytes, deduped and sorted", () => {
    expect(
      issueAttachmentRefs({
        nodes: [
          { id: "a1", title: "Design doc", url: "https://figma/x" },
          { id: "a2", url: "https://x" },
          { id: "a3", title: "Design doc", url: "https://figma/x" },
        ],
      }),
    ).toEqual(["Design doc (https://figma/x)", "attachment (https://x)"]);
  });

  it("returns empty when there are no attachments", () => {
    expect(issueAttachmentRefs({ nodes: [] })).toEqual([]);
  });
});
