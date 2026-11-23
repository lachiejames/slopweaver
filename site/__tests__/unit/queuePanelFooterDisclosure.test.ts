/**
 * A Queue panel's act bar carries no loose paragraph of prose: an ask has no act bar at all, and every explanation of
 * a command the bar does not press sits behind one closed line.
 *
 * The bottom of an opened ask, its "Say your answer aloud" line included, is tucked under a fold because loose
 * prose clutters the page. The unit lane has no `react-dom`, so the markup is not rendered here — the before and after are photographs in the pull request. What
 * this holds is the source shape that keeps the prose folded.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SITE = join(import.meta.dirname, "../..");

/**
 * The Queue's panels, every file of them in panel order, whitespace collapsed so a reflow by the formatter does not
 * move the assertion.
 */
const PANELS = [
  "QueuePanels.tsx",
  "QueuePanelsRow.tsx",
  "QueuePanelsAsk.tsx",
  "QueuePanelsHand.tsx",
  "QueuePanelsAct.tsx",
  "QueuePanelsDrafts.tsx",
]
  .map((file) => readFileSync(join(SITE, "components/console", file), "utf8"))
  .join("\n")
  .replaceAll(/\s+/gu, " ");

/** Every folded footnote's summary line, in the order the panels draw them. */
function footSummaries(): readonly string[] {
  return [
    ...PANELS.matchAll(
      /<details className=\{SLIDE_FOOT_NOTE\}> <summary className="cursor-pointer">([^<]*)<\/summary>/gu,
    ),
  ].map((match) => match[1]);
}

describe("a Queue panel's footnote", () => {
  it("is never a loose paragraph", () => {
    expect(PANELS).not.toContain("<p className={SLIDE_FOOT_NOTE}>");
  });

  it("is a closed fold on every panel that explains a command, ActPanel's included", () => {
    expect(footSummaries()).toEqual([
      "why there is no enqueue button",
      "what these buttons run",
      "how to release or drop it",
      "how to send or drop it",
      "how to drop it",
      "how to answer it",
    ]);
  });

  it("never opens itself", () => {
    expect(PANELS).not.toMatch(/<details className=\{SLIDE_FOOT_NOTE\}[^>]*\bopen\b/u);
  });
});

describe("an ask's panel", () => {
  it("has no act bar, and no line telling the owner to answer aloud", () => {
    const ask = PANELS.slice(PANELS.indexOf("function AskPanel("), PANELS.indexOf("function askFigure("));
    expect(ask).toContain("<SlideOver {...head}>");
    expect(ask).not.toContain("footer");
    expect(PANELS).not.toContain("Say your answer aloud");
  });
});
