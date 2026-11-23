/*
 * `embedMarkdown`: an uploaded image is embedded as markdown with its alt text, and a video as its bare URL.
 */
import { describe, expect, it } from "vitest";

import { embedMarkdown } from "../../../../../outbound/github/attachment.js";

describe("embedMarkdown", () => {
  it("embeds an image as markdown with its alt text", () => {
    expect(embedMarkdown({ alt: "before and after", contentType: "image/png", href: "https://x/a" })).toBe(
      "![before and after](https://x/a)",
    );
  });

  it("embeds a video as a bare URL, because GitHub strips a video tag out of a pull-request body", () => {
    expect(embedMarkdown({ alt: "ignored", contentType: "video/mp4", href: "https://x/v" })).toBe("https://x/v");
  });

  it("treats quicktime and webm as video too", () => {
    expect(embedMarkdown({ alt: "a", contentType: "video/quicktime", href: "https://x/v" })).toBe("https://x/v");
    expect(embedMarkdown({ alt: "a", contentType: "video/webm", href: "https://x/v" })).toBe("https://x/v");
  });
});
