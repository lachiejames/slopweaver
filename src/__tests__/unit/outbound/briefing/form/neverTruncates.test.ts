/** A cell or a fold summary cut with an ellipsis is refused, never accepted as a truncation. */
import { describe, expect, it } from "vitest";

import { text, withCard } from "./fixtures.js";
import { refusals } from "./harness.js";

describe("the briefing form never truncates", () => {
  it("refuses a `what` cell run cut with an ellipsis", () => {
    const over = {
      what: text({ value: "It is a template. It has two real sentences already. The rest trails off …" }),
    };

    expect(refusals({ form: withCard({ over }) })).toEqual([
      "reactNow.teamFacing.0.what.0.text: ends in an ellipsis with nothing after it. A cut that drops the rest leaves it " +
        "nowhere on the page to read — write the whole thing, and fold it behind a `detail` if it runs long.",
    ]);
  });

  it("refuses a fold summary cut with an ellipsis", () => {
    const over = {
      detail: {
        blocks: [{ content: text({ value: "The long version." }), kind: "para" as const }],
        summary: "the rest …",
      },
    };

    expect(refusals({ form: withCard({ over }) })).toEqual([
      "reactNow.teamFacing.0.detail.summary: ends in an ellipsis with nothing after it. A cut that drops the rest leaves " +
        "it nowhere on the page to read — write the whole thing, and fold it behind a `detail` if it runs long.",
    ]);
  });
});
