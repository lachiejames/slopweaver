import { describe, expect, it } from "vitest";

import type { Citation, DetailBlock, InlineRun } from "../../../../outbound/artifact/types.js";
import {
  citationBudgetCollision,
  citationsCeiling,
  pictureJudgement,
  SHOWN_ITEMS_MIN_REFS,
  UNSHOWN_ITEMS_QUESTION,
  uncitedControlIssues,
} from "../../../../outbound/assistant/citedAndShown.js";
import { CITATIONS_MAX } from "../../../../outbound/assistant/contentLimits.js";
import type { BareRefContext } from "../../../../outbound/linkify/bareRefs.js";

const HRS_52_URL = "https://app.vanta.com/c/acme/controls?controlId=0syn0002";
const DCH_108_URL = "https://app.vanta.com/c/acme/controls?controlId=0syn0001";

const CONTEXT: BareRefContext = {
  complianceControls: [
    { id: "HRS-52", url: HRS_52_URL },
    { id: "DCH-108", url: DCH_108_URL },
    { id: "BCD-69", url: null },
  ],
  repos: [],
};

/** A paragraph of the given runs. */
function paragraph({ runs }: { runs: readonly InlineRun[] }): DetailBlock {
  return { runs, type: "paragraph" };
}

const NO_INDEX: readonly (readonly InlineRun[])[] = [];
const NO_BODY: readonly DetailBlock[] = [];

describe("uncitedControlIssues", () => {
  it("refuses a control named with no citation in the same item, naming the control", () => {
    const issues = uncitedControlIssues({
      body: [paragraph({ runs: [{ text: "HRS-52 is one test away", type: "text" }] })],
      citations: [],
      context: CONTEXT,
      index: NO_INDEX,
    });
    expect(issues.length).toBe(1);
    expect(issues[0]!.path).toEqual(["body", 0]);
    expect(issues[0]!.message).toContain('"HRS-52" is named here with no citation');
  });

  it("accepts a control cited by a citation whose url is that control's own page", () => {
    const cited: Citation = { id: "c1", label: "[1]", url: HRS_52_URL };
    expect(
      uncitedControlIssues({
        body: [
          paragraph({
            runs: [
              { label: "HRS-52", type: "link", url: HRS_52_URL },
              { citationId: "c1", type: "citation" },
            ],
          }),
        ],
        citations: [cited],
        context: CONTEXT,
        index: NO_INDEX,
      }),
    ).toEqual([]);
  });

  it("accepts a control cited by sourceRef even when the citation points elsewhere", () => {
    const cited: Citation = {
      id: "c1",
      label: "[1]",
      sourceRef: { id: "HRS-52", source: "vanta-control" },
      url: "https://app.vanta.com/c/acme/controls",
    };
    expect(
      uncitedControlIssues({
        body: [
          paragraph({
            runs: [
              { text: "HRS-52 needs training", type: "text" },
              { citationId: "c1", type: "citation" },
            ],
          }),
        ],
        citations: [cited],
        context: CONTEXT,
        index: NO_INDEX,
      }),
    ).toEqual([]);
  });

  it("refuses a control whose only citation names a DIFFERENT control", () => {
    const cited: Citation = { id: "c1", label: "[1]", url: DCH_108_URL };
    const issues = uncitedControlIssues({
      body: [
        paragraph({
          runs: [
            { text: "HRS-52 is one test away", type: "text" },
            { citationId: "c1", type: "citation" },
          ],
        }),
      ],
      citations: [cited],
      context: CONTEXT,
      index: NO_INDEX,
    });
    expect(issues.length).toBe(1);
    expect(issues[0]!.message).toContain('"HRS-52"');
  });

  it("grounds a table ROW by row, not by cell — the exact shape the rejected answer got wrong", () => {
    const cited: Citation = { id: "c1", label: "[1]", url: HRS_52_URL };
    const table: DetailBlock = {
      columns: ["control", "blocker"],
      rows: [
        [
          [{ text: "HRS-52", type: "text" }],
          [
            { text: "12 people missing training", type: "text" },
            { citationId: "c1", type: "citation" },
          ],
        ],
        [[{ text: "DCH-108", type: "text" }], [{ text: "8 instances missing labels", type: "text" }]],
      ],
      type: "table",
    };
    const issues = uncitedControlIssues({ body: [table], citations: [cited], context: CONTEXT, index: NO_INDEX });
    expect(issues.length).toBe(1);
    expect(issues[0]!.path).toEqual(["body", 0, "rows", 1]);
    expect(issues[0]!.message).toContain('"DCH-108"');
  });

  it("a citation in ANOTHER block does not ground this one", () => {
    const cited: Citation = { id: "c1", label: "[1]", url: HRS_52_URL };
    const issues = uncitedControlIssues({
      body: [
        paragraph({ runs: [{ citationId: "c1", type: "citation" }] }),
        paragraph({ runs: [{ text: "HRS-52 is one test away", type: "text" }] }),
      ],
      citations: [cited],
      context: CONTEXT,
      index: NO_INDEX,
    });
    expect(issues.length).toBe(1);
    expect(issues[0]!.path).toEqual(["body", 1]);
  });

  it("says nothing about an id the caller's control table does not hold", () => {
    expect(
      uncitedControlIssues({
        body: [paragraph({ runs: [{ text: "ISO-27001 and UTC-5", type: "text" }] })],
        citations: [],
        context: CONTEXT,
        index: NO_INDEX,
      }),
    ).toEqual([]);
  });

  it("checks an index line the same way it checks a body block", () => {
    const issues = uncitedControlIssues({
      body: NO_BODY,
      citations: [],
      context: CONTEXT,
      index: [[{ text: "BCD-69 needs versioning", type: "text" }]],
    });
    expect(issues.length).toBe(1);
    expect(issues[0]!.path).toEqual(["index", 0]);
  });
});

