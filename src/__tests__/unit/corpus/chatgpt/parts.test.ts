/**
 * What one part of a ChatGPT message carries: a typed string, a spoken turn's transcription, the recording beside it,
 * or anything else named by its kind — and nothing at all for a value that is neither.
 */
import { describe, expect, it } from "vitest";

import { classifyChatgptPart } from "../../../../corpus/chatgpt/parts.js";

describe("classifyChatgptPart", () => {
  it("reads a string part as typed words", () => {
    expect(classifyChatgptPart({ part: "hello" })).toEqual({ kind: "words", spoken: false, text: "hello" });
  });

  it("reads a transcription as spoken words, and its recording as a recording", () => {
    expect(classifyChatgptPart({ part: { content_type: "audio_transcription", text: "said aloud" } })).toEqual({
      kind: "words",
      spoken: true,
      text: "said aloud",
    });
    expect(classifyChatgptPart({ part: { content_type: "audio_asset_pointer" } })).toEqual({
      contentType: "audio_asset_pointer",
      kind: "recording",
    });
    expect(classifyChatgptPart({ part: { content_type: "real_time_user_audio_video_asset_pointer" } })).toEqual({
      contentType: "real_time_user_audio_video_asset_pointer",
      kind: "recording",
    });
  });

  it("names any other typed part by its kind, a transcription without text included", () => {
    expect(classifyChatgptPart({ part: { content_type: "image_asset_pointer" } })).toEqual({
      contentType: "image_asset_pointer",
      kind: "other",
    });
    expect(classifyChatgptPart({ part: { content_type: "audio_transcription" } })).toEqual({
      contentType: "audio_transcription",
      kind: "other",
    });
  });

  it("classifies nothing for a part that is neither a string nor a typed object", () => {
    expect([null, 7, {}, ["x"]].map((part) => classifyChatgptPart({ part }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("classifies nothing for a content type that is not a string, never coercing one into a known kind", () => {
    const parts = [
      { content_type: ["image_asset_pointer"], text: "words silently lost" },
      { content_type: 7 },
      { content_type: null },
    ];
    expect(parts.map((part) => classifyChatgptPart({ part }))).toEqual([undefined, undefined, undefined]);
  });
});
