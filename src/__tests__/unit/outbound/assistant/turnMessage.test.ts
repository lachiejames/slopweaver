import type { RichTextBlock } from "@slack/types";
import { describe, expect, it } from "vitest";
import type { TodoStep } from "../../../../outbound/assistant/todoBlock.js";
import {
  renderTurnMessage,
  SLACK_TURN_RENDERER,
  turnFallbackText,
} from "../../../../outbound/assistant/turnMessage.js";
import type { TurnChrome } from "../../../../outbound/slack/types.js";

const CHROME: TurnChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#8B5CF6",
  detailLabel: "*Details*",
  metadataEventType: "test_turn_v1",
};

const STEPS: readonly TodoStep[] = [
  { detail: '"why?"', id: "question", state: "done", title: "Read the question" },
  { id: "corpus", state: "running", title: "Load the world model" },
  { id: "answer", state: "pending", title: "Compose a cited answer" },
];

const render = ({ steps = STEPS }: { steps?: readonly TodoStep[] } = {}) =>
  renderTurnMessage({
    asOfEpochSeconds: 1785192578,
    asOfFallback: "just now",
    chrome: CHROME,
    modelId: "claude -p",
    steps,
    task: "answering: why?",
    turnId: "turn-1",
  });

describe("turnFallbackText", () => {
  it("names the bot and the task, so a push notification is not silent", () => {
    expect(turnFallbackText({ chrome: CHROME, task: "answering: why?" })).toBe("test-bot: answering: why?");
  });
});

describe("renderTurnMessage", () => {
  it("emits the complete seven-block chrome topology in one violet wrapper", () => {
    expect(render().attachments[0].color).toBe("#8B5CF6");
    expect(render().attachments[0].blocks.map((block) => block.type)).toEqual([
      "context",
      "divider",
      "rich_text",
      "divider",
      "context",
      "context",
      "context",
    ]);
  });

  it("pins the exact author header, both dividers and Details label", () => {
    expect(render().attachments[0].blocks[0]).toEqual({
      elements: [{ text: ":robot_face:  *test-bot*", type: "mrkdwn" }],
      type: "context",
    });
    expect(render().attachments[0].blocks[1]).toEqual({ type: "divider" });
    expect(render().attachments[0].blocks[3]).toEqual({ type: "divider" });
    expect(render().attachments[0].blocks[4]).toEqual({
      elements: [{ text: "*Details*", type: "mrkdwn" }],
      type: "context",
    });
  });

  /**
   * The `plan` block — one collapsing row, the owner's own pick over sixty-six live renders
   * ("plan won") — was tried here and Slack REFUSED the message: `chat.update` returned
   * `invalid_attachments`, because this card carries its violet chrome in an `attachments` container and
   * `plan` is a top-level block Slack will not accept inside one. See `turnMessage.ts`'s `turnContentBlock`.
   */
  it("keeps the task and checklist together in the one above-fold rich_text block", () => {
    const body = render().attachments[0].blocks[2];
    expect(body).toEqual({
      elements: [
        {
          elements: [{ style: { bold: true }, text: "answering: why?", type: "text" }],
          type: "rich_text_section",
        },
        {
          elements: [
            {
              text: '✓ Read the question — "why?"\n✱ Load the world model\n◦ Compose a cited answer',
              type: "text",
            },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    });
  });

  it("carries a finished step's own finding under it, which is what makes a done line worth keeping", () => {
    const body = render({
      steps: [{ detail: "47 messages, 12 PRs named", id: "thread", state: "done", title: "Read the thread" }],
    }).attachments[0].blocks[2] as RichTextBlock;
    expect(body).toEqual({
      elements: [
        {
          elements: [{ style: { bold: true }, text: "answering: why?", type: "text" }],
          type: "rich_text_section",
        },
        {
          elements: [{ text: "✓ Read the thread — 47 messages, 12 PRs named", type: "text" }],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    });
  });

  it("puts the client-rendered date token in a CONTEXT block, where mrkdwn works", () => {
    expect(render().attachments[0].blocks[5]).toEqual({
      block_id: "todos_as_of",
      elements: [{ text: "_todos as of <!date^1785192578^{time} ({ago})|just now>_", type: "mrkdwn" }],
      type: "context",
    });
  });

  it("ends with the provenance footer, carrying the model and no session link", () => {
    expect(render().attachments[0].blocks[6]).toEqual({
      elements: [
        {
          text: "claude -p",
          type: "mrkdwn",
        },
      ],
      type: "context",
    });
  });

  it("never renders a session link — the id names a local terminal session nobody else can open", () => {
    expect(JSON.stringify(render())).not.toContain("Open session in Claude");
  });

  it("stamps metadata a later edit can recognise as its own", () => {
    expect(render().metadata).toEqual({
      event_payload: { renderer: SLACK_TURN_RENDERER, schemaVersion: 1, turnId: "turn-1" },
      event_type: "test_turn_v1",
    });
  });

  it("keeps top-level text empty and puts the notification fallback on the wrapper", () => {
    expect(render().text).toBe("");
    expect(render().attachments[0].fallback).toBe("test-bot: answering: why?");
  });

  it("suppresses unfurls so a cited URL cannot expand the message under the checklist", () => {
    expect(render().unfurl_links).toBe(false);
    expect(render().unfurl_media).toBe(false);
  });

  it("is deterministic — the same progress renders the same bytes, which is what makes an edit idempotent", () => {
    expect(JSON.stringify(render())).toBe(JSON.stringify(render()));
  });

  it("still renders seven blocks for an empty checklist, so frame zero is structurally the same", () => {
    expect(render({ steps: [] }).attachments[0].blocks).toHaveLength(7);
  });
});

describe("renderTurnMessage — the planning loop", () => {
  const LOOP_STEPS: readonly TodoStep[] = [
    { id: "meter", placement: "meter", state: "running", title: "▰▱▱ step 2 of 3 · review round 1" },
    { detail: '"why?"', id: "question", state: "done", title: "Read the question" },
    { children: ["40 of 40 connections held", "now: reading a file"], id: "plan-2", state: "running", title: "Check" },
    { children: ["read the metrics"], id: "loop-0", placement: "loop", state: "done", title: "planned 3 steps" },
    { id: "loop-1", placement: "loop", state: "running", title: "independent review, round 1" },
  ];

  it("draws the meter and the outline above the fold, the live step expanded and no loop phase", () => {
    const body = render({ steps: LOOP_STEPS }).attachments[0].blocks[2] as RichTextBlock;
    expect(body.elements[1]).toEqual({
      elements: [
        {
          text:
            '▰▱▱ step 2 of 3 · review round 1\n✓ Read the question — "why?"\n✱ Check' +
            "\n      ↳ 40 of 40 connections held\n      ↳ now: reading a file",
          type: "text",
        },
      ],
      type: "rich_text_section",
    });
  });

  it("puts the loop's phases below the Details label, ahead of the date and footer", () => {
    const blocks = render({ steps: LOOP_STEPS }).attachments[0].blocks;
    expect(blocks.map((block) => block.type)).toEqual([
      "context",
      "divider",
      "rich_text",
      "divider",
      "context",
      "rich_text",
      "context",
      "context",
    ]);
    expect(blocks[5]).toEqual({
      elements: [
        {
          elements: [
            { style: { bold: true }, text: "the loop so far\n", type: "text" },
            {
              text: "✓ planned 3 steps\n      ↳ read the metrics\n✱ independent review, round 1",
              type: "text",
            },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    });
  });
});
