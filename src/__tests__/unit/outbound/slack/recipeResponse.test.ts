/**
 * `renderRecipeResponse`/`parseRecipeResponseMetadata` — pure, so every case is a plain call. Round-trip is
 * the property that matters: recovery's exhaustive Slack search depends on reading back exactly what was
 * rendered.
 */
import { describe, expect, it } from "vitest";

import {
  parseRecipeResponseMetadata,
  type RecipeResponseAnchor,
  renderRecipeResponse,
} from "../../../../outbound/slack/recipeResponse.js";
import type { SlackCardWrapper } from "../../../../outbound/slack/types.js";

const WRAPPER: SlackCardWrapper = { blocks: [], color: "#6b21e8", fallback: "recipe response" };

const ANCHOR: RecipeResponseAnchor = {
  idempotencyKey: "recipe-response:abc",
  runId: "run-1",
  slotHash: "a".repeat(64),
  targetChannel: "C1",
  targetThreadTs: undefined,
};

describe("renderRecipeResponse", () => {
  it("carries an empty top-level text, the given wrapper, and no unfurl", () => {
    const payload = renderRecipeResponse({ anchor: ANCHOR, wrapper: WRAPPER });
    expect(payload.text).toBe("");
    expect(payload.attachments).toEqual([WRAPPER]);
    expect(payload.unfurl_links).toBe(false);
    expect(payload.unfurl_media).toBe(false);
  });

  it("embeds the exact anchor identity in event_payload", () => {
    const payload = renderRecipeResponse({ anchor: ANCHOR, wrapper: WRAPPER });
    expect(payload.metadata.event_type).toBe("slopweaver_recipe_response_v1");
    expect(payload.metadata.event_payload).toEqual({
      idempotencyKey: "recipe-response:abc",
      renderer: "slack-recipe-response-v1",
      runId: "run-1",
      schemaVersion: 1,
      slotHash: "a".repeat(64),
      targetChannel: "C1",
      targetThreadTs: undefined,
    });
  });

  it("carries a defined targetThreadTs through when the anchor has one", () => {
    const payload = renderRecipeResponse({ anchor: { ...ANCHOR, targetThreadTs: "1.1" }, wrapper: WRAPPER });
    expect(payload.metadata.event_payload.targetThreadTs).toBe("1.1");
  });
});

describe("parseRecipeResponseMetadata", () => {
  it("round-trips exactly what renderRecipeResponse embedded", () => {
    const payload = renderRecipeResponse({ anchor: ANCHOR, wrapper: WRAPPER });
    expect(parseRecipeResponseMetadata({ value: payload.metadata })).toEqual(ANCHOR);
  });

  it("round-trips a defined targetThreadTs", () => {
    const anchor = { ...ANCHOR, targetThreadTs: "1.1" };
    const payload = renderRecipeResponse({ anchor, wrapper: WRAPPER });
    expect(parseRecipeResponseMetadata({ value: payload.metadata })).toEqual(anchor);
  });

  it("returns undefined for a message carrying a different event_type (e.g. the operator card)", () => {
    expect(
      parseRecipeResponseMetadata({
        value: { event_payload: {}, event_type: "some-other-card" },
      }),
    ).toBeUndefined();
  });

  it("returns undefined for a malformed event_payload missing a required field", () => {
    const payload = renderRecipeResponse({ anchor: ANCHOR, wrapper: WRAPPER });
    const { slotHash: _slotHash, ...withoutSlotHash } = payload.metadata.event_payload;
    expect(
      parseRecipeResponseMetadata({ value: { ...payload.metadata, event_payload: withoutSlotHash } }),
    ).toBeUndefined();
  });

  it("returns undefined for a non-record value", () => {
    expect(parseRecipeResponseMetadata({ value: "not a record" })).toBeUndefined();
  });

  it("returns undefined when event_payload itself is not a record", () => {
    expect(
      parseRecipeResponseMetadata({ value: { event_payload: "nope", event_type: "slopweaver_recipe_response_v1" } }),
    ).toBeUndefined();
  });
});
