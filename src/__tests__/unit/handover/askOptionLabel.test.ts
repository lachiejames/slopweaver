import { describe, expect, it } from "vitest";

import { authoredOptionLetter } from "../../../handover/askOptionLabel.js";

describe("authoredOptionLetter", () => {
  it.each([
    ["C · keep the helper", "C"],
    ["C. keep the helper", "C"],
    ["B) a login item", "B"],
    ["A: ship it", "A"],
    ["D - wait", "D"],
    ["A – wait", "A"],
    ["B — wait", "B"],
    ["(C) a login item", "C"],
    ["  A. leading whitespace is trimmed", "A"],
  ])("reads the typed letter off %j", (text, letter) => {
    expect(authoredOptionLetter({ text })).toBe(letter);
  });

  it.each([
    "A separate app",
    "A:B testing first",
    "A.mazon's own queue",
    "E. a fifth letter no ask carries",
    "keep the helper",
    "",
  ])("reads no label off %j", (text) => {
    expect(authoredOptionLetter({ text })).toBeUndefined();
  });
});
