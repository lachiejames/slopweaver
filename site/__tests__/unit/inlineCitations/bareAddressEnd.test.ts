import { describe, expect, it } from "vitest";

import { inlineSegments } from "../../../lib/inlineCitations";

describe("where a bare address ends", () => {
  it("drops a bare address's closing punctuation as GitHub's autolink does, and keeps every character of a wrapped one", () => {
    const meant = "https://example.com/search?op=!";
    const text = `bare ${meant} and <${meant}> and [negation](${meant})`;
    expect(inlineSegments({ text })).toEqual([
      { kind: "text", text: "bare " },
      { kind: "cite", label: "example.com", url: "https://example.com/search?op=" },
      { kind: "text", text: "! and " },
      { kind: "cite", label: "example.com", url: meant },
      { kind: "text", text: " and " },
      { kind: "cite", label: "negation", url: meant },
    ]);
  });
});