describe("pictureJudgement", () => {
  const THREE_THINGS = [paragraph({ runs: [{ text: "HRS-52, DCH-108 and BCD-69 are close", type: "text" }] })];
  const REMEDY = "`noPictureBecause`";

  it("holds a message naming three references with no picture, once, on the question", () => {
    const judgement = pictureJudgement({
      body: THREE_THINGS,
      context: CONTEXT,
      index: NO_INDEX,
      pictureCount: 0,
      reason: undefined,
      remedy: REMEDY,
    });
    expect(judgement).toEqual({
      kind: "held",
      message:
        "this message names 3 different things (HRS-52, DCH-108, BCD-69) and attaches no picture: which of " +
        "these would a picture show better than text? Attach that one — `slopweaver browser shot` takes it — " +
        "or, if none would show a reader anything the text does not, say why with `noPictureBecause`; the " +
        "reason is recorded on this send's door-ledger row. This is a judgement you make once per message, " +
        "not a count.",
    });
    expect(UNSHOWN_ITEMS_QUESTION).toBe("which of these would a picture show better than text?");
  });

  it("admits the same message once the session says why no picture adds value, carrying the reason", () => {
    expect(
      pictureJudgement({
        body: THREE_THINGS,
        context: CONTEXT,
        index: NO_INDEX,
        pictureCount: 0,
        reason: "all three are API-only controls with no page a browser can reach",
        remedy: REMEDY,
      }),
    ).toEqual({ kind: "answered", reason: "all three are API-only controls with no page a browser can reach" });
  });

  it("is clear when one picture is attached", () => {
    expect(
      pictureJudgement({
        body: THREE_THINGS,
        context: CONTEXT,
        index: NO_INDEX,
        pictureCount: 1,
        reason: undefined,
        remedy: REMEDY,
      }),
    ).toEqual({ kind: "clear" });
  });

  it("is clear one reference below the floor", () => {
    expect(SHOWN_ITEMS_MIN_REFS).toBe(3);
    expect(
      pictureJudgement({
        body: [paragraph({ runs: [{ text: "HRS-52 and DCH-108 are close", type: "text" }] })],
        context: CONTEXT,
        index: NO_INDEX,
        pictureCount: 0,
        reason: undefined,
        remedy: REMEDY,
      }),
    ).toEqual({ kind: "clear" });
  });

  it("refuses a reason on a message that already attaches a picture, so no waiver is recorded for nothing", () => {
    expect(
      pictureJudgement({
        body: THREE_THINGS,
        context: CONTEXT,
        index: NO_INDEX,
        pictureCount: 2,
        reason: "none adds value",
        remedy: REMEDY,
      }),
    ).toEqual({
      kind: "unasked",
      message:
        "`noPictureBecause` answers a question this message was not asked — it already attaches a picture — " +
        "so there is nothing to record. Remove it.",
    });
  });

  it("refuses a reason on a message naming too few things to be asked", () => {
    expect(
      pictureJudgement({
        body: [paragraph({ runs: [{ text: "HRS-52 only", type: "text" }] })],
        context: CONTEXT,
        index: NO_INDEX,
        pictureCount: 0,
        reason: "none adds value",
        remedy: REMEDY,
      }),
    ).toEqual({
      kind: "unasked",
      message:
        "`noPictureBecause` answers a question this message was not asked — it names 1 distinct thing(s), " +
        "under the 3 that ask it — so there is nothing to record. Remove it.",
    });
  });

  it("counts one reference once however often it is repeated", () => {
    expect(
      pictureJudgement({
        body: [
          paragraph({ runs: [{ text: "HRS-52 and HRS-52", type: "text" }] }),
          paragraph({ runs: [{ text: "HRS-52 again, plus DCH-108", type: "text" }] }),
        ],
        context: CONTEXT,
        index: NO_INDEX,
        pictureCount: 0,
        reason: undefined,
        remedy: REMEDY,
      }),
    ).toEqual({ kind: "clear" });
  });

  it("counts references of every kind together, and sees them through link labels", () => {
    const judgement = pictureJudgement({
      body: [
        paragraph({
          runs: [
            { label: "HRS-52", type: "link", url: HRS_52_URL },
            { text: " and ", type: "text" },
            { label: "#42", type: "link", url: "https://github.com/acme/widget/issues/42" },
            { text: " and DCH-108", type: "text" },
          ],
        }),
      ],
      context: { ...CONTEXT, repos: [{ owner: "acme", repo: "widget" }] },
      index: NO_INDEX,
      pictureCount: 0,
      reason: undefined,
      remedy: REMEDY,
    });
    expect(judgement.kind).toBe("held");
    expect(JSON.stringify(judgement)).toContain("names 3 different things (HRS-52, #42, DCH-108)");
  });
});

