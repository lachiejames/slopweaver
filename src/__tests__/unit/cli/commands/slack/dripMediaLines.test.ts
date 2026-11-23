import { describe, expect, it } from "vitest";

import { dripMediaLines, mediaStepsFor } from "../../../../../cli/commands/slack/dripMediaLines.js";

describe("dripMediaLines", () => {
  it("says nothing for a drip with no media", () => {
    expect(dripMediaLines({ count: 3, media: [] })).toEqual([]);
  });

  it("names each file by its basename, under the last message", () => {
    expect(dripMediaLines({ count: 3, media: ["/shots/before.png", "/shots/after.png"] })).toEqual([
      "media: 2 file(s) — before.png, after.png — attached UNDER message 3/3, the last one",
    ]);
  });
});

describe("mediaStepsFor", () => {
  it("adds no steps to a message carrying no media", () => {
    expect(mediaStepsFor({ media: [] })).toEqual([]);
  });

  it("names the upload, the attach and the read-back for a message carrying media", () => {
    expect(mediaStepsFor({ media: ["/shots/a.png", "/shots/b.png"] })).toEqual([
      "     ↳ files.uploadV2 ×2 (private, before the post — an unreadable path fails before anything is said)",
      "     ↳ chat.update file_ids=2 — the files land under this message's own text",
      "     ↳ read-back — a count that disagrees DELETES this message rather than leaving it evidence-free",
    ]);
  });
});
