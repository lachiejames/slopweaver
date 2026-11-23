import { describe, expect, it } from "vitest";

import { githubRepoFromRemote, renameRemoteRepository, sameGithubRepository } from "#lib/githubRemote.js";

describe("githubRepoFromRemote", () => {
  it("reads owner/name from an HTTPS URL with a .git suffix", () => {
    expect(githubRepoFromRemote({ url: "https://github.com/acme/widgets.git" })).toBe("acme/widgets");
  });

  it("reads owner/name from the SCP-like SSH spelling through a host alias", () => {
    expect(githubRepoFromRemote({ url: "git@github-work:acme/widgets.git" })).toBe("acme/widgets");
  });

  it("refuses a path with more than two segments", () => {
    expect(githubRepoFromRemote({ url: "https://example.test/group/acme/widgets.git" })).toBe(undefined);
  });

  it("refuses a dot segment", () => {
    expect(githubRepoFromRemote({ url: "https://github.com/acme/.." })).toBe(undefined);
  });

  it("refuses a local path with no colon", () => {
    expect(githubRepoFromRemote({ url: "/srv/repos/widgets" })).toBe(undefined);
  });
});

describe("sameGithubRepository", () => {
  it("treats a case difference as the same repository, because GitHub does", () => {
    expect(sameGithubRepository({ left: "Acme/Widgets", right: "acme/widgets" })).toBe(true);
  });

  it("tells two names under one owner apart", () => {
    expect(sameGithubRepository({ left: "acme/widgets", right: "acme/widgets-archive" })).toBe(false);
  });
});

describe("renameRemoteRepository", () => {
  it("renames the last segment of an HTTPS URL and keeps the .git suffix", () => {
    expect(renameRemoteRepository({ newName: "widgets-archive", url: "https://github.com/acme/widgets.git" })).toBe(
      "https://github.com/acme/widgets-archive.git",
    );
  });

  it("keeps the SSH host alias, user and colon", () => {
    expect(renameRemoteRepository({ newName: "widgets-archive", url: "git@github-work:acme/widgets.git" })).toBe(
      "git@github-work:acme/widgets-archive.git",
    );
  });

  it("keeps a port and a trailing slash", () => {
    expect(renameRemoteRepository({ newName: "widgets-archive", url: "ssh://git@github.com:2222/acme/widgets/" })).toBe(
      "ssh://git@github.com:2222/acme/widgets-archive/",
    );
  });

  it("adds no .git suffix the URL did not have", () => {
    expect(renameRemoteRepository({ newName: "widgets-archive", url: "https://github.com/acme/widgets" })).toBe(
      "https://github.com/acme/widgets-archive",
    );
  });

  it("refuses a URL that names no owner/name", () => {
    expect(renameRemoteRepository({ newName: "widgets-archive", url: "/srv/repos/widgets" })).toBe(undefined);
  });
});
