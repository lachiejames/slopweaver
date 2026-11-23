/**
 * `sdkRecipeResponseMetadata`: the recipe response's metadata rebuilt for the Slack SDK — every anchor field
 * copied unchanged, and a top-level target's `targetThreadTs` OMITTED rather than passed as `undefined`,
 * which the SDK's index signature cannot carry. The payloads are built by the real renderer, so the
 * explicit-undefined field the omission is about is really present on the way in.
 */
import { describe, expect, it } from "vitest";

import { sdkRecipeResponseMetadata } from "../../../../corpus/slack/writeApiRecipeResponse.js";
import { renderRecipeResponse } from "../../../../outbound/slack/recipeResponse.js";
import type { SlackCardWrapper } from "../../../../outbound/slack/types.js";

const wrapper: SlackCardWrapper = { blocks: [], color: "#7c3aed", fallback: "recipe response" };

const anchor = {
  idempotencyKey: "slot-key-1",
  runId: "run-1",
  slotHash: "abc123",
  targetChannel: "C0123",
};

describe("sdkRecipeResponseMetadata", () => {
  it("omits targetThreadTs entirely for a top-level target", () => {
    const payload = renderRecipeResponse({ anchor: { ...anchor, targetThreadTs: undefined }, wrapper });
    // The falsifiable half: the rendered payload really carries the key, explicitly undefined.
    expect(Object.keys(payload.metadata.event_payload)).toEqual([
      "idempotencyKey",
      "renderer",
      "runId",
      "schemaVersion",
      "slotHash",
      "targetChannel",
      "targetThreadTs",
    ]);
    const metadata = sdkRecipeResponseMetadata({ metadata: payload.metadata });
    expect(metadata).toStrictEqual({
      event_payload: {
        idempotencyKey: "slot-key-1",
        renderer: "slack-recipe-response-v1",
        runId: "run-1",
        schemaVersion: 1,
        slotHash: "abc123",
        targetChannel: "C0123",
      },
      event_type: "slopweaver_recipe_response_v1",
    });
    expect(Object.keys(metadata.event_payload)).toEqual([
      "idempotencyKey",
      "renderer",
      "runId",
      "schemaVersion",
      "slotHash",
      "targetChannel",
    ]);
  });

  it("preserves targetThreadTs and every other anchor field for a threaded target", () => {
    const payload = renderRecipeResponse({ anchor: { ...anchor, targetThreadTs: "1726000000.000100" }, wrapper });
    expect(sdkRecipeResponseMetadata({ metadata: payload.metadata })).toStrictEqual({
      event_payload: {
        idempotencyKey: "slot-key-1",
        renderer: "slack-recipe-response-v1",
        runId: "run-1",
        schemaVersion: 1,
        slotHash: "abc123",
        targetChannel: "C0123",
        targetThreadTs: "1726000000.000100",
      },
      event_type: "slopweaver_recipe_response_v1",
    });
  });

  it("builds a fresh object rather than handing the payload's own metadata through", () => {
    const payload = renderRecipeResponse({ anchor: { ...anchor, targetThreadTs: "1.2" }, wrapper });
    const metadata = sdkRecipeResponseMetadata({ metadata: payload.metadata });
    expect(metadata).not.toBe(payload.metadata);
    expect(metadata.event_payload).not.toBe(payload.metadata.event_payload);
  });
});
