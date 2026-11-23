import { describe, expect, it } from "vitest";

import { githubReviewStateUsage } from "../../../../../cli/commands/github/reportUsage.js";
import {
  buildReviewStateQuery,
  parseGithubReviewStateArgs,
} from "../../../../../cli/commands/github/reviewStateCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseGithubReviewStateArgs", () => {
  it("defaults to no repository, drafts excluded and the live Slack leg ON", () => {
    const args = unwrap(parseGithubReviewStateArgs({ rest: [] }));
    expect(args.repos).toEqual([]);
    expect(args.includeDrafts).toBe(false);
    expect(args.slackLive).toBe(true);
    expect(args.limit).toBe(100);
  });

  it("splits a comma-separated --repo into slugs", () => {
    const args = unwrap(parseGithubReviewStateArgs({ rest: ["--repo", "a/b, c/d"] }));
    expect(args.repos).toEqual(["a/b", "c/d"]);
  });

  it("refuses a --repo that is not owner/name", () => {
    const parsed = parseGithubReviewStateArgs({ rest: ["--repo", "justaname"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()).toEqual(["--repo takes one or more comma-separated owner/name slugs"]);
  });

  it("turns the live Slack leg off with --no-slack-live", () => {
    expect(unwrap(parseGithubReviewStateArgs({ rest: ["--no-slack-live"] })).slackLive).toBe(false);
  });

  it("never asks for a page larger than the limit", () => {
    expect(unwrap(parseGithubReviewStateArgs({ rest: ["--limit", "5"] })).pageSize).toBe(5);
  });

  it("refuses a --limit that is not a positive whole number", () => {
    const parsed = parseGithubReviewStateArgs({ rest: ["--limit", "0"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()).toEqual(["--limit must be a positive whole number"]);
  });

  it("refuses an unknown flag by name", () => {
    const parsed = parseGithubReviewStateArgs({ rest: ["--nope"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()).toEqual(["unknown flag: --nope"]);
  });
});

describe("buildReviewStateQuery", () => {
  it("scopes to open pull requests, excluding drafts on the server", () => {
    expect(buildReviewStateQuery({ author: undefined, includeDrafts: false, repos: ["o/r"] })).toBe(
      "is:pr is:open sort:updated-desc repo:o/r draft:false",
    );
  });

  it("spans two repositories in one query", () => {
    expect(buildReviewStateQuery({ author: "me", includeDrafts: true, repos: ["o/a", "o/b"] })).toBe(
      "is:pr is:open sort:updated-desc repo:o/a repo:o/b author:me",
    );
  });

  it("asks the server for drafts alone under draftsOnly, so no ready pull request spends the read", () => {
    expect(buildReviewStateQuery({ author: "@me", draftsOnly: true, includeDrafts: true, repos: ["o/r"] })).toBe(
      "is:pr is:open sort:updated-desc repo:o/r author:@me draft:true",
    );
  });
});

describe("githubReviewStateUsage", () => {
  it("documents every flag the parser accepts", () => {
    const usage = githubReviewStateUsage();
    for (const flag of ["--repo", "--author", "--include-drafts", "--no-slack-live", "--limit", "--json", "--home"]) {
      expect(usage).toContain(flag);
    }
  });
});

describe("--number and --detail", () => {
  it("parses one pull request by number and implies --detail", () => {
    const args = unwrap(parseGithubReviewStateArgs({ rest: ["--repo", "o/n", "--number", "16415"] }));
    expect(args.number).toBe(16415);
    expect(args.detail).toBe(true);
  });

  it("takes --detail on its own, without a number", () => {
    const args = unwrap(parseGithubReviewStateArgs({ rest: ["--detail"] }));
    expect(args.detail).toBe(true);
    expect(args.number).toBe(undefined);
  });

  it("leaves both off by default, so the fleet read never pays for comment bodies", () => {
    const args = unwrap(parseGithubReviewStateArgs({ rest: [] }));
    expect(args.detail).toBe(false);
    expect(args.number).toBe(undefined);
  });

  // --number reads through repository.pullRequest, which needs exactly one owner/name to address.
  it("refuses --number with no --repo, naming what it needs", () => {
    const parsed = parseGithubReviewStateArgs({ rest: ["--number", "16415"] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()).toContain(
      "--number names one pull request, so it needs exactly one --repo <owner/name>",
    );
  });

  it("refuses --number with two repositories", () => {
    const parsed = parseGithubReviewStateArgs({ rest: ["--repo", "o/a,o/b", "--number", "1"] });
    expect(unwrapErr(parsed)).toEqual(["--number names one pull request, so it needs exactly one --repo <owner/name>"]);
  });

  it("refuses a --number that is not a positive whole number", () => {
    const parsed = parseGithubReviewStateArgs({ rest: ["--repo", "o/n", "--number", "-3"] });
    expect(unwrapErr(parsed)).toEqual(["--number must be a positive whole number"]);
  });
});
