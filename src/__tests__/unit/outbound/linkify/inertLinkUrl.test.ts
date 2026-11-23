import { describe, expect, it } from "vitest";

import { isInertLinkUrl } from "../../../../outbound/linkify/inertLinkUrl.js";

/** U+2028, built rather than typed: a literal one in source splits the line for some readers. */
const LINE_SEPARATOR = String.fromCodePoint(0x2028);

describe("isInertLinkUrl", () => {
  it("accepts the http(s) URLs a reference resolves to, query and fragment included", () => {
    const urls = [
      "https://github.com/acme/widget/issues/10",
      "https://linear.app/acme/issue/ENG-12",
      "http://example.test/controls?id=HRS-52&tab=tests#top",
    ];
    expect(urls.map((url) => isInertLinkUrl({ url }))).toEqual([true, true, true]);
  });

  it("refuses every character that ends a link or opens markup, any whitespace, and a non-web scheme", () => {
    const breaking = [")", "(", "<", ">", "[", "]", "\\", "`", "|", '"', " ", "\n", LINE_SEPARATOR];
    const urls = [
      ...breaking.map((char) => `https://example.test/a${char}b`),
      "javascript:alert(1)",
      "mailto:a@b.test",
    ];
    expect(urls.map((url) => isInertLinkUrl({ url }))).toEqual(urls.map(() => false));
  });
});
