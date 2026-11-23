import { describe, expect, it } from "vitest";

import {
  citationMarkerIssuesOfRuns,
  citationMarkerIssuesOfText,
  citationsAfterTruncation,
  citationsInReadingOrder,
  citedIdsInReadingOrder,
  typeCitationMarkersInDetail,
  typeCitationMarkersInRuns,
  uncitedCitationIssues,
} from "../../../../outbound/artifact/citationMarkers.js";
import { updateArtifactSchema } from "../../../../outbound/artifact/schema.js";
import type { Citation, DetailBlock } from "../../../../outbound/artifact/types.js";
import { answerFormSchema } from "../../../../outbound/assistant/answerForm.js";

/** A conversation grounding with every required field, so an answer-arm test varies only its citations. */
const GROUNDING = {
  evidence: {
    consultedEmpty: [],
    couldNotSee: { blindSpots: [], reason: "no live check needed" },
    premiseChecks: [],
    read: [],
  },
  kind: "conversation",
  provenance: { model: "claude-sonnet-5", skillsLoaded: [], verbsLoaded: [] },
  reason: "context and judgement alone were sufficient",
};

const ONE: Citation = { id: "c1", label: "[1]", url: "https://example.com/one" };
const TWO: Citation = { id: "c2", label: "[2]", url: "https://example.com/two" };

