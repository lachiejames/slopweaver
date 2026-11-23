/**
 * The Node-side half of the Explorer capture script: the options `readExplorerView` is evaluated with. They cross
 * into the page as JSON, so their exact values are what anchors the page-side reader to the Node-side checks.
 *
 * `readExplorerView` itself runs INSIDE the page against a live DOM, which the unit lane does not have.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_VIEW_DEPTH,
  QUERY_CONTROL_SELECTORS,
  type ReadExplorerOptions,
  readExplorerOptions,
  VIEW_MARKER,
} from "../../../../datadog/shot/explorerScript.js";

describe("the Explorer script constants", () => {
  it("matches the query control by test id, label and class, in that priority order", () => {
    expect(QUERY_CONTROL_SELECTORS).toEqual([
      '[data-testid="query-editor"]',
      '[aria-label="Query"]',
      ".druids_query-editor",
      "[class*='query-editor']",
    ]);
  });

  it("stamps the crop region with its own data attribute and bounds the walk at 10 ancestors", () => {
    expect(VIEW_MARKER).toBe("data-slopweaver-explorer-view");
    expect(MAX_VIEW_DEPTH).toBe(10);
  });
});

describe("readExplorerOptions", () => {
  it("builds the read options from the module's own selectors, marker and depth bound", () => {
    const expected: ReadExplorerOptions = {
      marker: "data-slopweaver-explorer-view",
      maxDepth: 10,
      querySelectors: [
        '[data-testid="query-editor"]',
        '[aria-label="Query"]',
        ".druids_query-editor",
        "[class*='query-editor']",
      ],
    };
    expect(readExplorerOptions()).toEqual(expected);
  });

  it("survives the JSON round trip into the page unchanged", () => {
    expect(JSON.parse(JSON.stringify(readExplorerOptions()))).toEqual(readExplorerOptions());
  });

  it("passes the module's selector constant through as the query selectors", () => {
    expect(readExplorerOptions().querySelectors).toBe(QUERY_CONTROL_SELECTORS);
  });
});
