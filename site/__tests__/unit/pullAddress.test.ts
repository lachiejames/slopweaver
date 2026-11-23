/*
 * The pull-request page's address: which paths name one, the console link a chip opens, the tab an address opens
 * on, and the verbs the route runs. A path that named something else, or an argv built from an arbitrary login,
 * would run a verb nobody meant.
 */

import { describe, expect, it } from "vitest";

import {
  consolePullHref,
  pullAddressOf,
  pullAddressOfPath,
  pullAvatarsArgv,
  pullConsoleHref,
  pullReadArgv,
  pullTabOf,
  pullTabOfAddress,
} from "../../lib/pullAddress";

const PR = "https://github.com/octo-self/slopweaver/pull/1545";

describe("pullAddressOf", () => {
  it("reads any GitHub address naming a pull request to its canonical one", () => {
    expect(pullAddressOf({ url: `${PR}/files#diff-abc` })).toEqual({
      number: 1545,
      repoSlug: "octo-self/slopweaver",
      url: PR,
    });
  });

  it("refuses an issue", () => {
    expect(pullAddressOf({ url: "https://github.com/octo-self/slopweaver/issues/7" })).toBeUndefined();
  });
});

describe("pullAddressOfPath", () => {
  it("reads the page's three segments", () => {
    expect(pullAddressOfPath({ number: "1545", owner: "octo-self", repo: "slopweaver" })).toEqual({
      number: 1545,
      repoSlug: "octo-self/slopweaver",
      url: PR,
    });
  });

  it("refuses a number that is not one", () => {
    expect(pullAddressOfPath({ number: "0", owner: "octo-self", repo: "slopweaver" })).toBeUndefined();
    expect(pullAddressOfPath({ number: "12a", owner: "octo-self", repo: "slopweaver" })).toBeUndefined();
  });

  it("refuses a segment that would smuggle a path", () => {
    expect(pullAddressOfPath({ number: "1", owner: "octo-self", repo: "slopweaver/pull/2" })).toBeUndefined();
  });
});

describe("pullConsoleHref", () => {
  const address = pullAddressOf({ url: PR })!;

  it("opens the conversation with no query", () => {
    expect(pullConsoleHref({ address })).toBe("/pull-requests/octo-self/slopweaver/1545");
    expect(pullConsoleHref({ address, tab: "conversation" })).toBe("/pull-requests/octo-self/slopweaver/1545");
  });

  it("opens the diff with ?tab=files", () => {
    expect(pullConsoleHref({ address, tab: "files" })).toBe("/pull-requests/octo-self/slopweaver/1545?tab=files");
  });
});

describe("consolePullHref", () => {
  it("sends a pull request to its console page, on the tab its address named", () => {
    expect(consolePullHref({ url: PR })).toBe("/pull-requests/octo-self/slopweaver/1545");
    expect(consolePullHref({ url: `${PR}/files` })).toBe("/pull-requests/octo-self/slopweaver/1545?tab=files");
  });

  it("leaves any other address as it was", () => {
    const issue = "https://github.com/octo-self/slopweaver/issues/7";
    expect(consolePullHref({ url: issue })).toBe(issue);
  });
});

describe("the tab an address or a query opens on", () => {
  it("reads GitHub's files and changes tabs as the diff", () => {
    expect(pullTabOfAddress({ url: `${PR}/files` })).toBe("files");
    expect(pullTabOfAddress({ url: `${PR}/changes` })).toBe("files");
    expect(pullTabOfAddress({ url: `${PR}/commits` })).toBe("conversation");
    expect(pullTabOfAddress({ url: "not a url" })).toBe("conversation");
  });

  it("reads anything but files as the conversation", () => {
    expect(pullTabOf({ query: "files" })).toBe("files");
    expect(pullTabOf({ query: "checks" })).toBe("conversation");
    expect(pullTabOf({ query: undefined })).toBe("conversation");
  });
});

describe("the verbs the route runs", () => {
  it("reads the pull request whole, with its files, as JSON", () => {
    expect(pullReadArgv({ address: pullAddressOf({ url: PR })! }).argv).toEqual([
      "github",
      "read",
      PR,
      "--limit",
      "100",
      "--files",
      "--json",
    ]);
  });

  it("asks the roster for exactly the logins given", () => {
    expect(pullAvatarsArgv({ logins: ["octocat", "coderabbitai"] })).toEqual({
      argv: {
        argv: ["identity", "avatars", "--source", "github", "--ids", "octocat,coderabbitai", "--json"],
        title: "slopweaver identity avatars --source github --ids octocat,coderabbitai --json",
      },
      kind: "argv",
    });
  });

  it("refuses a login GitHub could not have issued", () => {
    expect(pullAvatarsArgv({ logins: ["ok", "--home=/x"] }).kind).toBe("refused");
    expect(pullAvatarsArgv({ logins: ["a,b"] }).kind).toBe("refused");
  });
});
