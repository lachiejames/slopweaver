/**
 * The Node-side half of the backtest panel script: the options `markBacktestPanel` is evaluated with. They cross
 * into the page as JSON, so their exact values are what anchors the page-side reader to the Node-side waits.
 *
 * `markBacktestPanel` itself runs INSIDE the page against a live DOM, which the unit lane does not have; it is
 * exercised by the browser capture, and its text is parsed in Node by `parseBacktestPanel`, which is unit-tested.
 */
import { describe, expect, it } from "vitest";

import { markPanelOptions } from "../../../../datadog/shot/panelScript.js";

describe("markPanelOptions", () => {
  it("builds the marking options from the module's own selectors, labels, bound and outline", () => {
    expect(markPanelOptions()).toEqual({
      heading: "Monitor behavior with this threshold",
      labels: ["Alert", "Warn", "Recover", "No Data"],
      marker: "data-slopweaver-backtest-panel",
      maxDepth: 12,
      outline: { color: "#d63031", offsetPx: 4, radiusPx: 3, widthPx: 3 },
      pickerSelector: 'input[aria-label="Time range picker"]',
      window: "Past 1 Week",
    });
  });

  it("survives the JSON round trip into the page unchanged", () => {
    expect(JSON.parse(JSON.stringify(markPanelOptions()))).toEqual(markPanelOptions());
  });

  it("hands each call its own label list, so a caller cannot mutate the module's constant", () => {
    expect(markPanelOptions().labels).not.toBe(markPanelOptions().labels);
  });
});
