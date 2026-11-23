/*
 * The pure fixtures every composite-send test file shares: the card, answer and recipe-response payloads, the
 * posted identity, the readiness seams and the upload builder. No disk, no clock, no mocking framework.
 */
import type { PostedMessage, SlackUpload, UploadReadiness } from "../../../../../corpus/slack/writeTransport.js";
import { renderRecipeResponse, type SlackRecipeResponsePayload } from "../../../../../outbound/slack/recipeResponse.js";
import { renderUpdateCard } from "../../../../../outbound/slack/render.js";
import type {
  SlackAssistantAnswerPayload,
  SlackCardChrome,
  SlackCardPayload,
} from "../../../../../outbound/slack/types.js";

const CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#12B5A6",
  detailLabel: "*Details*",
  metadataEventType: "test_card_v1",
};

export const PAYLOAD: SlackCardPayload = renderUpdateCard({
  artifact: {
    citations: [],
    detail: [{ runs: [{ text: "The detail.", type: "text" }], type: "paragraph" }],
    index: [],
    kind: "update",
    media: [],
    tldr: "A short lead.",
  },
  artifactFingerprint: "fp-1",
  chrome: CHROME,
  mentions: { groups: new Map(), people: new Map() },
});

/** An answer payload — the accent-only `attachments` wrapper, never the card's author-row/divider chrome. */
export const ASSISTANT_PAYLOAD: SlackAssistantAnswerPayload = {
  attachments: [
    {
      blocks: [
        {
          elements: [{ elements: [{ text: "The lead.", type: "text" }], type: "rich_text_section" }],
          type: "rich_text",
        },
      ],
      color: "#ABCDEF",
      fallback: "The lead.",
    },
  ],
  metadata: {
    event_payload: { artifactFingerprint: "fp-1", renderer: "slack-assistant-answer-v1", schemaVersion: 1 },
    event_type: "slopweaver_assistant_answer_v1",
  },
  text: "",
  unfurl_links: false,
  unfurl_media: false,
};

/** A recipe response payload — same accent-only wrapper, `RecipeResponseMetadata` instead. */
export const RECIPE_RESPONSE_PAYLOAD: SlackRecipeResponsePayload = renderRecipeResponse({
  anchor: {
    idempotencyKey: "recipe-response:abc",
    runId: "run-1",
    slotHash: "a".repeat(64),
    targetChannel: "C1",
    targetThreadTs: undefined,
  },
  wrapper: { blocks: [], color: "#6b21e8", fallback: "recipe response" },
});

export const POSTED: PostedMessage = { channel: "C1", ts: "1700000000.000100" };

/** Readiness that always says ready — the happy default. */
export const READY: UploadReadiness = { waitForFile: async () => ({ kind: "ready", polls: 1, waitedMs: 0 }) };
/** Readiness that never becomes ready — the measured mimetype race, forced. */
export const NEVER_READY: UploadReadiness = {
  waitForFile: async () => ({ kind: "still-processing", polls: 12, waitedMs: 119_600 }),
};

/**
 * Readiness that strands exactly ONE file — the intermittent shape both live failures took.
 *
 * @param stuck the file id left processing while every other one reads ready
 * @returns the readiness seam
 */
export function readyExcept({ stuck }: { stuck: string }): UploadReadiness {
  return {
    waitForFile: async ({ fileId }) =>
      fileId === stuck
        ? { kind: "still-processing", polls: 12, waitedMs: 119_600 }
        : { kind: "ready", polls: 1, waitedMs: 0 },
  };
}

/**
 * One single-byte upload per name, in the caller's order.
 *
 * @returns the uploads, each carrying the name it was given
 */
export function uploads({ names }: { names: readonly string[] }): SlackUpload[] {
  return names.map((filename) => ({ bytes: new Uint8Array([1]), filename }));
}
