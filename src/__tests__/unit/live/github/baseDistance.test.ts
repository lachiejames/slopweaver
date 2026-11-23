import { describe, expect, it } from "vitest";
import { err, ok } from "../../../../lib/result.js";
import { makeBaseDistanceRead } from "../../../../live/github/baseDistance.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import type { GithubReadGraphql } from "../../../../live/github/read.js";

const subject = ({ number }: { number: number }) => ({
  baseRefName: "staging",
  headRefName: `feature/${String(number)}`,
  headRepoSlug: "acme/widgets",
  repoSlug: "acme/widgets",
});

/** A GraphQL seam answering from a fixed document, recording every query it was handed. */
const seam = ({
  document,
}: {
  document: Record<string, unknown>;
}): { graphql: GithubReadGraphql; queries: string[]; variables: Readonly<Record<string, unknown>>[] } => {
  const queries: string[] = [];
  const variables: Record<string, unknown>[] = [];
  return {
    graphql: ({ query, variables: vars }) => {
      queries.push(query);
      variables.push(vars);
      return Promise.resolve(ok(document));
    },
    queries,
    variables,
  };
};

describe("makeBaseDistanceRead", () => {
  it("reads ahead, behind and status for every pull request in one request", async () => {
    const { graphql, queries, variables } = seam({
      document: {
        p0: { ref: { compare: { aheadBy: 2, behindBy: 47, status: "DIVERGED" } } },
        p1: { ref: { compare: { aheadBy: 3, behindBy: 0, status: "AHEAD" } } },
      },
    });
    const subjects = [subject({ number: 1 }), subject({ number: 2 })];
    const answers = await makeBaseDistanceRead({ graphql })({ subjects });
    expect(answers).toStrictEqual([
      { kind: "read", value: { aheadBy: 2, behindBy: 47, status: "DIVERGED" } },
      { kind: "read", value: { aheadBy: 3, behindBy: 0, status: "AHEAD" } },
    ]);
    expect(queries.length).toBe(1);
    expect(variables[0]).toStrictEqual({
      b0: "staging",
      b1: "staging",
      h0: "feature/1",
      h1: "feature/2",
      o0: "acme",
      o1: "acme",
      r0: "widgets",
      r1: "widgets",
    });
  });

  it("asks the BASE ref to compare itself against the head, which is what makes behindBy the right way round", async () => {
    const { graphql, queries } = seam({
      document: { p0: { ref: { compare: { aheadBy: 0, behindBy: 0, status: "IDENTICAL" } } } },
    });
    await makeBaseDistanceRead({ graphql })({ subjects: [subject({ number: 1 })] });
    expect(queries[0]).toBe(
      "query SlopweaverBaseDistance($o0: String!, $r0: String!, $b0: String!, $h0: String!) {\n" +
        "p0: repository(owner: $o0, name: $r0) { ref(qualifiedName: $b0) { compare(headRef: $h0) " +
        "{ aheadBy behindBy status } } }\n}",
    );
  });

  it("qualifies a FORK's head as owner:branch, so it is not resolved in the base repository", async () => {
    const { graphql, variables } = seam({
      document: { p0: { ref: { compare: { aheadBy: 1, behindBy: 2, status: "DIVERGED" } } } },
    });
    await makeBaseDistanceRead({ graphql })({
      subjects: [
        {
          baseRefName: "staging",
          headRefName: "feature/one",
          headRepoSlug: "a-contributor/widgets",
          repoSlug: "acme/widgets",
        },
      ],
    });
    expect(variables[0]!["h0"]).toBe("a-contributor:feature/one");
  });

  it("leaves a same-repository head unqualified, which is what it has always been", async () => {
    const { graphql, variables } = seam({
      document: { p0: { ref: { compare: { aheadBy: 1, behindBy: 2, status: "DIVERGED" } } } },
    });
    await makeBaseDistanceRead({ graphql })({ subjects: [subject({ number: 1 })] });
    expect(variables[0]!["h0"]).toBe("feature/1");
  });

  it("answers unread, never a synthesised zero, when GitHub returns a null comparison", async () => {
    const { graphql } = seam({ document: { p0: { ref: { compare: null } } } });
    const subjects = [subject({ number: 1 })];
    const answers = await makeBaseDistanceRead({ graphql })({ subjects });
    expect(answers).toStrictEqual([
      {
        kind: "unread",
        why:
          "GitHub answered no comparison for this pull request — its base ref, its head ref or the " +
          "comparison itself came back null",
      },
    ]);
  });

  it("answers unread when the base ref itself is gone", async () => {
    const { graphql } = seam({ document: { p0: { ref: null } } });
    const subjects = [subject({ number: 1 })];
    const answers = await makeBaseDistanceRead({ graphql })({ subjects });
    expect(answers[0]!.kind).toBe("unread");
  });

  it("answers unread with the transport's own words when the whole request fails", async () => {
    const graphql: GithubReadGraphql = () =>
      Promise.resolve(
        err(GithubLiveErrors.readFailed({ cause: undefined, message: "Could not resolve head ref 'gone'" })),
      );
    const subjects = [subject({ number: 1 })];
    const answers = await makeBaseDistanceRead({ graphql })({ subjects });
    expect(answers).toStrictEqual([{ kind: "unread", why: "Could not resolve head ref 'gone'" }]);
  });

  it("makes no request at all for an empty fleet", async () => {
    const { graphql, queries } = seam({ document: {} });
    const answers = await makeBaseDistanceRead({ graphql })({ subjects: [] });
    expect(answers).toStrictEqual([]);
    expect(queries.length).toBe(0);
  });
});
