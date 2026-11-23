import { describe, expect, it } from "vitest";

import { readsUnresolvedText } from "../../../corpus/unresolvedText.js";

describe("readsUnresolvedText", () => {
  it("fires on each whole-word marker in the body", () => {
    const bodies = [
      "this is blocked",
      "a blocker remains",
      "blocking the deploy",
      "todo: write it",
      "moved to the backlog",
      "work in progress",
      "wip",
      "waiting on design",
      "needs review please",
      "not started yet",
    ];
    expect(bodies.map((text) => readsUnresolvedText({ text }))).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("matches regardless of case", () => {
    expect(readsUnresolvedText({ text: "BLOCKED on infra" })).toBe(true);
    expect(readsUnresolvedText({ text: "Needs Review" })).toBe(true);
  });

  it("fires on a marker carried by the title alone", () => {
    expect(readsUnresolvedText({ text: "nothing here", title: "WIP: alpha" })).toBe(true);
  });

  it("reads an undefined title as absent, not as the word undefined", () => {
    expect(readsUnresolvedText({ text: "shipped", title: undefined })).toBe(false);
  });

  it("does not fire on bare open or the words that contain it, which the loose list used to flag", () => {
    expect(readsUnresolvedText({ text: "reopened" })).toBe(false);
    expect(readsUnresolvedText({ text: "opening the file" })).toBe(false);
    expect(readsUnresolvedText({ text: "it opens" })).toBe(false);
    expect(readsUnresolvedText({ text: "the issue is open" })).toBe(false);
  });

  it("does not fire on a marker embedded in a longer ASCII word", () => {
    expect(readsUnresolvedText({ text: "unblocked now" })).toBe(false);
    expect(readsUnresolvedText({ text: "todos were done" })).toBe(false);
    expect(readsUnresolvedText({ text: "wipe the cache" })).toBe(false);
  });

  it("does fire inside a word of non-ASCII letters, because a JavaScript word boundary is ASCII-only", () => {
    expect(readsUnresolvedText({ text: "éblockedé" })).toBe(true);
  });

  it("treats punctuation around a marker as a word boundary", () => {
    expect(readsUnresolvedText({ text: "(blocked)" })).toBe(true);
    expect(readsUnresolvedText({ text: "status:wip." })).toBe(true);
  });

  it("joins the title and body with a space, so a phrase split across them still matches", () => {
    expect(readsUnresolvedText({ text: "on the vendor", title: "waiting" })).toBe(true);
  });

  it("answers false for empty input and for unrelated prose", () => {
    expect(readsUnresolvedText({ text: "" })).toBe(false);
    expect(readsUnresolvedText({ text: "merged and deployed to production", title: "release notes" })).toBe(false);
  });
});
