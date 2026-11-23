/*
 * The leaves of the visible-prose walk, read directly: a value reduced to text, what counts as invisible, the append
 * that refuses a blank fragment, and how one rich-text leaf renders. The rest of this folder reaches them through
 * `flattenSlackVisibleProse`.
 */
import { describe, expect, it } from "vitest";

import { invisible, push, richLeaf, str } from "../../../../../corpus/slack/visibleProseLeaves.js";

/** What one rich-text leaf appends to an empty fragment list. */
function renderLeaf({ node }: { node: Record<string, unknown> }): readonly string[] {
  const out: string[] = [];
  richLeaf({ node, out });
  return out;
}

/** What one value appends to an empty fragment list. */
function pushed({ value }: { value: unknown }): readonly string[] {
  const out: string[] = [];
  push({ out, value });
  return out;
}

describe("str", () => {
  it("keeps a string, an empty one included", () => {
    expect(str({ value: "hello" })).toBe("hello");
    expect(str({ value: "" })).toBe("");
  });

  it("answers undefined for anything that is not a string", () => {
    expect(str({ value: 5 })).toBeUndefined();
    expect(str({ value: { text: "hello" } })).toBeUndefined();
    expect(str({ value: undefined })).toBeUndefined();
  });
});

describe("invisible", () => {
  it("calls absent, empty and whitespace-only text invisible", () => {
    expect(invisible({ text: undefined })).toBe(true);
    expect(invisible({ text: "" })).toBe(true);
    expect(invisible({ text: " \t\n" })).toBe(true);
  });

  it("calls a zero-width space, a blank letter-category glyph and a lone combining mark invisible", () => {
    expect(invisible({ text: "\u200B" })).toBe(true);
    expect(invisible({ text: "\u3164" })).toBe(true);
    expect(invisible({ text: "\u0301" })).toBe(true);
  });

  it("calls a base character visible, with or without marks beside it", () => {
    expect(invisible({ text: "cafe" })).toBe(false);
    expect(invisible({ text: "cafe\u0301" })).toBe(false);
    expect(invisible({ text: "\u200Bhello" })).toBe(false);
  });

  it("leaves the known blank-glyph exception visible", () => {
    expect(invisible({ text: "\u2800" })).toBe(false);
  });
});

describe("push", () => {
  it("appends a bare string and a composition object's text", () => {
    expect(pushed({ value: "hello" })).toStrictEqual(["hello"]);
    expect(pushed({ value: { text: "hello", type: "plain_text" } })).toStrictEqual(["hello"]);
  });

  it("appends nothing for invisible text, a non-string text field or a value that is neither", () => {
    expect(pushed({ value: "\u200B" })).toStrictEqual([]);
    expect(pushed({ value: { text: 5, type: "plain_text" } })).toStrictEqual([]);
    expect(pushed({ value: 5 })).toStrictEqual([]);
  });
});

describe("richLeaf", () => {
  it("renders an emoji from its name, and nothing from a blank one", () => {
    expect(renderLeaf({ node: { name: "wave", type: "emoji" } })).toStrictEqual([":wave:"]);
    expect(renderLeaf({ node: { name: "\u200B", type: "emoji" } })).toStrictEqual([]);
  });

  it("emits a mention as the markup the resolver reads", () => {
    expect(renderLeaf({ node: { type: "user", user_id: "U1" } })).toStrictEqual(["<@U1>"]);
    expect(renderLeaf({ node: { channel_id: "C1", type: "channel" } })).toStrictEqual(["<#C1>"]);
    expect(renderLeaf({ node: { range: "here", type: "broadcast" } })).toStrictEqual(["<!here>"]);
  });

  it("renders a usergroup as the generic, and a mention with no id as nothing", () => {
    expect(renderLeaf({ node: { type: "usergroup", usergroup_id: "S1" } })).toStrictEqual(["@group"]);
    expect(renderLeaf({ node: { type: "usergroup" } })).toStrictEqual([]);
    expect(renderLeaf({ node: { type: "user" } })).toStrictEqual([]);
  });

  it("prefers a link's label and falls back to its url", () => {
    expect(renderLeaf({ node: { text: "the docs", type: "link", url: "https://x.test" } })).toStrictEqual(["the docs"]);
    expect(renderLeaf({ node: { type: "link", url: "https://x.test" } })).toStrictEqual(["https://x.test"]);
  });

  it("emits a text leaf as it stands, and nothing for a leaf carrying no text", () => {
    expect(renderLeaf({ node: { text: " spaced ", type: "text" } })).toStrictEqual([" spaced "]);
    expect(renderLeaf({ node: { type: "text" } })).toStrictEqual([]);
  });
});
