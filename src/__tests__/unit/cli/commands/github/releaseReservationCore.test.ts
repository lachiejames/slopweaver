/**
 * `github pr release-reservation`'s parser.
 *
 * All three address flags are required and none is defaulted, because the locus is the whole key: a guessed
 * base would address a DIFFERENT reservation from the one the caller means, and this verb writes the ledger.
 */
import { describe, expect, it } from "vitest";

import { GITHUB_PR_RELEASE_RESERVATION_USAGE } from "../../../../../cli/commands/github/prUsage.js";
import {
  GITHUB_PR_RELEASE_RESERVATION_FLAG_NAMES,
  parseGithubPrReleaseReservationArgs,
} from "../../../../../cli/commands/github/releaseReservationCore.js";
import { unwrap } from "../../../../../lib/result.js";

const ADDRESS = ["--repo", "octo-self/slopweaver", "--base", "main", "--head", "a-branch"] as const;

describe("the resolved address", () => {
  it("splits the repository slug and carries both refs", () => {
    const parsed = parseGithubPrReleaseReservationArgs({ rest: [...ADDRESS] });
    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toStrictEqual({
      base: "main",
      head: "a-branch",
      home: undefined,
      owner: "octo-self",
      repo: "slopweaver",
    });
  });

  it("carries --home when given", () => {
    const parsed = parseGithubPrReleaseReservationArgs({ rest: [...ADDRESS, "--home", "/tmp/a-home"] });
    expect(unwrap(parsed).home).toBe("/tmp/a-home");
  });

  it("keeps a fork-qualified head verbatim, because the ledger key is what the caller wrote", () => {
    const parsed = parseGithubPrReleaseReservationArgs({
      rest: ["--repo", "o/r", "--base", "main", "--head", "a-fork:a-branch"],
    });
    expect(unwrap(parsed).head).toBe("a-fork:a-branch");
  });
});

describe("what it refuses", () => {
  it("names every missing address flag at once, rather than the first", () => {
    const parsed = parseGithubPrReleaseReservationArgs({ rest: [] });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()).toStrictEqual([
      "--repo owner/name is required",
      "--base <ref> is required",
      "--head <ref> is required",
    ]);
  });

  it("refuses a repository that is not owner/name", () => {
    const parsed = parseGithubPrReleaseReservationArgs({
      rest: ["--repo", "slopweaver", "--base", "main", "--head", "a-branch"],
    });
    expect(parsed._unsafeUnwrapErr()).toStrictEqual(["--repo owner/name is required"]);
  });

  it("refuses an empty --base rather than treating it as absent-but-fine", () => {
    const parsed = parseGithubPrReleaseReservationArgs({
      rest: ["--repo", "o/r", "--base", "", "--head", "a-branch"],
    });
    expect(parsed._unsafeUnwrapErr()).toStrictEqual(["--base <ref> is required"]);
  });

  it("refuses a positional, so a stray argument is never read as a flag value", () => {
    const parsed = parseGithubPrReleaseReservationArgs({ rest: [...ADDRESS, "extra"] });
    expect(parsed._unsafeUnwrapErr().join(" ")).toContain("extra");
  });
});

describe("the advertised surface", () => {
  it("advertises exactly the four flags the parser accepts", () => {
    expect([...GITHUB_PR_RELEASE_RESERVATION_FLAG_NAMES]).toStrictEqual(["--repo", "--base", "--head", "--home"]);
  });

  it("says out loud that it never opens, closes or edits a pull request", () => {
    expect(GITHUB_PR_RELEASE_RESERVATION_USAGE).toContain("never opens, closes or edits a pull request");
  });
});
