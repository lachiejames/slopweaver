/*
 * Which repositories the section watches, and as whom: the `--pr-repo` owner/name@account contract, its refusals,
 * and the owner/name read out of a git remote in every spelling a machine uses.
 */
import { describe, expect, it } from "vitest";
import { parsePrRepo, parsePrRepos, repoFromRemote } from "../../../../../pane/sections/prStatusDecode.js";

describe("parsePrRepo / parsePrRepos — the cross-account contract", () => {
  it("reads owner/name with no account, meaning the active one", () => {
    expect(parsePrRepo({ value: "slopweaver/slopweaver" })).toEqual({
      nameWithOwner: "slopweaver/slopweaver",
      tokenUser: undefined,
    });
  });

  it("reads owner/name@account, because two repos here need two different GitHub logins", () => {
    expect(parsePrRepo({ value: "a-work-org/a-work-repo@a-work-login" })).toEqual({
      nameWithOwner: "a-work-org/a-work-repo",
      tokenUser: "a-work-login",
    });
  });

  it("refuses a value that is not owner/name rather than guessing", () => {
    expect(parsePrRepo({ value: "just-a-name" })).toBe(
      '--pr-repo wants owner/name or owner/name@gh-account, but got "just-a-name"',
    );
  });

  it("refuses an empty account after the @", () => {
    expect(parsePrRepo({ value: "o/r@" })).toBe('--pr-repo has an empty account after "@" in "o/r@"');
  });

  it("refuses more than one @", () => {
    expect(parsePrRepo({ value: "o/r@a@b" })).toBe('--pr-repo has more than one "@" in "o/r@a@b"');
  });

  it("keeps every refusal from a comma-separated list instead of silently unwatching a repo", () => {
    const parsed = parsePrRepos({ value: "o/r, bad-entry ,p/q@acct" });

    expect(parsed.repos).toEqual([
      { nameWithOwner: "o/r", tokenUser: undefined },
      { nameWithOwner: "p/q", tokenUser: "acct" },
    ]);
    expect(parsed.refused).toEqual(['--pr-repo wants owner/name or owner/name@gh-account, but got "bad-entry"']);
  });

  it("ignores empty entries from a trailing comma", () => {
    expect(parsePrRepos({ value: "o/r," }).repos).toEqual([{ nameWithOwner: "o/r", tokenUser: undefined }]);
    expect(parsePrRepos({ value: "o/r," }).refused).toEqual([]);
  });
});

describe("repoFromRemote", () => {
  it("reads the SSH spelling", () => {
    expect(repoFromRemote({ url: "git@github.com:slopweaver/slopweaver.git" })).toBe("slopweaver/slopweaver");
  });

  it("reads the HTTPS spelling", () => {
    expect(repoFromRemote({ url: "https://github.com/an-owner/a-repo.git" })).toBe("an-owner/a-repo");
  });

  it("reads a URL with no .git suffix", () => {
    expect(repoFromRemote({ url: "https://github.com/an-owner/a-repo" })).toBe("an-owner/a-repo");
  });

  it("reads an SSH config ALIAS host, which is how a two-account machine spells its remotes", () => {
    // The regression this pins: requiring `github.com` made the default watch nothing on a machine whose
    // origin is `git@github-personal:...`, and the pull-request tab read "no repository is being watched".
    expect(repoFromRemote({ url: "git@github-personal:an-owner/a-repo.git" })).toBe("an-owner/a-repo");
    expect(repoFromRemote({ url: "git@gh-work:another-owner/another-repo.git" })).toBe("another-owner/another-repo");
  });

  it("reads an ssh:// URL", () => {
    expect(repoFromRemote({ url: "ssh://git@github.com/an-owner/a-repo.git" })).toBe("an-owner/a-repo");
  });

  it("takes owner/name from any host, leaving a non-GitHub remote to fail loudly at `gh` instead", () => {
    // Deliberate: a stated `gh` failure is better than a silently empty tab. See the note on the function.
    expect(repoFromRemote({ url: "git@gitlab.com:o/r.git" })).toBe("o/r");
  });

  it("returns undefined for a value with no owner/name at all", () => {
    expect(repoFromRemote({ url: "not-a-remote" })).toBeUndefined();
  });
});
