/**
 * A pull request's card key names its repository AND its number, and reads back one way: the owner ends at the first
 * dot, the number follows the last, and a repository keeps its own dots.
 */
import { describe, expect, it } from "vitest";

import { CARD_KEY } from "../../../talk/cardKey.js";
import { namesOneRegisterCard, prCardKey, prCardKeyParts } from "../../../talk/prCardKey.js";

describe("prCardKey", () => {
  it("mints two keys for two repositories' number 42, each a card key", () => {
    const keys = [
      prCardKey({ number: 42, repoSlug: "acme/widgets" }),
      prCardKey({ number: 42, repoSlug: "acme/acme-admin" }),
    ];
    expect(keys).toEqual(["pr:acme.widgets.42", "pr:acme.acme-admin.42"]);
    expect(keys.filter((key) => CARD_KEY.test(key))).toEqual(keys);
  });

  it("stays a card key at GitHub's longest owner (39) and repository (100) names", () => {
    const key = prCardKey({ number: Number.MAX_SAFE_INTEGER, repoSlug: `${"o".repeat(39)}/${"r".repeat(100)}` });
    expect(CARD_KEY.test(key)).toBe(true);
  });
});

describe("prCardKeyParts", () => {
  it("round-trips a dotted, hyphenated, underscored and mixed-case repository", () => {
    const slugs = ["acme/widgets.api", "Acme-Co/my_repo.v2.js", "a/b"];
    expect(slugs.map((repoSlug) => prCardKeyParts({ key: prCardKey({ number: 18277, repoSlug }) }))).toEqual(
      slugs.map((repoSlug) => ({ number: 18277, repoSlug })),
    );
  });

  it("reads no pull request from a bare number, a leading zero, a missing part, or another kind", () => {
    const keys = ["pr:18277", "pr:acme.widgets.018277", "pr:acme.widgets.0", "pr:acme.18277", "pr:.widgets.1"];
    const others = ["pr:acme..1", "pr:acme.widgets.", "pr:acme.widgets.x1", "ask:acme.widgets.1", "pr:a/b.c.1"];
    expect([...keys, ...others].map((key) => prCardKeyParts({ key }))).toEqual(
      [...keys, ...others].map(() => undefined),
    );
  });

  it("reads no pull request from a number past the safe integers", () => {
    expect(prCardKeyParts({ key: "pr:acme.widgets.9007199254740993" })).toBe(undefined);
  });
});

describe("namesOneRegisterCard", () => {
  it("passes a repository-qualified pull request and every other register card", () => {
    const keys = ["pr:acme.widgets.42", "ask:a", "hand:sign-in", "act:acme-1"];
    expect(keys.map((key) => namesOneRegisterCard({ key }))).toEqual([true, true, true, true]);
  });

  it("refuses a bare pr:<number>, a non-canonical number, an unheld kind, a malformed key and none", () => {
    const keys = ["pr:42", "pr:acme.widgets.042", "recipe:acme", "align:acme", "../etc", undefined];
    expect(keys.map((key) => namesOneRegisterCard({ key }))).toEqual([false, false, false, false, false, false]);
  });
});
