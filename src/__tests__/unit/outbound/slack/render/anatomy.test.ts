/*
 * The measured anatomy of a rendered card: an empty top-level text, one wrapper, metadata at the top level, the
 * wrapper's colour and fallback, the six blocks that make it fold, the author row and the detail label.
 */
import { describe, expect, it } from "vitest";

import { minimalArtifact, render } from "./harness.js";

describe("renderUpdateCard — the measured anatomy", () => {
  it("emits an empty top-level text, no top-level blocks, and exactly one wrapper", () => {
    const payload = render({ artifact: minimalArtifact() });

    expect(payload.text).toBe("");
    expect(payload.attachments.length).toBe(1);
    expect(payload.unfurl_links).toBe(false);
    expect(payload.unfurl_media).toBe(false);
  });

  it("puts metadata at the TOP level, not inside the wrapper", () => {
    const payload = render({ artifact: minimalArtifact() });

    expect(payload.metadata).toEqual({
      event_payload: {
        artifactFingerprint: "fp-1",
        artifactKind: "update",
        renderer: "slack-card-v1",
        schemaVersion: 1,
      },
      event_type: "test_card_v1",
    });
    expect(Object.hasOwn(payload.attachments[0], "metadata")).toBe(false);
  });

  it("sets the wrapper colour and uses the TL;DR verbatim as the fallback", () => {
    const payload = render({ artifact: minimalArtifact() });

    expect(payload.attachments[0].color).toBe("#12B5A6");
    expect(payload.attachments[0].fallback).toBe("A short lead.");
  });

  it("emits SIX blocks for a one-paragraph card, which is what makes it fold", () => {
    const payload = render({ artifact: minimalArtifact() });
    const blocks = payload.attachments[0].blocks;

    expect(blocks.length).toBe(6);
    expect(blocks.map((b) => b.type)).toEqual(["context", "divider", "rich_text", "divider", "context", "rich_text"]);
  });

  it("renders the author row as mrkdwn with a :shortcode: and two spaces", () => {
    const payload = render({ artifact: minimalArtifact() });

    expect(payload.attachments[0].blocks[0]).toEqual({
      elements: [{ text: ":robot_face:  *test-bot*", type: "mrkdwn" }],
      type: "context",
    });
  });

  it("puts the configured detail label at index 4", () => {
    const payload = render({ artifact: minimalArtifact() });

    expect(payload.attachments[0].blocks[4]).toEqual({
      elements: [{ text: "*Details*", type: "mrkdwn" }],
      type: "context",
    });
  });
});
