/* The dead-chip refusal: every citation run in a card's detail and index must name a declared citation. */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { checkCitationRefs } from "../../../../outbound/artifact/citationRefs.js";
import type { CitationWidth, DetailBlock, InlineRun } from "../../../../outbound/artifact/types.js";

const CITATIONS: readonly CitationWidth[] = [{ id: "c1", label: "[1]" }];

/** A run sequence of one text run followed by a chip naming `citationId`. */
function chipped({ citationId }: { citationId: string }): InlineRun[] {
  return [
    { text: "the pool exhausted ", type: "text" },
    { citationId, type: "citation" },
  ];
}

/** Every issue the check raises, as `path: message`, read off a real Zod refinement. */
function issuesOf({
  detail,
  index,
}: {
  detail: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
}): string[] {
  const parsed = z
    .unknown()
    .superRefine((_value, ctx) => {
      checkCitationRefs({ citations: CITATIONS, ctx, detail, index });
    })
    .safeParse(null);
  if (parsed.success) {
    return [];
  }
  return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("checkCitationRefs", () => {
  it("passes chips that name a declared citation in both the detail and the index", () => {
    const detail: DetailBlock[] = [{ runs: chipped({ citationId: "c1" }), type: "paragraph" }];
    expect(issuesOf({ detail, index: [chipped({ citationId: "c1" })] })).toEqual([]);
  });

  it("refuses an unknown chip in a table cell at the detail block's path", () => {
    const detail: DetailBlock[] = [
      { runs: chipped({ citationId: "c1" }), type: "paragraph" },
      { columns: ["Pool"], rows: [[chipped({ citationId: "c9" })]], type: "table" },
    ];
    expect(issuesOf({ detail, index: [] })).toEqual(['detail.1: citation chip references unknown citation "c9"']);
  });

  it("refuses an unknown chip in an index line at that line's path", () => {
    const index = [chipped({ citationId: "c1" }), chipped({ citationId: "missing" })];
    expect(issuesOf({ detail: [], index })).toEqual(['index.1: citation chip references unknown citation "missing"']);
  });
});
