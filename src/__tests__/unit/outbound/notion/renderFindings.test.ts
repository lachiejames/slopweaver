import { describe, expect, it } from "vitest";

import {
  cellLines,
  DEFAULT_CELL_LINE_BUDGET,
  type ObservedCell,
  type ObservedMermaid,
  type ObservedProse,
  type RenderObservation,
  renderFindings,
} from "../../../../outbound/notion/renderFindings.js";

const cell = (over: Partial<ObservedCell> = {}): ObservedCell => ({
  anchorHrefs: [],
  anchorTexts: [],
  column: 1,
  heightPx: 20,
  lineHeightPx: 20,
  row: 1,
  table: 1,
  text: "",
  ...over,
});

const mermaid = (over: Partial<ObservedMermaid> = {}): ObservedMermaid => ({
  codeBlockIndex: 0,
  index: 1,
  mode: "preview",
  ...over,
});

const prose = (over: Partial<ObservedProse> = {}): ObservedProse => ({
  anchorHrefs: [],
  anchorTexts: [],
  index: 1,
  text: "",
  ...over,
});

const observation = (over: Partial<RenderObservation> = {}): RenderObservation => ({
  cells: [],
  mermaid: [],
  prose: [],
  ...over,
});

describe("cellLines", () => {
  it("divides the rendered height by the line height", () => {
    expect(cellLines({ cell: cell({ heightPx: 180, lineHeightPx: 20 }) })).toBe(9);
  });

  it("reports one line when the browser could not compute a line height", () => {
    expect(cellLines({ cell: cell({ heightPx: 9999, lineHeightPx: 0 }) })).toBe(1);
  });

  it("never reports fewer than one line", () => {
    expect(cellLines({ cell: cell({ heightPx: 4, lineHeightPx: 20 }) })).toBe(1);
  });
});

describe("renderFindings link checks", () => {
  it("finds a cell showing its markdown source as text", () => {
    const found = renderFindings({
      observation: observation({
        cells: [cell({ column: 3, row: 2, text: "[DDDD-839](https://linear.app/acme/issue/DDDD-839)" })],
      }),
    });
    expect(found.length).toBe(1);
    expect(found[0]!.kind).toBe("literal-markdown-link");
    expect(found[0]!.message).toContain("table 1, row 2, column 3");
  });

  it("passes a cell that rendered a real link", () => {
    const found = renderFindings({
      observation: observation({
        cells: [
          cell({
            anchorHrefs: ["https://linear.app/acme/issue/DDDD-839"],
            anchorTexts: ["DDDD-839"],
            text: "DDDD-839",
          }),
        ],
      }),
    });
    expect(found.length).toBe(0);
  });

  it("finds an anchor whose label is a clipped URL", () => {
    const found = renderFindings({
      observation: observation({
        cells: [
          cell({
            anchorHrefs: ["https://linear.app/acme/issue/DDDD-839"],
            anchorTexts: ["https://linear.app/acme/iss…"],
            text: "https://linear.app/acme/iss…",
          }),
        ],
      }),
    });
    expect(found.map((finding) => finding.kind)).toContain("truncated-auto-link");
  });

  it("finds a normal-looking link whose target carries markdown punctuation", () => {
    const found = renderFindings({
      observation: observation({
        cells: [
          cell({
            anchorHrefs: ["https://linear.app/acme/issue/[DDDD-839](https://linear.app/x)"],
            anchorTexts: ["the incident thread"],
            text: "the incident thread",
          }),
        ],
      }),
    });
    expect(found.length).toBe(1);
    expect(found[0]!.kind).toBe("corrupt-link-target");
  });

  it("finds a URL that rendered as plain text with no anchor at all", () => {
    const found = renderFindings({
      observation: observation({ cells: [cell({ text: "https://linear.app/acme/issue/DDDD-839" })] }),
    });
    expect(found.length).toBe(1);
    expect(found[0]!.kind).toBe("linkless-url-cell");
  });
});

