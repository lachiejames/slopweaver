import { describe, expect, it } from "vitest";
import { releaseMediaLines, servedMedia } from "../../../../../../cli/commands/slack/releaseRow.js";
import { VIDEO, verifiedOf } from "./fixtures.js";

describe("servedMedia and releaseMediaLines", () => {
  const entry = verifiedOf({ record: VIDEO });
  const media = new Map([["draft-media/1/k/walkthrough.mp4", entry]]);

  it("serves the very upload object the store verified, never a fresh read", async () => {
    expect(await servedMedia({ media })({ path: "draft-media/1/k/walkthrough.mp4" })).toBe(entry.upload);
  });

  it("refuses any key that is not one of the draft's verified attachments", async () => {
    await expect(servedMedia({ media })({ path: "/etc/passwd" })).rejects.toThrow(
      "/etc/passwd is not one of this draft's verified attachments — nothing was sent",
    );
  });

  it("names each attachment's name, size and hash, and says nothing for a text-only draft", () => {
    expect(releaseMediaLines({ media })).toEqual([
      `attachment verified: walkthrough.mp4 · 2747 bytes · sha256 ${VIDEO.sha256}`,
    ]);
    expect(releaseMediaLines({ media: new Map() })).toEqual([]);
  });
});
