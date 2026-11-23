/**
 * The pure checks `introducedFilesVia` runs on each GitHub answer, exercised directly: a pull read and a
 * comparison must name exactly what was asked, and tips must not move across a read.
 */
import { describe, expect, it } from "vitest";

import {
  headTreeShaOf,
  mergeBaseTreeShaOf,
  pullShas,
  refuseIfMoved,
} from "../../../../corpus/github/introducedFilesAnswers.js";

const PR = { number: 42, owner: "acme", repo: "widgets" };

const PULL = {
  base: { sha: "base-tip" },
  head: { sha: "head-sha" },
  url: "https://api.github.com/repos/acme/widgets/pulls/42",
};

/** A comparison answer for `base-tip...head-sha`, with `url` and `base` overridable to answer another range. */
function comparison({
  base = "base-tip",
  url = "https://api.github.com/repos/acme/widgets/compare/base-tip...head-sha",
}: {
  base?: string;
  url?: string;
} = {}): { base_commit: unknown; merge_base_commit: { commit: { tree: unknown } }; url: string } {
  return { base_commit: { sha: base }, merge_base_commit: { commit: { tree: { sha: "merge-base-tree" } } }, url };
}

/** The API base URL the default client sends every request to. */
const API = "https://api.github.com";

describe("pullShas", () => {
  it("reads the base and head SHAs from a pull read that names the requested pull", () => {
    expect(pullShas({ apiBaseUrl: API, input: PR, pull: PULL })).toEqual({ baseSha: "base-tip", headSha: "head-sha" });
  });

  it.each([
    { side: "repository", url: "https://api.github.com/repos/other/project/pulls/42" },
    { side: "number", url: "https://api.github.com/repos/acme/widgets/pulls/99" },
    { side: "host", url: "https://evil.example/repos/acme/widgets/pulls/42" },
    { side: "unparseable URL", url: "not a url" },
  ])("refuses a pull read answered for another $side", ({ url }) => {
    expect(() => pullShas({ apiBaseUrl: API, input: PR, pull: { ...PULL, url } })).toThrow(
      `GitHub answered the request for pull request #42 of acme/widgets with ${url}, so its introduced paths cannot be trusted`,
    );
  });

  it("reads a pull answered under an API base URL that carries a path of its own", () => {
    const url = "https://git.example/api/v3/repos/acme/widgets/pulls/42";
    const shas = pullShas({ apiBaseUrl: "https://git.example/api/v3", input: PR, pull: { ...PULL, url } });
    expect(shas).toEqual({ baseSha: "base-tip", headSha: "head-sha" });
  });

  it("refuses a pull answered on the right host but outside the API base URL's own path", () => {
    const url = "https://git.example/repos/acme/widgets/pulls/42";
    expect(() => pullShas({ apiBaseUrl: "https://git.example/api/v3", input: PR, pull: { ...PULL, url } })).toThrow(
      `GitHub answered the request for pull request #42 of acme/widgets with ${url}, so its introduced paths cannot be trusted`,
    );
  });

  it("refuses a pull read with no URL", () => {
    expect(() => pullShas({ apiBaseUrl: API, input: PR, pull: { base: PULL.base, head: PULL.head } })).toThrow(
      "GitHub returned no url for pull request #42",
    );
  });

  it("refuses a pull read with no head SHA", () => {
    expect(() => pullShas({ apiBaseUrl: API, input: PR, pull: { ...PULL, head: {} } })).toThrow(
      "GitHub returned no sha for pull request #42's head",
    );
  });
});

describe("refuseIfMoved", () => {
  const TIPS = { baseSha: "b", headSha: "h" };

  it("passes when the tips are unchanged", () => {
    expect(() =>
      refuseIfMoved({ number: 42, read: "its trees were", tipsAfter: { ...TIPS }, tipsBefore: TIPS }),
    ).not.toThrow();
  });

  it("refuses when the tips moved, naming both", () => {
    expect(() =>
      refuseIfMoved({ number: 42, read: "its trees were", tipsAfter: { ...TIPS, headSha: "h2" }, tipsBefore: TIPS }),
    ).toThrow(
      "pull request #42 moved from b...h to b...h2 while its trees were read, so its introduced paths cannot be trusted",
    );
  });

  it("refuses two different tip pairs that would join to the same base...head string", () => {
    expect(() =>
      refuseIfMoved({
        number: 42,
        read: "its file list was",
        tipsAfter: { baseSha: "a...b", headSha: "c" },
        tipsBefore: { baseSha: "a", headSha: "b...c" },
      }),
    ).toThrow(
      "pull request #42 moved from a...b...c to a...b...c while its file list was read, so its introduced paths cannot be trusted",
    );
  });
});

describe("mergeBaseTreeShaOf", () => {
  it("reads the merge-base tree from a comparison that answers the requested range", () => {
    const tree = mergeBaseTreeShaOf({
      apiBaseUrl: API,
      baseSha: "base-tip",
      comparison: comparison(),
      headSha: "head-sha",
      input: PR,
    });
    expect(tree).toBe("merge-base-tree");
  });

  it.each([
    { answer: { base: "other-base" }, side: "base" },
    { answer: { url: "https://api.github.com/repos/acme/widgets/compare/base-tip...other-head" }, side: "head" },
    { answer: { url: "https://api.github.com/repos/other/project/compare/base-tip...head-sha" }, side: "repository" },
    { answer: { url: "https://evil.example/repos/acme/widgets/compare/base-tip...head-sha" }, side: "host" },
  ])("refuses a comparison answered for another $side", ({ answer }) => {
    expect(() =>
      mergeBaseTreeShaOf({
        apiBaseUrl: API,
        baseSha: "base-tip",
        comparison: comparison(answer),
        headSha: "head-sha",
        input: PR,
      }),
    ).toThrow(
      "GitHub answered the comparison for pull request #42 for a different range than base-tip...head-sha, so its introduced paths cannot be trusted",
    );
  });
});

describe("headTreeShaOf", () => {
  it("answers the head commit's own tree", () => {
    const commit = { sha: "head-sha", tree: { sha: "head-tree" } };
    expect(headTreeShaOf({ commit, headSha: "head-sha", number: 42 })).toBe("head-tree");
  });

  it("refuses a commit answered for a different SHA than the head", () => {
    const commit = { sha: "other-sha", tree: { sha: "head-tree" } };
    expect(() => headTreeShaOf({ commit, headSha: "head-sha", number: 42 })).toThrow(
      "GitHub answered the head commit request for pull request #42 with a different commit than head-sha, so its introduced paths cannot be trusted",
    );
  });
});
