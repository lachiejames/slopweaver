import { describe, expect, it } from "vitest";

import { expansionAt, literal, patternTail, tildePattern } from "../../../admit/callStatePattern.js";
import { shellWords } from "../../../admit/shellLexing.js";

/** The one word a text lexes to. */
function word({ text }: { text: string }): ReturnType<typeof shellWords>["words"][number] {
  return shellWords({ text }).words[0]!;
}

describe("literal", () => {
  it("escapes every glob character", () => {
    expect(literal({ text: "/a/*?[x]{b}\\" })).toBe("/a/\\*\\?\\[x\\]\\{b\\}\\\\");
  });
});

describe("expansionAt", () => {
  it.each([
    { start: 0, text: '"$HOME/a/$id.jsonl"', want: 0 },
    { start: 5, text: '"$HOME/a/$id.jsonl"', want: 8 },
    { start: 0, text: "/a/$(cat ids)", want: 3 },
    { start: 0, text: "/a/`cat ids`", want: 3 },
    { start: 0, text: "/a/'$id'", want: -1 },
    { start: 0, text: "/a/b.jsonl", want: -1 },
  ])("finds the expansion in $text from $start at $want", ({ start, text, want }) => {
    expect(expansionAt({ start, word: word({ text }) })).toBe(want);
  });
});

describe("patternTail", () => {
  it.each([
    { start: 0, text: "/a/b.jsonl", want: "/a/b.jsonl" },
    { start: 0, text: "'/a/*.jsonl'", want: "/a/\\*.jsonl" },
    { start: 0, text: '/a/calls/"$id".jsonl', want: "/a/calls/*" },
    { start: 0, text: "/a/$DIR/x", want: "/a/*" },
    { start: 0, text: '"${UNSET:-live.jsonl}"', want: "*" },
    { start: 5, text: '"$HOME/talk/calls/$id.jsonl"', want: "/talk/calls/*" },
    { start: 5, text: "$HOME$X", want: "*" },
  ])("writes $text from $start as $want", ({ start, text, want }) => {
    expect(patternTail({ start, word: word({ text }) })).toBe(want);
  });
});

describe("tildePattern", () => {
  const bases = { cwd: "/w/here", oldPwd: "/w/before", user: "/u/dev" };

  it.each([
    { text: "~", want: "/u/dev" },
    { text: "~/talk/x", want: "/u/dev/talk/x" },
    { text: "~+/x", want: "/w/here/x" },
    { text: "~-/x", want: "/w/before/x" },
    { text: "~dev/.slopweaver", want: "/u/dev/.slopweaver" },
    { text: "~first.last/x", want: "/u/first.last/x" },
    { text: "~root/x", want: "/u/root/x" },
    { text: '~dev/"$id"', want: "/u/dev/*" },
  ])("writes $text as $want", ({ text, want }) => {
    expect(tildePattern({ ...bases, word: word({ text }) })).toBe(want);
  });

  it.each([
    { text: "~2/x", why: "a directory-stack entry" },
    { text: "~$U/x", why: "an expanded name" },
    { text: "~+x/x", why: "no name the shell expands" },
  ])("leaves $text unjudged: $why", ({ text }) => {
    expect(tildePattern({ ...bases, word: word({ text }) })).toBe(undefined);
  });

  it("leaves a named tilde unjudged with no home to read its sibling from", () => {
    expect(tildePattern({ cwd: "/w", oldPwd: undefined, user: undefined, word: word({ text: "~dev/x" }) })).toBe(
      undefined,
    );
  });
});
