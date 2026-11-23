/** {@link latestContextDepth} and {@link depthVerdict} — pure, folding transcript text with no filesystem. */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DEPTH_REVIEW_THRESHOLD_TOKENS,
  depthVerdict,
  latestContextDepth,
} from "../../../sessions/tokenDepth.js";

/** One transcript line carrying a turn's usage, shaped exactly as Claude Code writes it. */
function usageLine({
  id,
  input,
  cacheRead,
  cacheCreation,
  model = "claude-opus-5",
}: {
  id: string;
  input: number;
  cacheRead: number;
  cacheCreation: number;
  model?: string;
}): string {
  return JSON.stringify({
    message: {
      id,
      model,
      usage: {
        cache_creation_input_tokens: cacheCreation,
        cache_read_input_tokens: cacheRead,
        input_tokens: input,
        output_tokens: 120,
      },
    },
    type: "assistant",
  });
}

describe("latestContextDepth", () => {
  it("sums every tier the newest turn was handed", () => {
    const text = usageLine({ cacheCreation: 300, cacheRead: 5_000, id: "msg_1", input: 12 });

    const read = latestContextDepth({ fromStart: true, text });

    expect(read).toEqual({ depth: { depthTokens: 5_312, messageId: "msg_1", model: "claude-opus-5" } });
  });

  it("takes the NEWEST turn, not the deepest — a compaction must show as a drop", () => {
    const text = [
      usageLine({ cacheCreation: 0, cacheRead: 600_000, id: "msg_deep", input: 0 }),
      usageLine({ cacheCreation: 0, cacheRead: 40_000, id: "msg_after_compaction", input: 0 }),
    ].join("\n");

    const read = latestContextDepth({ fromStart: true, text });

    expect(read).toEqual({
      depth: { depthTokens: 40_000, messageId: "msg_after_compaction", model: "claude-opus-5" },
    });
  });

  it("names the model that served the newest turn", () => {
    const text = usageLine({ cacheCreation: 0, cacheRead: 1, id: "msg_1", input: 0, model: "claude-fable-5" });

    expect(latestContextDepth({ fromStart: true, text })).toEqual({
      depth: { depthTokens: 1, messageId: "msg_1", model: "claude-fable-5" },
    });
  });

  it("drops the first line of a tail that began mid-file, because it may be a fragment", () => {
    const complete = usageLine({ cacheCreation: 0, cacheRead: 7_000, id: "msg_whole", input: 0 });
    const text = `read_input_tokens":999999}}}\n${complete}`;

    expect(latestContextDepth({ fromStart: false, text })).toEqual({
      depth: { depthTokens: 7_000, messageId: "msg_whole", model: "claude-opus-5" },
    });
  });

  it("reads the first line when the text really does start at byte 0", () => {
    const text = usageLine({ cacheCreation: 0, cacheRead: 9, id: "msg_first", input: 0 });

    expect(latestContextDepth({ fromStart: true, text })).toEqual({
      depth: { depthTokens: 9, messageId: "msg_first", model: "claude-opus-5" },
    });
  });

  it("ignores lines that carry no usage at all", () => {
    const text = [
      usageLine({ cacheCreation: 0, cacheRead: 3_000, id: "msg_1", input: 0 }),
      JSON.stringify({ leafUuid: "x", type: "last-prompt" }),
      JSON.stringify({ mode: "normal", type: "mode" }),
    ].join("\n");

    expect(latestContextDepth({ fromStart: true, text })).toEqual({
      depth: { depthTokens: 3_000, messageId: "msg_1", model: "claude-opus-5" },
    });
  });

  it("reports why rather than reporting zero when the tail holds no turn", () => {
    const read = latestContextDepth({ fromStart: true, text: JSON.stringify({ mode: "normal", type: "mode" }) });

    expect(read).toEqual({
      why: "no complete assistant turn was found in the last 1048576 bytes of the transcript",
    });
  });

  it("reports why for empty text", () => {
    expect(latestContextDepth({ fromStart: true, text: "" })).toEqual({
      why: "no complete assistant turn was found in the last 1048576 bytes of the transcript",
    });
  });
});

describe("depthVerdict", () => {
  it("flags a session at exactly the threshold", () => {
    expect(depthVerdict({ depthTokens: 300_000, thresholdTokens: 300_000 })).toBe("review");
  });

  it("does not flag one a single token under it", () => {
    expect(depthVerdict({ depthTokens: 299_999, thresholdTokens: 300_000 })).toBe("under-threshold");
  });

  it("flags one well past it", () => {
    expect(depthVerdict({ depthTokens: 625_931, thresholdTokens: 300_000 })).toBe("review");
  });

  it("does not flag a session that has just started", () => {
    expect(depthVerdict({ depthTokens: 0, thresholdTokens: DEFAULT_DEPTH_REVIEW_THRESHOLD_TOKENS })).toBe(
      "under-threshold",
    );
  });

  it("takes the bottom of the skill's own 300–400k band as its default", () => {
    expect(DEFAULT_DEPTH_REVIEW_THRESHOLD_TOKENS).toBe(600_000);
  });
});
