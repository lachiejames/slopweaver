/**
 * Two declared pages cannot legitimately be the same picture, so BOTH lose the screenshot claim — the Notion walk
 * once reported twenty-one pages photographed when all twenty-one shots were one not-found shell.
 */
import { describe, expect, it } from "vitest";

import { withdrawIndistinguishableShots } from "../../../../atlas/kit/indistinguishableShots.js";

interface Page {
  readonly name: string;
  readonly artifacts: readonly { readonly sha256: string }[];
  readonly withdrawn: string | null;
}

const page = ({ name, shas }: { name: string; shas: readonly string[] }): Page => ({
  artifacts: shas.map((sha256) => ({ sha256 })),
  name,
  withdrawn: null,
});

const withdraw = ({ page: target, reason }: { page: Page; reason: string }): Page => ({
  ...target,
  artifacts: [],
  withdrawn: reason,
});

describe("withdrawIndistinguishableShots", () => {
  it("withdraws the claim from BOTH pages sharing a digest, with the caller's reason, and leaves the rest alone", () => {
    const pages = [
      page({ name: "billing", shas: ["aaa"] }),
      page({ name: "members", shas: ["bbb"] }),
      page({ name: "security", shas: ["aaa"] }),
    ];

    const result = withdrawIndistinguishableShots({ pages, reason: "the not-found shell", withdraw });

    expect(result.map((entry) => [entry.name, entry.withdrawn, entry.artifacts.length])).toEqual([
      ["billing", "the not-found shell", 0],
      ["members", null, 1],
      ["security", "the not-found shell", 0],
    ]);
  });

  it("withdraws a page when any ONE of its artifacts is shared, not only its first", () => {
    const pages = [page({ name: "a", shas: ["x", "shared"] }), page({ name: "b", shas: ["shared"] })];

    const result = withdrawIndistinguishableShots({ pages, reason: "sign-in page", withdraw });

    expect(result.map((entry) => entry.withdrawn)).toEqual(["sign-in page", "sign-in page"]);
  });

  it("keeps a page that repeats its OWN picture, since no other page shares it", () => {
    const pages = [page({ name: "a", shas: ["x", "x"] }), page({ name: "b", shas: ["y"] })];

    const result = withdrawIndistinguishableShots({ pages, reason: "unused", withdraw });

    expect(result.map((entry) => entry.withdrawn)).toEqual([null, null]);
  });

  it("leaves every page as it was when nothing is shared, a page with no shots included", () => {
    const pages = [page({ name: "a", shas: ["x"] }), page({ name: "b", shas: [] })];

    const result = withdrawIndistinguishableShots({ pages, reason: "unused", withdraw });

    expect(result).toEqual(pages);
  });

  it("returns an empty list for no pages", () => {
    expect(withdrawIndistinguishableShots({ pages: [], reason: "unused", withdraw })).toEqual([]);
  });
});
