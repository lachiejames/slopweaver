/**
 * `github bottleneck`'s argument parsing and the two defaults that are the verb's whole argument.
 *
 * The draft default gets its own case because it is INVERTED against `github landing`'s, and a default that
 * silently flipped back would hide the biggest bar in the histogram without failing anything else.
 */
import { describe, expect, it } from "vitest";

import {
  GITHUB_BOTTLENECK_FLAG_NAMES,
  parseGithubBottleneckArgs,
} from "../../../../../cli/commands/github/bottleneckCore.js";
import { githubBottleneckUsage } from "../../../../../cli/commands/github/bottleneckUsage.js";
import { unwrap } from "../../../../../lib/result.js";

describe("parseGithubBottleneckArgs", () => {
  it("includes drafts with no flag at all, which is the opposite of `github landing`", () => {
    const args = unwrap(parseGithubBottleneckArgs({ rest: [] }));

    expect(args.excludeDrafts).toBe(false);
    expect(args.limit).toBe(100);
    expect(args.json).toBe(false);
    expect(args.slackLive).toBe(false);
    expect(args.repos).toEqual([]);
    expect(args.author).toBe(undefined);
  });

  it("takes several repositories from one comma-separated flag", () => {
    const args = unwrap(parseGithubBottleneckArgs({ rest: ["--repo", "acme/widgets, acme/gadgets"] }));

    expect(args.repos).toEqual(["acme/widgets", "acme/gadgets"]);
  });

  it("refuses a repository that is not an owner/name slug, by name", () => {
    const parsed = parseGithubBottleneckArgs({ rest: ["--repo", "widgets"] });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()).toEqual(["--repo takes one or more comma-separated owner/name slugs"]);
  });

  it("refuses a limit that is not a positive whole number", () => {
    const parsed = parseGithubBottleneckArgs({ rest: ["--limit", "0"] });

    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()).toEqual(["--limit must be a positive whole number"]);
  });

  it("carries every typed option through", () => {
    const args = unwrap(
      parseGithubBottleneckArgs({
        rest: [
          "--repo",
          "acme/widgets",
          "--author",
          "someone",
          "--exclude-drafts",
          "--slack-live",
          "--limit",
          "7",
          "--json",
          "--home",
          "/tmp/home",
        ],
      }),
    );

    expect(args).toEqual({
      author: "someone",
      excludeDrafts: true,
      home: "/tmp/home",
      json: true,
      limit: 7,
      repos: ["acme/widgets"],
      slackLive: true,
    });
  });

  it("has no write flag to type, because the audit only reads", () => {
    expect(GITHUB_BOTTLENECK_FLAG_NAMES).toEqual([
      "--repo",
      "--author",
      "--limit",
      "--home",
      "--json",
      "--exclude-drafts",
      "--slack-live",
    ]);
  });
});

describe("githubBottleneckUsage", () => {
  it("names every flag the parser accepts, so the help cannot drift from the spec", () => {
    const usage = githubBottleneckUsage();

    expect(GITHUB_BOTTLENECK_FLAG_NAMES.filter((flag) => !usage.includes(flag))).toEqual([]);
    expect(GITHUB_BOTTLENECK_FLAG_NAMES.length).toBeGreaterThan(0);
  });

  it("says out loud that drafts are in and that the idle time is not the wait", () => {
    const usage = githubBottleneckUsage();

    expect(usage).toContain("DRAFTS ARE INCLUDED by default");
    expect(usage).toContain("The second\n  is not the wait");
  });
});