/** Thirteen controls the atlas holds, one more than `CITATIONS_MAX` — the collision's own population. */
const THIRTEEN = [
  "AAA-1",
  "BBB-2",
  "CCC-3",
  "DDD-4",
  "EEE-5",
  "FFF-6",
  "GGG-7",
  "HHH-8",
  "III-9",
  "JJJ-10",
  "KKK-11",
  "LLL-12",
  "MMM-13",
] as const;

/** A context holding the first `count` of {@link THIRTEEN}, each with its own page. */
function wideContext({ count }: { count: number }): BareRefContext {
  return {
    complianceControls: THIRTEEN.slice(0, count).map((id) => ({
      id,
      url: `https://app.vanta.com/c/acme/controls?controlId=${id}`,
    })),
    repos: [],
  };
}

/** One paragraph per control, each naming it and citing nothing — N controls across N ITEMS. */
function uncitedParagraphs({ count }: { count: number }): readonly DetailBlock[] {
  return THIRTEEN.slice(0, count).map((id) => paragraph({ runs: [{ text: `${id} is one test away`, type: "text" }] }));
}

/**
 * Every control named inside ONE paragraph — N controls across ONE item.
 *
 * This is the shape the collision survives at, and it is the shape the tests below use, because
 * `citationsCeiling` pays per ITEM: spread the same controls over N rows and the budget rises to meet them.
 */
function uncitedDenseParagraph({ count }: { count: number }): readonly DetailBlock[] {
  return [
    paragraph({
      runs: [{ text: `${THIRTEEN.slice(0, count).join(" and ")} are each one test away`, type: "text" }],
    }),
  ];
}

