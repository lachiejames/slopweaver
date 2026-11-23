/*
 * The pull request card key the console mints and the one `talk land` and `handover currency` read are one grammar.
 *
 * `site/lib/prCardKey.ts` restates `src/talk/prCardKey.ts` because a file under `site/` may not import one under
 * `src/`; this file, in the lane that reaches both roots, drives one table through both so a change to either that
 * the other misses fails here.
 */

import { describe, expect, it } from "vitest";

import { prCardKeyParts as prCardKeyPartsSrc, prCardKey as prCardKeySrc } from "../../../src/talk/prCardKey";
import { prCardKey, prCardKeyOf, prCardKeyParts } from "../../lib/prCardKey";

const SLUGS = [
  { number: 42, repoSlug: "acme/widgets" },
  { number: 42, repoSlug: "acme/acme-admin" },
  { number: 18277, repoSlug: "acme/widgets.api" },
  { number: 7, repoSlug: "Acme-Co/my_repo.v2.js" },
];

const KEYS = [
  "pr:acme.widgets.42",
  "pr:acme.widgets.api.18277",
  "pr:18277",
  "pr:acme.widgets.018277",
  "pr:acme.widgets.0",
  "pr:acme.18277",
  "pr:.widgets.1",
  "pr:acme..1",
  "pr:acme.widgets.x1",
  "pr:acme.widgets.9007199254740993",
  "pr:owner/repo#12",
  "ask:acme.widgets.1",
];

describe("prCardKey", () => {
  it("mints the same key on both sides, distinct for two repositories' same number", () => {
    const minted = SLUGS.map((slug) => prCardKey(slug));
    expect(minted).toEqual([
      "pr:acme.widgets.42",
      "pr:acme.acme-admin.42",
      "pr:acme.widgets.api.18277",
      "pr:Acme-Co.my_repo.v2.js.7",
    ]);
    expect(SLUGS.map((slug) => prCardKeySrc(slug))).toEqual(minted);
  });
});

describe("prCardKeyParts", () => {
  it("reads every key the same way on both sides, and round-trips every minted one", () => {
    const read = KEYS.map((key) => prCardKeyParts({ key }));
    expect(read).toEqual([
      { number: 42, repoSlug: "acme/widgets" },
      { number: 18277, repoSlug: "acme/widgets.api" },
      ...KEYS.slice(2).map(() => undefined),
    ]);
    expect(KEYS.map((key) => prCardKeyPartsSrc({ key }))).toEqual(read);
    expect(SLUGS.map((slug) => prCardKeyParts({ key: prCardKey(slug) }))).toEqual(SLUGS);
  });
});

describe("prCardKeyOf", () => {
  it("mints a key only when it reads back as the same pull request, never one another pull request owns", () => {
    expect(SLUGS.map((slug) => prCardKeyOf(slug))).toEqual(SLUGS.map((slug) => prCardKey(slug)));
    // `acme/widgets`'s `#N.5` would mint `acme/widgets.N`'s `#5`; the rest name no canonical pull request at all.
    const fractional = { number: 42.5, repoSlug: "acme/widgets" };
    const ambiguous = [
      fractional,
      { number: 0, repoSlug: "acme/widgets" },
      { number: -3, repoSlug: "acme/widgets" },
      { number: 7, repoSlug: "widgets" },
    ];
    expect(prCardKey(fractional)).toBe(prCardKey({ number: 5, repoSlug: "acme/widgets.42" }));
    expect(ambiguous.map((slug) => prCardKeyOf(slug))).toEqual([undefined, undefined, undefined, undefined]);
  });
});
