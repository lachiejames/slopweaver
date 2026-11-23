import { describe, expect, it } from "vitest";

import { githubRefRefusal, isGithubRepoRef } from "../../../../outbound/linkify/githubRepoRef.js";

describe("isGithubRepoRef", () => {
  it("accepts GitHub-shaped owners and repos, a dot-led repo included", () => {
    const refs = [
      { owner: "octo-self", repo: "slopweaver" },
      { owner: "acme", repo: ".github" },
      { owner: "a1", repo: "w_i.d-g" },
    ];
    expect(refs.map((ref) => isGithubRepoRef(ref))).toEqual([true, true, true]);
  });

  // `$` without the `m` flag matches only at the end of input, so a trailing newline is refused too.
  it("refuses a bracket, an angle bracket, a slash, whitespace, an empty part or a dot-led owner", () => {
    const refs = [
      { owner: "o", repo: "r)<!--" },
      { owner: "o", repo: "r]" },
      { owner: "o/x", repo: "r" },
      { owner: "o", repo: "r w" },
      { owner: "o", repo: "r\n" },
      { owner: "", repo: "r" },
      { owner: "o", repo: "" },
      { owner: ".o", repo: "r" },
    ];
    expect(refs.map((ref) => isGithubRepoRef(ref))).toEqual(refs.map(() => false));
  });
});

describe("githubRefRefusal", () => {
  it("names the malformed repo it would have resolved against", () => {
    expect(githubRefRefusal({ named: "#1", raw: "#1", sole: { owner: "o", repo: "r)<!--" } })).toContain(
      '"#1" would resolve against "o/r)<!--", which is not a GitHub owner/repo',
    );
  });

  it("says there is no single repo when none is known or the one known is well-formed", () => {
    const refusals = [undefined, { owner: "acme", repo: "widget" }].map((sole) =>
      githubRefRefusal({ named: "#1", raw: "#1", sole }).startsWith(
        '"#1" is a bare reference (renders as #1) with no single repo',
      ),
    );
    expect(refusals).toEqual([true, true]);
  });
});
