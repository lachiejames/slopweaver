/** A card's `subject.url` never links a markdown document, in either grouping. */
import { describe, expect, it } from "vitest";

import { withCard, withMineCard } from "./fixtures.js";
import { refusals } from "./harness.js";

describe("a card's subject is never a markdown document", () => {
  /** The exact url on a Slack-ingest-stall finding card that linked a markdown document. */
  const HIS_DOC =
    "file:///Users/ada.owner/.slopweaver/handovers/slack-ingest-stalls-on-poll-known-threads-corpus-a-day-behind.md";

  it("refuses the very finding card the owner could not react to, at its me-facing path", () => {
    const over = { subject: { text: "Slack ingest stalls on the poll-known-threads walk", url: HIS_DOC } };

    expect(refusals({ form: withMineCard({ over }) })).toEqual([
      "reactNow.meFacing.0.subject.url: this card's `subject.url` links a markdown document, which opens as " +
        "raw text you have to read top to bottom rather than a page you can react to. " +
        "Publish the finding as a page — `slopweaver page publish <slug> --page <fragment>.html --review <id>` — carrying " +
        "what was measured, why it matters, the candidate causes, and the options with their cost, and link " +
        "that page instead; or drop the card until the page exists.",
    ]);
  });

  it("refuses a team-facing card the same way, since the owner is the reader of both groupings", () => {
    const over = { subject: { text: "the plan", url: "https://example.invalid/docs/plan.md#options" } };

    expect(refusals({ form: withCard({ over }) }).map((line) => line.split(":")[0])).toEqual([
      "reactNow.teamFacing.0.subject.url",
    ]);
  });

  it("admits the page the finding should have been published as", () => {
    const url = "file:///Users/ada.owner/.slopweaver/pages/slack-ingest-stall/index.html";
    const over = { subject: { text: "Slack ingest stall", url } };

    expect(refusals({ form: withCard({ over }) })).toEqual([]);
  });
});