describe("citationBudgetCollision", () => {
  it("says nothing when every named control is already cited", () => {
    expect(
      citationBudgetCollision({
        body: [
          paragraph({
            runs: [
              { text: "HRS-52 ", type: "text" },
              { citationId: "c1", type: "citation" },
            ],
          }),
        ],
        citations: [{ id: "c1", label: "[1]", url: HRS_52_URL }],
        context: CONTEXT,
        index: NO_INDEX,
      }),
    ).toBeUndefined();
  });

  it("says nothing at exactly the floor, which is the count one dense item still fits", () => {
    expect(CITATIONS_MAX).toBe(12);
    expect(
      citationBudgetCollision({
        body: uncitedDenseParagraph({ count: 12 }),
        citations: [],
        context: wideContext({ count: 12 }),
        index: NO_INDEX,
      }),
    ).toBeUndefined();
  });

  it("names the arithmetic and the journalled way through one control past a DENSE item's budget", () => {
    const collision = citationBudgetCollision({
      body: uncitedDenseParagraph({ count: 13 }),
      citations: [],
      context: wideContext({ count: 13 }),
      index: NO_INDEX,
    });
    expect(collision).toContain("citing each of the 13 uncited control(s) above needs 13 citations in total");
    expect(collision).toContain("this answer earns 12");
    expect(collision).toContain("naming these controls in separate ROWS rather than in one item buys a citation");
    expect(collision).toContain("slopweaver hatch open uncited-controls");
  });

  // The whole point of `citationsCeiling`: the SAME thirteen controls that collide inside one paragraph do
  // not collide across thirteen paragraphs, because thirteen items earn thirteen citations. Before the
  // budget was derived this shape refused, and it is exactly the ranked answer the per-item rule exists to
  // produce.
  it("says nothing when the same thirteen controls are spread over thirteen ITEMS", () => {
    expect(
      citationBudgetCollision({
        body: uncitedParagraphs({ count: 13 }),
        citations: [],
        context: wideContext({ count: 13 }),
        index: NO_INDEX,
      }),
    ).toBeUndefined();
  });

  it("counts the citations ALREADY defined, so one non-control source opens the collision at twelve", () => {
    const collision = citationBudgetCollision({
      body: uncitedDenseParagraph({ count: 12 }),
      citations: [{ id: "cIndex", label: "[13]", url: "https://app.vanta.com/c/acme/controls" }],
      context: wideContext({ count: 12 }),
      index: NO_INDEX,
    });
    expect(collision).toContain("citing each of the 12 uncited control(s) above needs 13 citations in total");
  });

  it("counts one control ONCE however many items name it", () => {
    const named = paragraph({ runs: [{ text: "AAA-1 is one test away", type: "text" }] });
    expect(
      citationBudgetCollision({
        body: [named, named, named],
        citations: [],
        context: wideContext({ count: 1 }),
        index: NO_INDEX,
      }),
    ).toBeUndefined();
  });
});
describe("citationsCeiling — the budget the per-item rule implies", () => {
  it("is the flat floor for a one-item answer, so a short answer keeps its twelve", () => {
    expect(
      citationsCeiling({ body: [paragraph({ runs: [{ text: "one claim", type: "text" }] })], index: NO_INDEX }),
    ).toBe(CITATIONS_MAX);
  });

  it("is the floor for an EMPTY form too, rather than zero", () => {
    expect(citationsCeiling({ body: NO_BODY, index: NO_INDEX })).toBe(CITATIONS_MAX);
  });

  it("rises with a table's ROWS, so a sixteen-row ranked answer may ground all sixteen", () => {
    const rows = Array.from({ length: 16 }, (_unused, row) => [
      [{ text: `row ${String(row)}`, type: "text" as const }],
    ]);
    expect(citationsCeiling({ body: [{ columns: ["what"], rows, type: "table" }], index: NO_INDEX })).toBe(16);
  });

  it("counts an index LINE as an item, exactly as the per-item rule does", () => {
    const index = Array.from({ length: 15 }, (_unused, line) => [
      { text: `line ${String(line)}`, type: "text" as const },
    ]);
    expect(citationsCeiling({ body: NO_BODY, index })).toBe(15);
  });

  it("counts a bullet ITEM, not the bullets block", () => {
    const items = Array.from({ length: 14 }, (_unused, item) => [
      { text: `item ${String(item)}`, type: "text" as const },
    ]);
    expect(citationsCeiling({ body: [{ items, type: "list" }], index: NO_INDEX })).toBe(14);
  });
});
