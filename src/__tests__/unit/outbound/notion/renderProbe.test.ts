/**
 * The Notion render probe's selectors and the two page-realm scripts built from them. Nothing here runs a
 * browser: what is pinned is the selector registry and the SOURCE the scripts are generated as — which
 * selector each one embeds, in which order the render-state branches are tried, and how the observation
 * numbers what it reports.
 */
import { describe, expect, it } from "vitest";

import {
  CELL_TEXT_SELECTOR,
  CODE_BLOCK_SELECTOR,
  CODE_SOURCE_SELECTOR,
  DIAGRAM_SELECTOR,
  FRONT_PAGE_CLASS,
  LOGIN_SELECTOR,
  MERMAID_OPENERS,
  OUTERMOST_CODE_BLOCK_SELECTOR,
  observationScript,
  PAGE_CONTENT_SELECTOR,
  renderStateScript,
  TEXT_BLOCK_SELECTOR,
} from "../../../../outbound/notion/renderProbe.js";

/** How many times `needle` occurs in `haystack`. */
function occurrences({ haystack, needle }: { haystack: string; needle: string }): number {
  return haystack.split(needle).length - 1;
}

describe("renderProbe selectors", () => {
  it("are the literals read off a live page", () => {
    expect([
      PAGE_CONTENT_SELECTOR,
      LOGIN_SELECTOR,
      FRONT_PAGE_CLASS,
      CODE_BLOCK_SELECTOR,
      OUTERMOST_CODE_BLOCK_SELECTOR,
      DIAGRAM_SELECTOR,
      CODE_SOURCE_SELECTOR,
      CELL_TEXT_SELECTOR,
      TEXT_BLOCK_SELECTOR,
    ]).toEqual([
      ".notion-page-content",
      ".notion-login",
      "notion-front-page",
      ".notion-code-block",
      ".notion-code-block:not(.notion-code-block .notion-code-block)",
      "svg[id^='mermaid'], [data-diagram-container='true']",
      "[aria-roledescription='code block']",
      ".notion-table-cell-text",
      "[data-block-id]",
    ]);
  });

  it("MERMAID_OPENERS is the whole ordered list of diagram opening words", () => {
    expect(MERMAID_OPENERS).toEqual([
      "flowchart",
      "graph",
      "sequencediagram",
      "classdiagram",
      "statediagram",
      "erdiagram",
      "journey",
      "gantt",
      "pie",
      "mindmap",
      "timeline",
      "gitgraph",
      "quadrantchart",
      "requirementdiagram",
      "c4context",
      "sankey-beta",
      "xychart-beta",
      "block-beta",
      "packet-beta",
      "architecture-beta",
    ]);
  });
});

describe("renderStateScript", () => {
  it("embeds the content, login and front-page markers once each, tried in that order", () => {
    const script = renderStateScript();
    const content = 'document.querySelector(".notion-page-content") !== null) { return "rendered"; }';
    const login = 'document.querySelector(".notion-login") !== null) { return "sign-in-wall"; }';
    const frontPage = 'className.includes("notion-front-page")) { return "sign-in-wall"; }';

    expect([content, login, frontPage].map((needle) => occurrences({ haystack: script, needle }))).toEqual([1, 1, 1]);
    expect(script.indexOf(content)).toBeLessThan(script.indexOf(login));
    expect(script.indexOf(login)).toBeLessThan(script.indexOf(frontPage));
    expect(script.indexOf(frontPage)).toBeLessThan(script.indexOf('return "neither";'));
    expect(occurrences({ haystack: script, needle: 'return "neither";' })).toBe(1);
  });
});

describe("observationScript", () => {
  const script = observationScript();

  it("embeds each selector it reads, JSON-quoted, the expected number of times", () => {
    expect(
      [CELL_TEXT_SELECTOR, TEXT_BLOCK_SELECTOR, CODE_BLOCK_SELECTOR, DIAGRAM_SELECTOR, CODE_SOURCE_SELECTOR].map(
        (selector) => occurrences({ haystack: script, needle: JSON.stringify(selector) }),
      ),
    ).toEqual([1, 2, 3, 1, 1]);
    expect(occurrences({ haystack: script, needle: JSON.stringify(MERMAID_OPENERS) })).toBe(1);
  });

  it("numbers table cells and prose blocks from one", () => {
    expect(occurrences({ haystack: script, needle: "table: tableIndex + 1," })).toBe(1);
    expect(occurrences({ haystack: script, needle: "row: rowIndex + 1," })).toBe(1);
    expect(occurrences({ haystack: script, needle: "column: columnIndex + 1," })).toBe(1);
    expect(occurrences({ haystack: script, needle: "index: index + 1," })).toBe(1);
  });

  it("drops a code block nested inside another before numbering the mermaid blocks", () => {
    const filter = 'block.parentElement.closest(".notion-code-block") === null';

    expect(occurrences({ haystack: script, needle: filter })).toBe(1);
    expect(script.indexOf(filter)).toBeLessThan(script.indexOf("outermost.forEach((block, blockIndex)"));
    expect(
      occurrences({
        haystack: script,
        needle: "mermaid.push({ index: mermaid.length + 1, codeBlockIndex: blockIndex, mode });",
      }),
    ).toBe(1);
  });

  it("assigns each of the four modes exactly once, defaulting to unknown", () => {
    expect(
      ['let mode = "unknown";', 'mode = "split";', 'mode = "preview";', 'mode = "code";'].map((needle) =>
        occurrences({ haystack: script, needle }),
      ),
    ).toEqual([1, 1, 1, 1]);
  });

  it("returns cells, mermaid and prose as one object", () => {
    expect(occurrences({ haystack: script, needle: "return { cells, mermaid, prose };" })).toBe(1);
  });
});
