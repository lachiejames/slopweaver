import type { KnownBlock } from "@slack/types";
import { describe, expect, it } from "vitest";

import { type PollArtifact, pollBallot } from "../../../../outbound/slack/pollForm.js";
import { type PollSurface, pollFooterFor, renderPoll } from "../../../../outbound/slack/pollRender.js";
import type { SlackCardChrome } from "../../../../outbound/slack/types.js";
// The event type lives on the operator's profile chrome, so it comes from there rather than the renderer.
import { DEFAULT_POLL_METADATA_EVENT_TYPE as POLL_METADATA_EVENT_TYPE } from "../../../../profile.js";

/** The escape hatch the ballot always appends. */
const OTHER = "Other — explain in replies";
const CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#8B5CF6",
  detailLabel: "*Details*",
  metadataEventType: "unused_card_v1",
};

function poll({ options }: { options: readonly string[] }): PollArtifact {
  return { kind: "poll", options, question: "Where did the time go?", why: "Because." };
}

function payloadFor({
  options,
  pings = [],
  surface = "shared-channel",
}: {
  options: readonly string[];
  pings?: readonly string[];
  surface?: PollSurface;
}) {
  const artifact = poll({ options });
  return renderPoll({
    artifact,
    ballot: pollBallot({ options: artifact.options }),
    chrome: CHROME,
    metadataEventType: POLL_METADATA_EVENT_TYPE,
    pings,
    pollId: "pid",
    surface,
  });
}

/** The wrapper's blocks. */
function blocksOf({
  options,
  pings = [],
  surface = "shared-channel",
}: {
  options: readonly string[];
  pings?: readonly string[];
  surface?: PollSurface;
}) {
  return payloadFor({ options, pings, surface }).attachments[0].blocks;
}

/**
 * One block's mrkdwn/plain text, narrowed LOUDLY.
 *
 * The narrowing lives here rather than in an assertion: a test that silently took the other branch would pass
 * for the wrong reason, which is what the no-conditionals rule exists to prevent.
 */
function textOf({ block }: { block: KnownBlock | undefined }): string {
  if (block?.type === "header") {
    return block.text.text;
  }
  if (block?.type === "section" && block.text !== undefined) {
    return block.text.text;
  }
  if (block?.type === "context") {
    return block.elements.map((element) => ("text" in element ? element.text : "")).join("");
  }
  throw new Error(`expected a text-bearing block, got ${String(block?.type)}`);
}