describe("renderFindings height checks", () => {
  it("reports one finding per over-tall ROW, not one per cell", () => {
    const tall = { heightPx: 180, lineHeightPx: 20, row: 4 };
    const found = renderFindings({
      observation: observation({
        cells: [
          cell({ ...tall, column: 1, text: "short" }),
          cell({ ...tall, column: 2, text: "the longest text in this row by a wide margin" }),
          cell({ ...tall, column: 3, text: "" }),
        ],
      }),
    });
    expect(found.length).toBe(1);
    expect(found[0]!.kind).toBe("cell-over-budget");
    expect(found[0]!.message).toContain("row 4 renders 9 lines tall");
    expect(found[0]!.message).toContain("column 2");
  });

  it("passes a row exactly at the budget", () => {
    const found = renderFindings({
      observation: observation({
        cells: [cell({ heightPx: 20 * DEFAULT_CELL_LINE_BUDGET, lineHeightPx: 20 })],
      }),
    });
    expect(found.length).toBe(0);
  });

  it("honours a raised budget", () => {
    const cells = [cell({ heightPx: 180, lineHeightPx: 20 })];
    expect(renderFindings({ cellLineBudget: 12, observation: observation({ cells }) }).length).toBe(0);
    expect(renderFindings({ cellLineBudget: 8, observation: observation({ cells }) }).length).toBe(1);
  });
});

describe("renderFindings mermaid checks", () => {
  it("passes a block showing its diagram", () => {
    expect(renderFindings({ observation: observation({ mermaid: [mermaid({ mode: "preview" })] }) }).length).toBe(0);
  });

  it("reports a block split between source and diagram", () => {
    const found = renderFindings({ observation: observation({ mermaid: [mermaid({ index: 3, mode: "split" })] }) });
    expect(found.length).toBe(1);
    expect(found[0]!.message).toContain("mermaid block 3 is split");
  });

  it("reports a block showing only its source", () => {
    const found = renderFindings({ observation: observation({ mermaid: [mermaid({ mode: "code" })] }) });
    expect(found[0]!.message).toContain("showing its source instead of the diagram");
  });

  it("reports a block whose state could not be read, rather than passing it", () => {
    const found = renderFindings({ observation: observation({ mermaid: [mermaid({ mode: "unknown" })] }) });
    expect(found.length).toBe(1);
    expect(found[0]!.message).toContain("could not read");
  });
});

describe("renderFindings prose checks", () => {
  it("finds a paragraph showing its markdown source as text", () => {
    const found = renderFindings({
      observation: observation({
        prose: [prose({ index: 4, text: "shipped in [GGGG-690](https://linear.app/acme/issue/GGGG-690) last week" })],
      }),
    });
    expect(found.length).toBe(1);
    expect(found[0]!.kind).toBe("literal-markdown-link-in-prose");
    expect(found[0]!.message).toContain("text block 4");
  });

  it("finds a paragraph link whose target is malformed", () => {
    const found = renderFindings({
      observation: observation({
        prose: [
          prose({
            anchorHrefs: ["https://linear.app/x/[GGGG-690](https://linear.app/y)"],
            anchorTexts: ["the ticket"],
            text: "shipped in the ticket last week",
          }),
        ],
      }),
    });
    expect(found.length).toBe(1);
    expect(found[0]!.kind).toBe("corrupt-link-target-in-prose");
  });

  it("does not apply the table line budget to a paragraph", () => {
    const found = renderFindings({
      observation: observation({ prose: [prose({ text: "a very long paragraph ".repeat(60) })] }),
    });
    expect(found.length).toBe(0);
  });

  it("passes a paragraph carrying a working link", () => {
    const found = renderFindings({
      observation: observation({
        prose: [
          prose({
            anchorHrefs: ["https://linear.app/acme/issue/GGGG-690"],
            anchorTexts: ["GGGG-690"],
            text: "shipped in GGGG-690 last week",
          }),
        ],
      }),
    });
    expect(found.length).toBe(0);
  });

  it("judges an observation that carries no prose at all", () => {
    expect(renderFindings({ observation: { cells: [], mermaid: [] } }).length).toBe(0);
  });
});

describe("renderFindings on a clean page", () => {
  it("finds nothing", () => {
    expect(
      renderFindings({
        observation: observation({
          cells: [cell({ anchorHrefs: ["https://example.com/a"], anchorTexts: ["a link"], text: "a link" })],
          mermaid: [mermaid()],
        }),
      }).length,
    ).toBe(0);
  });
});
