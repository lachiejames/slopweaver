import { describe, expect, it } from "vitest";

import { goldDebtId, matchesPullRequest, parsePullRequestUrl } from "../../../goldDebt/pull.js";

describe("parsePullRequestUrl", () => {
  it("splits a github pull-request URL into its owner, repo and number", () => {
    const parsed = parsePullRequestUrl({ url: "https://github.com/octo-self/slopweaver/pull/872" })!;
    expect(parsed.owner).toBe("octo-self");
    expect(parsed.repo).toBe("slopweaver");
    expect(parsed.number).toBe(872);
    expect(parsed.debtId).toBe("octo-self/slopweaver#872");
  });

  it("keeps the URL exactly as it was written, so a row's identity is its own text", () => {
    const parsed = parsePullRequestUrl({ url: "https://github.com/octo-self/slopweaver/pull/872" })!;
    expect(parsed.url).toBe("https://github.com/octo-self/slopweaver/pull/872");
  });

  it("refuses two URLs separated by a space, which `new URL` would percent-encode into one dead link", () => {
    const joined = "https://github.com/octo-self/slopweaver/pull/872 https://github.com/octo-self/slopweaver/pull/857";
    expect(parsePullRequestUrl({ url: joined })).toBe(undefined);
  });

  it("refuses a single-slash scheme, whose stored href resolves against the reading page's own host", () => {
    expect(parsePullRequestUrl({ url: "https:/github.com/octo-self/slopweaver/pull/872" })).toBe(undefined);
  });

  it("refuses an issue URL, because an issue is not a pull request", () => {
    expect(parsePullRequestUrl({ url: "https://github.com/octo-self/slopweaver/issues/872" })).toBe(undefined);
  });

  it("refuses a bare number", () => {
    expect(parsePullRequestUrl({ url: "#872" })).toBe(undefined);
  });

  it("refuses a repo#number key, which is the DERIVED spelling rather than the stored one", () => {
    expect(parsePullRequestUrl({ url: "octo-self/slopweaver#872" })).toBe(undefined);
  });

  it("refuses http, so a stored identity is never downgraded", () => {
    expect(parsePullRequestUrl({ url: "http://github.com/octo-self/slopweaver/pull/872" })).toBe(undefined);
  });

  it("refuses another host wearing the same path", () => {
    expect(parsePullRequestUrl({ url: "https://github.example.com/octo-self/slopweaver/pull/872" })).toBe(undefined);
  });

  it("refuses a leading zero, so one pull request has exactly one spelling", () => {
    expect(parsePullRequestUrl({ url: "https://github.com/octo-self/slopweaver/pull/0872" })).toBe(undefined);
  });

  it("refuses a trailing segment, which names a review or a file rather than the pull request", () => {
    expect(parsePullRequestUrl({ url: "https://github.com/octo-self/slopweaver/pull/872/files" })).toBe(undefined);
  });

  it("refuses the empty string", () => {
    expect(parsePullRequestUrl({ url: "" })).toBe(undefined);
  });
});

describe("goldDebtId", () => {
  it("derives the key a reader refers to a debt by", () => {
    expect(goldDebtId({ pullRequest: "https://github.com/octo-self/slopweaver/pull/857" })).toBe(
      "octo-self/slopweaver#857",
    );
  });

  it("hands back an unparseable value unchanged, so a display path never throws", () => {
    expect(goldDebtId({ pullRequest: "not a url" })).toBe("not a url");
  });
});

describe("matchesPullRequest", () => {
  it("matches the full URL", () => {
    const matched = matchesPullRequest({
      pullRequest: "https://github.com/octo-self/slopweaver/pull/872",
      reference: "https://github.com/octo-self/slopweaver/pull/872",
    });
    expect(matched).toBe(true);
  });

  it("matches the derived key, so a reader can settle by what the list printed", () => {
    const matched = matchesPullRequest({
      pullRequest: "https://github.com/octo-self/slopweaver/pull/872",
      reference: "octo-self/slopweaver#872",
    });
    expect(matched).toBe(true);
  });

  it("does not match a different number in the same repository", () => {
    const matched = matchesPullRequest({
      pullRequest: "https://github.com/octo-self/slopweaver/pull/872",
      reference: "octo-self/slopweaver#857",
    });
    expect(matched).toBe(false);
  });

  it("does not match the same number in a different repository", () => {
    const matched = matchesPullRequest({
      pullRequest: "https://github.com/octo-self/slopweaver/pull/872",
      reference: "acme/acme-admin#872",
    });
    expect(matched).toBe(false);
  });
});

describe("one merge is one key, whatever case the caller typed", () => {
  it("derives the same key from two spellings GitHub resolves to one repository", () => {
    const lower = goldDebtId({ pullRequest: "https://github.com/octo-self/slopweaver/pull/872" });
    const upper = goldDebtId({ pullRequest: "https://github.com/Octo-Self/SlopWeaver/pull/872" });
    expect(upper).toBe("octo-self/slopweaver#872");
    expect(upper).toBe(lower);
  });

  it("keeps the URL exactly as it was written, so the link a reader opens is the one that was recorded", () => {
    const parsed = parsePullRequestUrl({ url: "https://github.com/Octo-Self/SlopWeaver/pull/872" })!;
    expect(parsed.url).toBe("https://github.com/Octo-Self/SlopWeaver/pull/872");
    expect(parsed.owner).toBe("Octo-Self");
  });

  it("finds a row by a key typed in the owner's display case", () => {
    const matched = matchesPullRequest({
      pullRequest: "https://github.com/octo-self/slopweaver/pull/872",
      reference: "Octo-Self/SlopWeaver#872",
    });
    expect(matched).toBe(true);
  });

  it("still tells two different pull requests apart", () => {
    const matched = matchesPullRequest({
      pullRequest: "https://github.com/octo-self/slopweaver/pull/872",
      reference: "Octo-Self/SlopWeaver#873",
    });
    expect(matched).toBe(false);
  });
});