describe("renderPoll", () => {
  it("emits the exact full chrome around one above-fold poll block", () => {
    const payload = payloadFor({ options: ["A", "B"] });

    expect(payload.attachments[0].color).toBe("#8B5CF6");
    expect(payload.attachments[0].blocks.map((block) => block.type)).toEqual([
      "context",
      "divider",
      "section",
      "divider",
      "context",
      "context",
    ]);
    expect(textOf({ block: payload.attachments[0].blocks[0] })).toBe(":robot_face:  *test-bot*");
    expect(textOf({ block: payload.attachments[0].blocks[4] })).toBe("*Details*");
  });

  it("keeps the complete ballot in block two, above the fold, at the largest ballot", () => {
    const content = textOf({ block: blocksOf({ options: ["A", "B", "C", "D"] })[2] });

    expect(content).toContain(":one:  A\n:two:  B\n:three:  C\n:four:  D\n:five:  Other — explain in replies");
  });

  it("puts the question in BOLD and the reason beneath it", () => {
    expect(textOf({ block: blocksOf({ options: ["A", "B"] })[2] })).toContain("*Where did the time go?*\nBecause.");
  });

  it("renders the ballot in the same content block, one keycap per line, escape hatch last", () => {
    expect(textOf({ block: blocksOf({ options: ["A", "B"] })[2] })).toContain(`:one:  A\n:two:  B\n:three:  ${OTHER}`);
  });

  it("uses :shortcode: emoji, which DO expand in mrkdwn — the inverse of rich_text", () => {
    expect(textOf({ block: blocksOf({ options: ["A", "B"] })[2] })).toContain(":one:");
  });

  it("points the reader at the REACTIONS, never at the inert numbers in the list above", () => {
    const footer = textOf({ block: blocksOf({ options: ["A", "B"] })[5] });

    expect(footer).toContain("tapping one of the number reactions already on this message");
    expect(footer).not.toContain("below to vote");
  });

  it("in a SHARED channel, says everyone here can see who voted — which is true there", () => {
    const footer = textOf({ block: blocksOf({ options: ["A", "B"], surface: "shared-channel" })[5] });

    expect(footer).toContain("Everyone in this channel can see who voted");
    expect(footer).toContain("pick more than one");
  });

  it("in a DM, does NOT claim the vote is public — that was false, and it made people self-censor", () => {
    const footer = textOf({ block: blocksOf({ options: ["A", "B"], surface: "direct-message" })[5] });

    expect(footer).not.toContain("Everyone in this channel can see who voted");
    expect(footer).toContain("nobody else being asked will see it");
  });

  it("in a DM, does NOT overcorrect into implying anonymity — the sender CAN see it", () => {
    // A 1:1 DM is a two-person channel, so "your vote is private/anonymous" would just be a NEW false claim.
    // What is true, and what a respondent cares about, is that no other RESPONDENT sees it.
    const footer = textOf({ block: blocksOf({ options: ["A", "B"], surface: "direct-message" })[5] });

    expect(footer).toContain("Only you and whoever sent this can see your answer");
    expect(footer).not.toContain("anonymous");
    expect(footer).not.toContain("private");
  });

  it("gives every surface a DIFFERENT visibility claim, so neither is a re-pinned constant", () => {
    expect(pollFooterFor({ surface: "direct-message" })).not.toBe(pollFooterFor({ surface: "shared-channel" }));
  });

  it("tells the reader HOW to vote on every surface, since the mechanism does not change", () => {
    for (const surface of ["direct-message", "shared-channel"] as const) {
      expect(pollFooterFor({ surface })).toContain("tapping one of the number reactions");
    }
  });

  it("renders no ping line at all when none was asked for", () => {
    expect(textOf({ block: blocksOf({ options: ["A", "B"] })[2] })).not.toContain("<!");
  });

  it("leads with the ping tokens when asked for, above the question", () => {
    const lead = textOf({
      block: blocksOf({ options: ["A", "B"], pings: ["<!subteam^S1|@engineers>", "<!here>"] })[2],
    });

    expect(lead.startsWith("<!subteam^S1|@engineers> <!here>\n\n*Where did the time go?*")).toBe(true);
  });

  it("never escapes a ping token, which would show the raw markup to every reader", () => {
    const lead = textOf({ block: blocksOf({ options: ["A", "B"], pings: ["<@U0ADA>"] })[2] });

    expect(lead).toContain("<@U0ADA>");
    expect(lead).not.toContain("&lt;@U0ADA&gt;");
  });

  it("escapes authored text, because mrkdwn parses it", () => {
    const artifact: PollArtifact = {
      kind: "poll",
      options: ["a < b", "c & d"],
      question: "Which <one>?",
      why: "Because & so on.",
    };
    const rendered = renderPoll({
      artifact,
      ballot: pollBallot({ options: artifact.options }),
      chrome: CHROME,
      metadataEventType: POLL_METADATA_EVENT_TYPE,
      pings: [],
      pollId: "pid",
      surface: "shared-channel",
    });

    expect(textOf({ block: rendered.attachments[0].blocks[2] })).toContain("*Which &lt;one&gt;?*");
    expect(textOf({ block: rendered.attachments[0].blocks[2] })).toContain(":one:  a &lt; b");
  });

  it("carries TOP-LEVEL metadata naming the poll renderer, which is what makes `slack delete` accept it", () => {
    const payload = payloadFor({ options: ["A", "B"] });

    expect(payload.metadata.event_payload.renderer).toBe("slack-poll-v1");
    expect(payload.metadata.event_type).toBe(POLL_METADATA_EVENT_TYPE);
  });

  it("leaves `text` EMPTY, because a non-empty one duplicates the body above the wrapper", () => {
    expect(payloadFor({ options: ["A", "B"] }).text).toBe("");
  });

  it("uses the question as the wrapper fallback, which is what a notification shows", () => {
    expect(payloadFor({ options: ["A", "B"] }).attachments[0].fallback).toBe("Where did the time go?");
  });

  it("suppresses unfurling, so a link preview cannot push the options off a phone screen", () => {
    const payload = payloadFor({ options: ["A", "B"] });

    expect(payload.unfurl_links).toBe(false);
    expect(payload.unfurl_media).toBe(false);
  });
});
