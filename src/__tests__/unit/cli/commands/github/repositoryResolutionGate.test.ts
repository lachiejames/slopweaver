/** Which repositories a fleet read must prove resolve, and the line each one that does not earns. */
import { describe, expect, it } from "vitest";

import {
  repositoriesNeedingResolution,
  repositoryResolutionRefusalLine,
  repositoryResolutionRefusalLines,
} from "../../../../../cli/commands/github/repositoryResolutionGate.js";
import { err, ok } from "../../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";

describe("repositoriesNeedingResolution", () => {
  it("asks every distinct repository when no row came back", () => {
    expect(repositoriesNeedingResolution({ repos: ["acme/widgets", "acme/ghost"], rowRepos: [] })).toEqual([
      "acme/widgets",
      "acme/ghost",
    ]);
  });

  it("asks only the repository no row came back from", () => {
    expect(
      repositoriesNeedingResolution({ repos: ["acme/widgets", "acme/ghost"], rowRepos: ["acme/widgets"] }),
    ).toEqual(["acme/ghost"]);
  });

  it("compares and deduplicates case-insensitively, keeping the first spelling asked", () => {
    expect(
      repositoriesNeedingResolution({
        repos: ["ACME/Widgets", "acme/Ghost", "acme/ghost"],
        rowRepos: ["acme/widgets"],
      }),
    ).toEqual(["acme/Ghost"]);
  });

  it("asks nothing when no repository was read", () => {
    expect(repositoriesNeedingResolution({ repos: [], rowRepos: [] })).toEqual([]);
  });
});

describe("repositoryResolutionRefusalLine", () => {
  it("says GitHub could not resolve a NOT_FOUND repository, naming the verb and the slug", () => {
    expect(
      repositoryResolutionRefusalLine({
        error: GithubLiveErrors.notFound({ identity: "acme/ghost", kind: "repository" }),
        repoSlug: "acme/ghost",
        verb: "github bump-drive",
      }),
    ).toBe(
      "github bump-drive: GitHub could not resolve repository acme/ghost — it may not exist or this credential " +
        "cannot read it, so its zero open pull requests are not a reading; check the slug",
    );
  });

  it("names review-state, not bump-drive, when review-state is the verb refusing", () => {
    expect(
      repositoryResolutionRefusalLine({
        error: GithubLiveErrors.notFound({ identity: "acme/ghost", kind: "repository" }),
        repoSlug: "acme/ghost",
        verb: "github review-state",
      }),
    ).toBe(
      "github review-state: GitHub could not resolve repository acme/ghost — it may not exist or this credential " +
        "cannot read it, so its zero open pull requests are not a reading; check the slug",
    );
  });

  it("says a failed read could not verify the repository, carrying the read's own message", () => {
    expect(
      repositoryResolutionRefusalLine({
        error: GithubLiveErrors.readFailed({ message: "GitHub answered 502" }),
        repoSlug: "acme/flaky",
        verb: "github review-state",
      }),
    ).toBe(
      "github review-state: repository acme/flaky could not be verified, so its zero open pull requests are not a " +
        "reading — GitHub answered 502",
    );
  });
});

describe("repositoryResolutionRefusalLines", () => {
  it("asks every unproven repository and names each failure in the order requested", async () => {
    const asked: string[] = [];
    const lines = await repositoryResolutionRefusalLines({
      home: undefined,
      repos: ["acme/flaky", "acme/widgets", "acme/real", "acme/ghost"],
      resolveRepository: ({ repoSlug }) => {
        asked.push(repoSlug);
        if (repoSlug === "acme/ghost") {
          return Promise.resolve(err(GithubLiveErrors.notFound({ identity: repoSlug, kind: "repository" })));
        }
        if (repoSlug === "acme/flaky") {
          return Promise.resolve(err(GithubLiveErrors.readFailed({ message: "GitHub answered 502" })));
        }
        return Promise.resolve(ok({ nameWithOwner: repoSlug }));
      },
      rowRepos: ["acme/widgets"],
      verb: "github review-state",
    });
    expect(asked).toEqual(["acme/flaky", "acme/real", "acme/ghost"]);
    expect(lines).toEqual([
      "github review-state: repository acme/flaky could not be verified, so its zero open pull requests are not a " +
        "reading — GitHub answered 502",
      "github review-state: GitHub could not resolve repository acme/ghost — it may not exist or this credential " +
        "cannot read it, so its zero open pull requests are not a reading; check the slug",
    ]);
  });

  it("answers no line, and asks nothing, when every repository contributed a row", async () => {
    const asked: string[] = [];
    const lines = await repositoryResolutionRefusalLines({
      home: undefined,
      repos: ["acme/widgets"],
      resolveRepository: ({ repoSlug }) => {
        asked.push(repoSlug);
        return Promise.resolve(ok({ nameWithOwner: repoSlug }));
      },
      rowRepos: ["acme/widgets"],
      verb: "github bump-drive",
    });
    expect(asked).toEqual([]);
    expect(lines).toEqual([]);
  });
});
