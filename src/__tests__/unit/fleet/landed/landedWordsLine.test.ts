/*
 * `landedWordsLine` — rendering one landed change's words as a line, quoting the owner's and marking where a quote is known
 * to be short.
 */
import { describe, expect, it } from "vitest";

import { landedWordsLine } from "../../../../fleet/landedWords.js";

describe("landedWordsLine", () => {
  it("quotes the owner's words and names every other ending by kind", () => {
    const ruling = {
      anchor: "a",
      atIso: "2026-10-05T01:28:00.000Z",
      cut: "none",
      decidedIso: undefined,
      kind: "ruling",
      recorded: "go with A",
      where: "call",
      words: "yeah, A",
    } as const;
    expect(landedWordsLine({ words: ruling })).toBe(
      'your ruling (a): you said "yeah, A" — recorded by the session as: go with A',
    );
    expect(landedWordsLine({ words: { kind: "unasked", why: "a fleet finding" } })).toBe("unasked: a fleet finding");
  });

  it("marks where a quote is known to be short, outside the owner's words", () => {
    const asked = {
      anchor: "talk:a",
      atIso: "2026-10-05T01:28:00.000Z",
      kind: "asked",
      where: "console-voice",
      words: "yeah, A",
    } as const;
    expect([
      landedWordsLine({ words: { ...asked, cut: "end" } }),
      landedWordsLine({ words: { ...asked, cut: "start" } }),
      landedWordsLine({ words: { ...asked, cut: "none" } }),
    ]).toEqual(['you said: "yeah, A"…', 'you said: …"yeah, A"', 'you said: "yeah, A"']);
  });
});
