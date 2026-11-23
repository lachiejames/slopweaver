/*
 * Reading a row's declared supersession: the front-matter key, a bracketed list and the prose spelling each name a
 * slug, while a mere mention, a word that only starts with the verb, or a value that is not a slug names nothing.
 */
import { describe, expect, it } from "vitest";

import { declaredSupersedes } from "../../../../sweep/supersession.js";

describe("declaredSupersedes", () => {
  it("reads a front-matter key carrying one slug", () => {
    expect(declaredSupersedes({ text: "---\nsupersedes: old-row-1\n---\nbody\n" })).toEqual(["old-row-1"]);
  });

  it("reads a bracketed list, splitting on commas", () => {
    expect(declaredSupersedes({ text: "supersedes: [old-row-1, old-row-2]\n" })).toEqual(["old-row-1", "old-row-2"]);
  });

  it("reads the prose spelling, bullet and backticks included", () => {
    expect(declaredSupersedes({ text: "- Replaces `old-row-1`\n" })).toEqual(["old-row-1"]);
  });

  it("reads NOTHING from a mere mention, which is the whole point of the rule", () => {
    const text = "evidence: [file:///h/old-row-1.md]\n\nSee old-row-1 for the earlier attempt.\n";
    expect(declaredSupersedes({ text })).toEqual([]);
  });

  it("reads nothing from a word that merely starts with the verb", () => {
    expect(declaredSupersedes({ text: "supersedessomething old-row-1\n" })).toEqual([]);
  });

  it("drops a declared value that is not a slug", () => {
    expect(declaredSupersedes({ text: "supersedes: Some Free Text\n" })).toEqual([]);
  });
});
