/*
 * `contentText` — reading a form's content as plain words. It moved here when `fleet landed`'s pure-join tests were
 * split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { contentText } from "../../../../fleet/landed.js";

describe("contentText", () => {
  it("reads code, emphasis and links as their words", () => {
    expect(
      contentText({
        content: [
          { kind: "text", text: "Run " },
          { kind: "code", text: "widgets export" },
          { kind: "text", text: ", see " },
          { kind: "link", text: "the issue", url: "https://github.com/acme/widgets/issues/1" },
          { kind: "em", text: " now " },
        ],
      }),
    ).toBe("Run widgets export, see the issue now");
  });

  it("reads an image as its alt", () => {
    const image = {
      alt: "the badge row",
      kind: "image",
      url: "https://github.com/user-attachments/assets/0b6a1c2e-3d4f-4a5b-8c6d-7e8f9a0b1c2d",
      width: 800,
    } as const;
    expect(contentText({ content: [image] })).toBe("[image: the badge row]");
  });
});
