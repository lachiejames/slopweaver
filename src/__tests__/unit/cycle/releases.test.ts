import { describe, expect, it } from "vitest";

import {
  newestReleaseAcross,
  type ReleaseInstants,
  releaseVerdict,
  reposOfAttachments,
} from "../../../cycle/releases.js";

const REPO = "example-org/example-repo";
const releases: ReleaseInstants = new Map([
  [REPO, ["2026-08-01T00:00:00.000Z", "2026-08-20T00:00:00.000Z"]],
  ["other-org/other-repo", ["2026-08-31T00:00:00.000Z"]],
]);

describe("releaseVerdict", () => {
  it("reports a release shipped after the work finished", () => {
    expect(releaseVerdict({ releases, repos: [REPO], sinceIso: "2026-08-10T00:00:00.000Z" })).toBe("shipped-since");
  });

  it("reports none-since when every release predates the work", () => {
    expect(releaseVerdict({ releases, repos: [REPO], sinceIso: "2026-08-25T00:00:00.000Z" })).toBe("none-since");
  });

  it("treats an instant equal to the release as not yet shipped past", () => {
    expect(releaseVerdict({ releases, repos: [REPO], sinceIso: "2026-08-20T00:00:00.000Z" })).toBe("none-since");
  });

  it("distinguishes a repository with no release history from one that simply has not shipped", () => {
    expect(releaseVerdict({ releases, repos: ["unknown/repo"], sinceIso: "2026-08-25T00:00:00.000Z" })).toBe(
      "no-release-history",
    );
  });

  it("reports no-release-history when the ticket names no repository at all", () => {
    expect(releaseVerdict({ releases, repos: [], sinceIso: "2026-08-25T00:00:00.000Z" })).toBe("no-release-history");
  });

  it("ships when ANY of several repositories has shipped since", () => {
    expect(
      releaseVerdict({ releases, repos: [REPO, "other-org/other-repo"], sinceIso: "2026-08-25T00:00:00.000Z" }),
    ).toBe("shipped-since");
  });

  it("ignores a repository with no history when another one does have it", () => {
    expect(releaseVerdict({ releases, repos: ["unknown/repo", REPO], sinceIso: "2026-08-25T00:00:00.000Z" })).toBe(
      "none-since",
    );
  });
});

describe("newestReleaseAcross", () => {
  it("answers the latest instant across the named repositories", () => {
    expect(newestReleaseAcross({ releases, repos: [REPO, "other-org/other-repo"] })).toBe("2026-08-31T00:00:00.000Z");
  });

  it("answers undefined when none of them has a release", () => {
    expect(newestReleaseAcross({ releases, repos: ["unknown/repo"] })).toBe(undefined);
  });
});

describe("reposOfAttachments", () => {
  it("reads owner/name from a pull-request URL", () => {
    expect(reposOfAttachments({ urls: ["https://github.com/example-org/example-repo/pull/101"] })).toEqual([REPO]);
  });

  it("ignores an attachment that is not a pull request", () => {
    expect(reposOfAttachments({ urls: ["https://linear.app/example/document/abc"] })).toEqual([]);
  });

  it("dedupes two pull requests in the same repository, in first-seen order", () => {
    expect(
      reposOfAttachments({
        urls: [
          "https://github.com/b-org/b-repo/pull/2",
          "https://github.com/example-org/example-repo/pull/101",
          "https://github.com/example-org/example-repo/pull/102",
        ],
      }),
    ).toEqual(["b-org/b-repo", REPO]);
  });

  it("ignores an issue URL that is not a pull request", () => {
    expect(reposOfAttachments({ urls: ["https://github.com/example-org/example-repo/issues/101"] })).toEqual([]);
  });
});
