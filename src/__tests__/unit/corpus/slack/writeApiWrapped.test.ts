/**
 * The wrapper write calls and the one attachment conversion they share. A card is posted through the REAL
 * guarded client carrying a dead Datadog host, which refuses before the SDK sends, so no server is needed and
 * the refusal proves the rendered wrapper is what reached the client.
 */
import { describe, expect, it } from "vitest";

import { GuardedWebClient } from "../../../../corpus/slack/guardedWebClient.js";
import { toSdkAttachments } from "../../../../corpus/slack/sdkAttachments.js";
import { postCardCall } from "../../../../corpus/slack/writeApiWrapped.js";
import { renderUpdateCard } from "../../../../outbound/slack/render.js";
import { NO_TERMS_SLACK_PRIVACY } from "../../../slackWritePrivacyFixture.js";

/** A card whose summary carries the host the bot once posted, but on the synthetic `ap1` site. */
const DEAD_HOST_CARD = renderUpdateCard({
  artifact: {
    citations: [],
    detail: [{ runs: [{ text: "One paragraph.", type: "text" }], type: "paragraph" }],
    index: [],
    kind: "update",
    media: [],
    tldr: "the monitor: https://app.ap1.datadoghq.com/monitors/1000001",
  },
  artifactFingerprint: "unit",
  chrome: {
    authorEmoji: ":robot_face:",
    authorLabel: "test-bot",
    bannerColor: "#ABCDEF",
    detailLabel: "*Details*",
    metadataEventType: "test_card_v1",
  },
  mentions: { groups: new Map(), people: new Map() },
});

describe("toSdkAttachments", () => {
  it("copies the one wrapper into the SDK's mutable array, blocks by reference", () => {
    const wrapper = DEAD_HOST_CARD.attachments[0];
    const [converted, ...rest] = toSdkAttachments({ wrapper });
    expect(rest).toEqual([]);
    expect(converted!.color).toBe("#ABCDEF");
    expect(converted!.fallback).toBe(wrapper.fallback);
    expect(converted!.blocks).toEqual([...wrapper.blocks]);
    expect(converted!.blocks).not.toBe(wrapper.blocks);
  });
});

describe("postCardCall", () => {
  it("hands the rendered wrapper to the guarded client, which refuses the dead host before sending", async () => {
    const client = new GuardedWebClient({ privacy: NO_TERMS_SLACK_PRIVACY, token: "xoxb-not-a-real-token" });
    await expect(
      postCardCall({
        channel: "C0SYN000000000",
        client,
        payload: DEAD_HOST_CARD,
        scopeId: "unit",
        threadTs: undefined,
      }),
    ).rejects.toThrow(
      /app\.ap1\.datadoghq\.com is not a Datadog console; use ap1\.datadoghq\.com — found at attachments\.0\./u,
    );
  });
});
