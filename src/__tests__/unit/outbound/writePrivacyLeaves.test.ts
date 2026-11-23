/**
 * The payload walk every write transport's privacy guard shares: string leaves under their field paths, a skipped
 * key skipped wherever the provider says, a cycle walked once. Synthetic values only.
 */
import { describe, expect, it } from "vitest";

import { payloadLeaves } from "../../../outbound/writePrivacyLeaves.js";

describe("payloadLeaves", () => {
  it("names each string by its path, through objects and lists, and skips numbers, booleans and nulls", () => {
    const value = { blocks: [{ text: { text: "hello acme", type: "mrkdwn" } }], count: 3, done: false, note: null };
    expect(payloadLeaves({ path: "", skipKey: () => false, value })).toEqual([
      { path: "blocks[0].text.text", text: "hello acme" },
      { path: "blocks[0].text.type", text: "mrkdwn" },
    ]);
  });

  it("skips a key at the depth the provider names, and keeps the same key deeper", () => {
    const value = { url: "/top", variables: { url: "https://zorvane.example/notes" } };
    expect(payloadLeaves({ path: "", skipKey: ({ key, depth }) => depth === 0 && key === "url", value })).toEqual([
      { path: "variables.url", text: "https://zorvane.example/notes" },
    ]);
  });

  it("skips a key at every depth when the provider says so, with everything under it", () => {
    const value = { channel: "C0FIXTURE", elements: [{ channel: { id: "C0FIXTURE" }, text: "for quillfeather" }] };
    expect(payloadLeaves({ path: "", skipKey: ({ key }) => key === "channel", value })).toEqual([
      { path: "elements[0].text", text: "for quillfeather" },
    ]);
  });

  it("walks a cyclic value once, and finds nothing in a bare number", () => {
    const loop: Record<string, unknown> = { note: "once" };
    loop["self"] = loop;
    expect(payloadLeaves({ path: "", skipKey: () => false, value: loop })).toEqual([{ path: "note", text: "once" }]);
    expect(payloadLeaves({ path: "", skipKey: () => false, value: 7 })).toEqual([]);
  });

  it("answers a bare string under the path it was handed", () => {
    expect(payloadLeaves({ path: "text", skipKey: () => false, value: "hi" })).toEqual([{ path: "text", text: "hi" }]);
  });
});
