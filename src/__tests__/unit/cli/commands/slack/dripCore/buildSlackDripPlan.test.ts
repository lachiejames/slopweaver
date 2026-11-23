/*
 * `buildSlackDripPlan`: one render pairing every message with its own key, a sequence key distinct from any
 * message's, and where the media lands — all of it on the last message, in the caller's order, moving only the
 * last message's key.
 */
import { describe, expect, it } from "vitest";

import { buildSlackDripPlan } from "../../../../../../cli/commands/slack/dripCore.js";
import { dripArtifact, NO_MENTIONS, options } from "./harness.js";

describe("buildSlackDripPlan", () => {
  it("renders once and pairs every message with its own key", () => {
    const plan = buildSlackDripPlan({
      artifact: dripArtifact({ texts: ["one", "two"] }),
      intervalMs: 1500,
      mentions: NO_MENTIONS,
      options: options({ texts: ["one", "two"] }),
    });

    expect(plan.messages.map((message) => message.index)).toEqual([0, 1]);
    expect(new Set(plan.messages.map((message) => message.duplicateKey)).size).toBe(2);
    expect(plan.intervalMs).toBe(1500);
  });

  it("gives the SEQUENCE its own key, distinct from any message's", () => {
    const plan = buildSlackDripPlan({
      artifact: dripArtifact({ texts: ["one"] }),
      intervalMs: 0,
      mentions: NO_MENTIONS,
      options: options({ texts: ["one"] }),
    });

    expect(plan.messages.map((message) => message.duplicateKey)).not.toContain(plan.duplicateKey);
  });
});

describe("buildSlackDripPlan — where the media lands", () => {
  const MEDIA = ["one.png", "two.png"];

  it("puts every file on the LAST message and none on the ones before it", () => {
    const plan = buildSlackDripPlan({
      artifact: dripArtifact({ texts: ["a", "b", "c"] }),
      intervalMs: 0,
      mentions: NO_MENTIONS,
      options: options({ media: MEDIA, texts: ["a", "b", "c"] }),
    });

    expect(plan.messages.map((message) => message.media)).toEqual([[], [], MEDIA]);
  });

  it("puts them on the only message of a one-message drip", () => {
    const plan = buildSlackDripPlan({
      artifact: dripArtifact({ texts: ["a"] }),
      intervalMs: 0,
      mentions: NO_MENTIONS,
      options: options({ media: MEDIA, texts: ["a"] }),
    });

    expect(plan.messages[0]!.media).toEqual(MEDIA);
  });

  it("preserves the caller's order exactly, and never sorts it", () => {
    const plan = buildSlackDripPlan({
      artifact: dripArtifact({ texts: ["a"] }),
      intervalMs: 0,
      mentions: NO_MENTIONS,
      options: options({ media: ["z.png", "a.png", "m.png"], texts: ["a"] }),
    });

    expect(plan.media).toEqual(["z.png", "a.png", "m.png"]);
  });

  it("gives every message an EMPTY media list when none was asked for", () => {
    const plan = buildSlackDripPlan({
      artifact: dripArtifact({ texts: ["a", "b"] }),
      intervalMs: 0,
      mentions: NO_MENTIONS,
      options: options({ texts: ["a", "b"] }),
    });

    expect(plan.messages.map((message) => message.media)).toEqual([[], []]);
    expect(plan.media).toEqual([]);
  });

  it("moves the last message's key when media is added, and leaves every earlier key alone", () => {
    const bare = buildSlackDripPlan({
      artifact: dripArtifact({ texts: ["a", "b"] }),
      intervalMs: 0,
      mentions: NO_MENTIONS,
      options: options({ texts: ["a", "b"] }),
    });
    const withMedia = buildSlackDripPlan({
      artifact: dripArtifact({ texts: ["a", "b"] }),
      intervalMs: 0,
      mentions: NO_MENTIONS,
      options: options({ media: MEDIA, texts: ["a", "b"] }),
    });

    expect(withMedia.messages[0]!.duplicateKey).toBe(bare.messages[0]!.duplicateKey);
    expect(withMedia.messages[1]!.duplicateKey).not.toBe(bare.messages[1]!.duplicateKey);
    expect(withMedia.duplicateKey).not.toBe(bare.duplicateKey);
  });
});
