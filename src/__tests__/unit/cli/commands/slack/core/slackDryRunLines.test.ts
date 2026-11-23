/*
 * `slackDryRunLines`: what a dry run prints — nothing sent and no fold predicted, the mention and roster
 * summaries, the readable card, advisory warnings, and every composite step when media rides along.
 */
import { describe, expect, it } from "vitest";

import { slackDryRunLines } from "../../../../../../cli/commands/slack/core.js";
import { MENTIONS, planFor } from "./harness.js";

describe("slackDryRunLines", () => {
  it("states that nothing was sent, and REFUSES to predict the fold it cannot see", () => {
    const lines = slackDryRunLines({ mediaFilenames: [], mentions: MENTIONS, plan: planFor() });

    expect(lines[0]).toBe("dry run — nothing was sent. as=bot channel=C1");
    // It used to read `card: 6 blocks in 1 wrapper (folds behind Show more)`, computed from the block-count
    // rule a three-block attachment refuted. The shape is still reported; the prediction is gone.
    expect(lines[1]).toBe(
      'card: 6 blocks in 1 wrapper — whether Slack draws "Show more" on it is NOT decidable here; ' +
        "photograph it with `slopweaver slack shot` if that matters.",
    );
  });

  it("summarises how the mentions resolved and how trustworthy the roster is", () => {
    const lines = slackDryRunLines({ mediaFilenames: [], mentions: MENTIONS, plan: planFor() });

    expect(lines[2]).toBe(
      "mentions: 1 resolved (1 confirmed by the identity roster, 0 the bot's own declared identity, 0 from the derived roster)",
    );
    expect(lines[3]).toBe(
      "roster: 12 addressable keys from 9 derived people · 3 held (never addressable) · 0 ambiguous keys dropped",
    );
  });

  it("includes the READABLE card, so the wording can be proof-read before it is sent", () => {
    const lines = slackDryRunLines({ mediaFilenames: [], mentions: MENTIONS, plan: planFor() });

    expect(lines).toContain("A short lead.");
    expect(lines).toContain("The detail.");
    expect(lines).toContain("*Details*");
  });

  it("labels advisory warnings as non-blocking", () => {
    const lines = slackDryRunLines({ mediaFilenames: [], mentions: MENTIONS, plan: planFor() });

    expect(lines).toContain("warnings (advisory — these never block a send):");
  });

  it("lists every composite step when media is attached", () => {
    const lines = slackDryRunLines({
      mediaFilenames: ["a.png"],
      mentions: MENTIONS,
      plan: planFor({ media: ["a.png"] }),
    });

    expect(lines.join("\n")).toContain("chat.update");
    expect(lines.join("\n")).toContain("conversations.history");
  });
});
