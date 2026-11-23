import { describe, expect, it } from "vitest";

import { renderBlockText, specialisedBlockTypes } from "../../../../corpus/notion/blockText.js";
import { renderRichText } from "../../../../corpus/notion/fetch.js";

/** The production renderer, so these assert the real pairing rather than a test-local stand-in. */
const render = renderRichText;

/** A rich_text array carrying one plain span. */
const span = ({ text }: { text: string }): readonly unknown[] => [{ plain_text: text }];

describe("renderBlockText — table rows (the measured headline: 429 of 429 rendered empty)", () => {
  it("renders every cell of a table row, pipe-delimited so column boundaries survive", () => {
    expect(
      renderBlockText({
        block: {
          table_row: { cells: [span({ text: "AC-2" }), span({ text: "Platform" }), span({ text: "Implemented" })] },
          type: "table_row",
        },
        render,
      }),
    ).toBe("AC-2 | Platform | Implemented");
  });

  it("drops empty cells rather than emitting a run of bare pipes", () => {
    expect(
      renderBlockText({
        block: { table_row: { cells: [span({ text: "AC-2" }), [], span({ text: "Done" })] }, type: "table_row" },
        render,
      }),
    ).toBe("AC-2 | Done");
  });

  it("renders empty for a row with no cells array", () => {
    expect(renderBlockText({ block: { table_row: {}, type: "table_row" }, render })).toBe("");
  });

  it("leaves the parent table itself empty — its content lives in the rows the crawl recurses into", () => {
    expect(renderBlockText({ block: { table: { table_width: 3 }, type: "table" }, render })).toBe("");
  });
});

describe("renderBlockText — to_do checked state", () => {
  it("marks a completed item, so a done control reads differently from an outstanding one", () => {
    expect(
      renderBlockText({
        block: { to_do: { checked: true, rich_text: span({ text: "rotate keys" }) }, type: "to_do" },
        render,
      }),
    ).toBe("[x] rotate keys");
  });

  it("marks an outstanding item", () => {
    expect(
      renderBlockText({
        block: { to_do: { checked: false, rich_text: span({ text: "rotate keys" }) }, type: "to_do" },
        render,
      }),
    ).toBe("[ ] rotate keys");
  });

  it("adds no checkbox to an empty to_do, so a blank line stays blank", () => {
    expect(renderBlockText({ block: { to_do: { checked: true, rich_text: [] }, type: "to_do" }, render })).toBe("");
  });
});

describe("renderBlockText — titles and captions that were dropped", () => {
  it("renders a child_page's own title (139 measured, all empty before)", () => {
    expect(renderBlockText({ block: { child_page: { title: "Access Control" }, type: "child_page" }, render })).toBe(
      "Access Control",
    );
  });

  it("renders a child_database's title", () => {
    expect(
      renderBlockText({ block: { child_database: { title: "Risk Register" }, type: "child_database" }, render }),
    ).toBe("Risk Register");
  });

  it("renders an image's caption (75 measured, all empty before)", () => {
    expect(
      renderBlockText({
        block: {
          image: { caption: span({ text: "network diagram" }), file: { url: "https://signed" } },
          type: "image",
        },
        render,
      }),
    ).toBe("network diagram");
  });

  it("renders a bookmark's url and caption together", () => {
    expect(
      renderBlockText({
        block: { bookmark: { caption: span({ text: "the policy" }), url: "https://example.test/p" }, type: "bookmark" },
        render,
      }),
    ).toBe("https://example.test/p — the policy");
  });

  it("renders a link_preview's url", () => {
    expect(
      renderBlockText({ block: { link_preview: { url: "https://example.test/x" }, type: "link_preview" }, render }),
    ).toBe("https://example.test/x");
  });

  it("renders an equation's expression", () => {
    expect(renderBlockText({ block: { equation: { expression: "a^2+b^2" }, type: "equation" }, render })).toBe(
      "a^2+b^2",
    );
  });
});

describe("renderBlockText — unchanged behaviour", () => {
  it("still renders a paragraph's rich text", () => {
    expect(
      renderBlockText({ block: { paragraph: { rich_text: span({ text: "hi" }) }, type: "paragraph" }, render }),
    ).toBe("hi");
  });

  it("still renders empty for a divider, which genuinely carries no text", () => {
    expect(renderBlockText({ block: { divider: {}, type: "divider" }, render })).toBe("");
  });

  it("falls back to rich_text for a block type the table does not name", () => {
    expect(
      renderBlockText({ block: { callout: { rich_text: span({ text: "note this" }) }, type: "callout" }, render }),
    ).toBe("note this");
  });

  it("prefixes a code block with its language", () => {
    expect(
      renderBlockText({
        block: { code: { language: "bash", rich_text: span({ text: "ls -la" }) }, type: "code" },
        render,
      }),
    ).toBe("bash:\nls -la");
  });

  it("renders empty for a block with no type or no body", () => {
    expect(renderBlockText({ block: { paragraph: { rich_text: span({ text: "x" }) } }, render })).toBe("");
    expect(renderBlockText({ block: { type: "paragraph" }, render })).toBe("");
  });
});

describe("specialisedBlockTypes", () => {
  it("names every type with a rule of its own, so the audit surface need not re-derive the list", () => {
    expect(specialisedBlockTypes()).toEqual([
      "audio",
      "bookmark",
      "child_database",
      "child_page",
      "code",
      "embed",
      "equation",
      "file",
      "image",
      "link_preview",
      "pdf",
      "table_row",
      "to_do",
      "video",
    ]);
  });
});