/** Every refusal message a card form produced, empty when it parsed. Keeps assertions free of `success`. */
function cardIssues({ raw }: { raw: unknown }): readonly string[] {
  const parsed = updateArtifactSchema.safeParse(raw);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

/** The `citations` a card parsed to — `parse` throws rather than returning a union. */
function cardCitations({ raw }: { raw: unknown }): readonly Citation[] {
  return updateArtifactSchema.parse(raw).citations;
}

/** A one-paragraph card carrying the given prose, plus whatever citations the test declares. */
function card({ text, citations }: { text: string; citations: readonly Citation[] }): unknown {
  return {
    citations,
    detail: [{ runs: [{ text, type: "text" }], type: "paragraph" }],
    kind: "update",
    tldr: "the staging pool exhausted",
  };
}

describe("typeCitationMarkersInRuns", () => {
  it("promotes a resolvable marker to the chip that renders it", () => {
    expect(
      typeCitationMarkersInRuns({
        citations: [ONE],
        runs: [{ text: "the pool never recovered [1].", type: "text" }],
      }),
    ).toEqual([
      { text: "the pool never recovered ", type: "text" },
      { citationId: "c1", type: "citation" },
      { text: ".", type: "text" },
    ]);
  });

  it("returns the identical array when there is nothing to promote", () => {
    const runs = [{ text: "nothing to see here", type: "text" }] as const;
    expect(typeCitationMarkersInRuns({ citations: [ONE], runs })).toBe(runs);
  });

  it("leaves an unresolvable marker as text, for the refusal to find", () => {
    expect(
      typeCitationMarkersInRuns({
        citations: [ONE],
        runs: [{ text: "see [1] and [7]", type: "text" }],
      }),
    ).toEqual([
      { text: "see ", type: "text" },
      { citationId: "c1", type: "citation" },
      { text: " and [7]", type: "text" },
    ]);
  });

  it("does not touch a code span, whose whole purpose is literalness", () => {
    const runs = [{ code: true, text: "rows[1]", type: "text" }] as const;
    expect(typeCitationMarkersInRuns({ citations: [ONE], runs })).toBe(runs);
  });

  it("keeps the styling of the run it split", () => {
    expect(
      typeCitationMarkersInRuns({
        citations: [ONE],
        runs: [{ bold: true, text: "measured [1] today", type: "text" }],
      }),
    ).toEqual([
      { bold: true, text: "measured ", type: "text" },
      { citationId: "c1", type: "citation" },
      { bold: true, text: " today", type: "text" },
    ]);
  });
});

describe("typeCitationMarkersInDetail", () => {
  it("converts inside a bullets sub-block", () => {
    const detail: readonly DetailBlock[] = [
      { items: [[{ text: "the retry path [2]", type: "text" }]], type: "bullets" },
    ];
    expect(typeCitationMarkersInDetail({ citations: [TWO], detail })).toEqual([
      {
        items: [
          [
            { text: "the retry path ", type: "text" },
            { citationId: "c2", type: "citation" },
          ],
        ],
        type: "bullets",
      },
    ]);
  });

  it("converts inside a table cell", () => {
    const detail: readonly DetailBlock[] = [
      { columns: ["what"], rows: [[[{ text: "leak [1]", type: "text" }]]], type: "table" },
    ];
    expect(typeCitationMarkersInDetail({ citations: [ONE], detail })[0]).toEqual({
      columns: ["what"],
      rows: [
        [
          [
            { text: "leak ", type: "text" },
            { citationId: "c1", type: "citation" },
          ],
        ],
      ],
      type: "table",
    });
  });
});

describe("citedIdsInReadingOrder", () => {
  it("reads the index before the detail, each id once at its first appearance", () => {
    expect(
      citedIdsInReadingOrder({
        detail: [{ runs: [{ citationId: "c1", type: "citation" }], type: "paragraph" }],
        index: [[{ citationId: "c2", type: "citation" }], [{ citationId: "c1", type: "citation" }]],
      }),
    ).toEqual(["c2", "c1"]);
  });

  it("is empty when nothing cites anything", () => {
    expect(citedIdsInReadingOrder({ detail: [], index: [] })).toEqual([]);
  });
});

describe("citationsInReadingOrder", () => {
  it("renumbers and sorts by first appearance", () => {
    expect(
      citationsInReadingOrder({
        citations: [ONE, TWO],
        detail: [
          {
            runs: [
              { citationId: "c2", type: "citation" },
              { citationId: "c1", type: "citation" },
            ],
            type: "paragraph",
          },
        ],
        index: [],
      }),
    ).toEqual([
      { id: "c2", label: "[1]", url: "https://example.com/two" },
      { id: "c1", label: "[2]", url: "https://example.com/one" },
    ]);
  });

  it("returns the identical array when the order and labels already agree", () => {
    const citations = [ONE, TWO] as const;
    expect(
      citationsInReadingOrder({
        citations,
        detail: [
          {
            runs: [
              { citationId: "c1", type: "citation" },
              { citationId: "c2", type: "citation" },
            ],
            type: "paragraph",
          },
        ],
        index: [],
      }),
    ).toBe(citations);
  });

  it("numbers an uncited citation last, after every cited one", () => {
    expect(
      citationsInReadingOrder({
        citations: [ONE, TWO],
        detail: [{ runs: [{ citationId: "c2", type: "citation" }], type: "paragraph" }],
        index: [],
      }),
    ).toEqual([
      { id: "c2", label: "[1]", url: "https://example.com/two" },
      { id: "c1", label: "[2]", url: "https://example.com/one" },
    ]);
  });
});

describe("citationMarkerIssuesOfRuns", () => {
  it("refuses a marker naming no declared citation", () => {
    const issues = citationMarkerIssuesOfRuns({
      citations: [ONE],
      path: ["detail", 0],
      runs: [{ text: "and elsewhere [7]", type: "text" }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('"[7]" is a citation marker naming no declared citation');
    expect(issues[0]!.path).toEqual(["detail", 0]);
  });

  it("reports nothing on a citation-free form, where a bracketed number is ordinary prose", () => {
    expect(
      citationMarkerIssuesOfRuns({
        citations: [],
        path: ["detail", 0],
        runs: [{ text: "it threw at rows[0]", type: "text" }],
      }),
    ).toEqual([]);
  });
});

describe("citationMarkerIssuesOfText", () => {
  it("refuses a marker in a plain-string field, which holds no runs", () => {
    const issues = citationMarkerIssuesOfText({ citations: [ONE], path: ["tldr"], text: "the pool exhausted [1]" });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("sits in a plain-string field");
  });

  it("reports nothing when the form declares no citations", () => {
    expect(citationMarkerIssuesOfText({ citations: [], path: ["tldr"], text: "rows[0] threw" })).toEqual([]);
  });
});

describe("uncitedCitationIssues", () => {
  it("refuses a citation nothing cites, at its own array position", () => {
    const issues = uncitedCitationIssues({
      citations: [ONE, TWO],
      detail: [{ runs: [{ citationId: "c1", type: "citation" }], type: "paragraph" }],
      index: [],
      path: ["citations"],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toEqual(["citations", 1]);
    expect(issues[0]!.message).toContain("declared and cited by NOTHING");
  });

  it("passes a citation reached only from the index", () => {
    expect(
      uncitedCitationIssues({
        citations: [ONE],
        detail: [],
        index: [[{ citationId: "c1", type: "citation" }]],
        path: ["citations"],
      }),
    ).toEqual([]);
  });
});

describe("the update card form, end to end", () => {
  it("REFUSES the measured defect: citations declared, markers written as bare text, nothing cited", () => {
    expect(
      cardIssues({
        raw: {
          citations: [ONE, TWO],
          detail: [{ runs: [{ text: "the retry path leaked and never recovered.", type: "text" }], type: "paragraph" }],
          kind: "update",
          tldr: "the staging pool exhausted",
        },
      }),
    ).toEqual([
      'citation "c1" ([1]) is declared and cited by NOTHING, so it renders nowhere — a card can silence the ' +
        "`no-citations` advisory while showing the reader no way to verify anything. Put its marker in the " +
        "sentence it backs, or remove it.",
      'citation "c2" ([2]) is declared and cited by NOTHING, so it renders nowhere — a card can silence the ' +
        "`no-citations` advisory while showing the reader no way to verify anything. Put its marker in the " +
        "sentence it backs, or remove it.",
    ]);
  });

  it("promotes bare markers to chips and numbers them in reading order", () => {
    const raw = card({
      citations: [ONE, TWO],
      text: "the retry path [2] leaked, and the pool never recovered [1].",
    });
    expect(updateArtifactSchema.parse(raw).detail[0]).toEqual({
      runs: [
        { text: "the retry path ", type: "text" },
        { citationId: "c2", type: "citation" },
        { text: " leaked, and the pool never recovered ", type: "text" },
        { citationId: "c1", type: "citation" },
        { text: ".", type: "text" },
      ],
      type: "paragraph",
    });
    expect(cardCitations({ raw })).toEqual([
      { id: "c2", label: "[1]", url: "https://example.com/two" },
      { id: "c1", label: "[2]", url: "https://example.com/one" },
    ]);
  });

  it("REFUSES a marker in the tldr, which can never carry a chip", () => {
    expect(
      cardIssues({
        raw: {
          citations: [ONE],
          detail: [{ runs: [{ citationId: "c1", type: "citation" }], type: "paragraph" }],
          kind: "update",
          tldr: "the staging pool exhausted [1]",
        },
      })[0],
    ).toContain("sits in a plain-string field");
  });

  it("REFUSES a marker naming no declared citation", () => {
    expect(cardIssues({ raw: card({ citations: [ONE], text: "see [1] and [7]" }) })[0]).toContain(
      "naming no declared citation",
    );
  });

  it("leaves a citation-free card's bracketed numbers alone", () => {
    expect(cardIssues({ raw: card({ citations: [], text: "it threw at rows[0] and items[12]" }) })).toEqual([]);
  });
});

describe("the answer form, end to end", () => {
  it("promotes a bare marker in the body to a chip", () => {
    const parsed = answerFormSchema.parse({
      body: [{ runs: [{ text: "the pool never recovered [1].", type: "text" }], type: "paragraph" }],
      citations: [ONE],
      grounding: GROUNDING,
      kind: "answer",
      lead: "the staging pool exhausted",
    });
    expect(parsed).toMatchObject({
      body: [
        {
          runs: [
            { text: "the pool never recovered ", type: "text" },
            { citationId: "c1", type: "citation" },
            { text: ".", type: "text" },
          ],
          type: "paragraph",
        },
      ],
    });
  });

  it("REFUSES a marker in the lead, which can never carry a chip", () => {
    const parsed = answerFormSchema.safeParse({
      body: [{ runs: [{ citationId: "c1", type: "citation" }], type: "paragraph" }],
      citations: [ONE],
      grounding: GROUNDING,
      kind: "answer",
      lead: "the staging pool exhausted [1]",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.message)[0]).toContain("sits in a plain-string field");
  });
});

describe("citationsAfterTruncation", () => {
  it("drops a citation truncation orphaned, and renumbers what survived", () => {
    expect(
      citationsAfterTruncation({
        citations: [ONE, TWO],
        citedBefore: ["c1", "c2"],
        detail: [{ runs: [{ citationId: "c2", type: "citation" }], type: "paragraph" }],
        index: [],
      }),
    ).toEqual([{ id: "c2", label: "[1]", url: "https://example.com/two" }]);
  });

  it("keeps a citation that was ALREADY uncited, so the real authoring defect still refuses", () => {
    expect(
      citationsAfterTruncation({
        citations: [ONE, TWO],
        citedBefore: ["c2"],
        detail: [{ runs: [{ citationId: "c2", type: "citation" }], type: "paragraph" }],
        index: [],
      }),
    ).toEqual([
      { id: "c2", label: "[1]", url: "https://example.com/two" },
      { id: "c1", label: "[2]", url: "https://example.com/one" },
    ]);
  });
});
