/**
 * `resolveGithubRepository` — the one read that tells a slug GitHub resolves from one it does not, which a search
 * cannot. Every seam is a plain fake GraphQL function.
 */
import { describe, expect, it } from "vitest";

import { err, ok, type Result, unwrap, unwrapErr } from "../../../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "../../../../live/github/errors.js";
import type { GithubReadGraphql } from "../../../../live/github/read.js";
import { REPOSITORY_RESOLUTION_QUERY, resolveGithubRepository } from "../../../../live/github/repositoryResolution.js";

/** Octokit's whole message for a GraphQL answer that failed only on an unresolvable repository. */
const unresolvedMessage = ({ slug }: { slug: string }): string =>
  `Request failed due to following response errors:\n - Could not resolve to a Repository with the name '${slug}'.`;

/** A GraphQL seam answering `answer` every time, recording what it was asked. */
function fakeGraphql({ answer }: { answer: Result<unknown, GithubLiveError> }): {
  readonly graphql: GithubReadGraphql;
  readonly asked: { query: string; variables: Readonly<Record<string, unknown>> }[];
} {
  const asked: { query: string; variables: Readonly<Record<string, unknown>> }[] = [];
  return {
    asked,
    graphql: ({ query, variables }) => {
      asked.push({ query, variables });
      return Promise.resolve(answer);
    },
  };
}

describe("resolveGithubRepository", () => {
  it("answers the canonical name of a repository GitHub resolves, asking with the slug's two halves", async () => {
    const fake = fakeGraphql({ answer: ok({ repository: { nameWithOwner: "acme/widgets" } }) });

    const resolved = await resolveGithubRepository({ graphql: fake.graphql, repoSlug: "acme/widgets" });

    expect(unwrap(resolved)).toEqual({ nameWithOwner: "acme/widgets" });
    expect(fake.asked).toEqual([{ query: REPOSITORY_RESOLUTION_QUERY, variables: { owner: "acme", repo: "widgets" } }]);
  });

  it("turns GitHub's exact unresolved-repository failure into NOT_FOUND naming the slug", async () => {
    const fake = fakeGraphql({
      answer: err(GithubLiveErrors.readFailed({ message: unresolvedMessage({ slug: "acme/ghost" }) })),
    });

    const resolved = await resolveGithubRepository({ graphql: fake.graphql, repoSlug: "acme/ghost" });

    expect(unwrapErr(resolved)).toEqual(GithubLiveErrors.notFound({ identity: "acme/ghost", kind: "repository" }));
  });

  it("reads an explicit null repository as NOT_FOUND too", async () => {
    const fake = fakeGraphql({ answer: ok({ repository: null }) });

    const resolved = await resolveGithubRepository({ graphql: fake.graphql, repoSlug: "acme/ghost" });

    expect(unwrapErr(resolved).code).toBe("NOT_FOUND");
  });

  it("keeps the read failure when the unresolved bullet sits beside a second error", async () => {
    const message = `${unresolvedMessage({ slug: "acme/ghost" })}\n - Something else went wrong.`;
    const fake = fakeGraphql({ answer: err(GithubLiveErrors.readFailed({ message })) });

    const resolved = await resolveGithubRepository({ graphql: fake.graphql, repoSlug: "acme/ghost" });

    expect(unwrapErr(resolved)).toEqual(GithubLiveErrors.readFailed({ message }));
  });

  it("keeps the read failure when the bullet names a different repository than the one asked", async () => {
    const message = unresolvedMessage({ slug: "acme/other" });
    const fake = fakeGraphql({ answer: err(GithubLiveErrors.readFailed({ message })) });

    const resolved = await resolveGithubRepository({ graphql: fake.graphql, repoSlug: "acme/ghost" });

    expect(unwrapErr(resolved)).toEqual(GithubLiveErrors.readFailed({ message }));
  });

  it("still reads GitHub's own 200 answer carrying the exact message as NOT_FOUND", async () => {
    const cause = { kind: "http", message: "errored document", operation: "graphql", status: 200 };
    const message = unresolvedMessage({ slug: "acme/ghost" });
    const fake = fakeGraphql({ answer: err(GithubLiveErrors.readFailed({ cause, message })) });

    const resolved = await resolveGithubRepository({ graphql: fake.graphql, repoSlug: "acme/ghost" });

    expect(unwrapErr(resolved).code).toBe("NOT_FOUND");
  });

  it.each([
    { cause: { kind: "http", message: "bad gateway", operation: "graphql", status: 502 }, label: "a 502" },
    { cause: { kind: "network", message: "other side closed", operation: "graphql" }, label: "a dead transport" },
    { cause: { kind: "rate-limit", message: "secondary limit", operation: "graphql" }, label: "a rate limit" },
  ])("keeps the read failure when the exact message rides $label, which no repository answer is", async ({ cause }) => {
    const message = unresolvedMessage({ slug: "acme/ghost" });
    const fake = fakeGraphql({ answer: err(GithubLiveErrors.readFailed({ cause, message })) });

    const resolved = await resolveGithubRepository({ graphql: fake.graphql, repoSlug: "acme/ghost" });

    expect(unwrapErr(resolved)).toEqual(GithubLiveErrors.readFailed({ cause, message }));
  });

  it("passes a rate limit through unchanged, since it proves nothing about the repository", async () => {
    const limited = GithubLiveErrors.rateLimited({
      message: "API rate limit exceeded",
      resetAt: "2026-11-05T05:00:00Z",
    });
    const fake = fakeGraphql({ answer: err(limited) });

    const resolved = await resolveGithubRepository({ graphql: fake.graphql, repoSlug: "acme/widgets" });

    expect(unwrapErr(resolved)).toEqual(limited);
  });

  it("reads an answer with no nameWithOwner as a failed read, never as an absent repository", async () => {
    const fake = fakeGraphql({ answer: ok({ repository: {} }) });

    const resolved = await resolveGithubRepository({ graphql: fake.graphql, repoSlug: "acme/widgets" });

    expect(unwrapErr(resolved)).toEqual(
      GithubLiveErrors.readFailed({ message: "GitHub's answer for acme/widgets carried no nameWithOwner" }),
    );
  });

  it("reads an answer with no repository field as a failed read", async () => {
    const fake = fakeGraphql({ answer: ok({}) });

    const resolved = await resolveGithubRepository({ graphql: fake.graphql, repoSlug: "acme/widgets" });

    expect(unwrapErr(resolved)).toEqual(
      GithubLiveErrors.readFailed({ message: "GitHub's answer for acme/widgets carried no repository field" }),
    );
  });

  it("refuses a slug that is not owner/name without asking GitHub anything", async () => {
    const fake = fakeGraphql({ answer: ok({ repository: { nameWithOwner: "acme/widgets" } }) });

    const resolved = await resolveGithubRepository({ graphql: fake.graphql, repoSlug: "widgets" });

    expect(unwrapErr(resolved)).toEqual(
      GithubLiveErrors.invalidAddress({ message: "expected owner/repo, got: widgets" }),
    );
    expect(fake.asked).toEqual([]);
  });
});
