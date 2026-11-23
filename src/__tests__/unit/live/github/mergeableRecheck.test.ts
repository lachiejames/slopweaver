import { describe, expect, it } from "vitest";
import { err, ok } from "../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import { makeMergeableRecheck } from "../../../../live/github/mergeableRecheck.js";
import type { GithubReadGraphql } from "../../../../live/github/read.js";

const subject = ({ number }: { number: number }) => ({ headOid: "abc1234", number, repoSlug: "acme/widgets" });

/** A GraphQL seam answering from a fixed document, recording every query it was handed. */
const seam = ({
  document,
}: {
  document: Record<string, unknown>;
}): { graphql: GithubReadGraphql; queries: string[] } => {
  const queries: string[] = [];
  return {
    graphql: ({ query }) => {
      queries.push(query);
      return Promise.resolve(ok(document));
    },
    queries,
  };
};

describe("makeMergeableRecheck", () => {
  it("carries GitHub's settled answer back for every pull request in one request", async () => {
    const { graphql, queries } = seam({
      document: {
        p0: { pullRequest: { headRefOid: "abc1234", mergeable: "MERGEABLE" } },
        p1: { pullRequest: { headRefOid: "def5678", mergeable: "CONFLICTING" } },
      },
    });
    const subjects = [subject({ number: 1 }), subject({ number: 2 })];
    const answers = await makeMergeableRecheck({ graphql })({ subjects });
    expect(answers).toStrictEqual([
      { kind: "read", value: { headOid: "abc1234", mergeable: "MERGEABLE" } },
      { kind: "read", value: { headOid: "def5678", mergeable: "CONFLICTING" } },
    ]);
    expect(queries.length).toBe(1);
  });

  it("carries UNKNOWN back as UNKNOWN, so a still-uncomputed answer is never dressed up as settled", async () => {
    const { graphql } = seam({ document: { p0: { pullRequest: { headRefOid: "abc1234", mergeable: "UNKNOWN" } } } });
    const subjects = [subject({ number: 1 })];
    const answers = await makeMergeableRecheck({ graphql })({ subjects });
    expect(answers).toStrictEqual([{ kind: "read", value: { headOid: "abc1234", mergeable: "UNKNOWN" } }]);
  });

  it("answers unread when the pull request itself came back null", async () => {
    const { graphql } = seam({ document: { p0: { pullRequest: null } } });
    const subjects = [subject({ number: 1 })];
    const answers = await makeMergeableRecheck({ graphql })({ subjects });
    expect(answers).toStrictEqual([
      { kind: "unread", why: "the re-read carried no `mergeable` for this pull request" },
    ]);
  });

  it("answers unread with the transport's own words when the whole request fails", async () => {
    const graphql: GithubReadGraphql = () =>
      Promise.resolve(err(GithubLiveErrors.readFailed({ cause: undefined, message: "Bad credentials" })));
    const subjects = [subject({ number: 1 })];
    const answers = await makeMergeableRecheck({ graphql })({ subjects });
    expect(answers).toStrictEqual([{ kind: "unread", why: "Bad credentials" }]);
  });

  it("makes no request at all when nothing came back unknown", async () => {
    const { graphql, queries } = seam({ document: {} });
    const answers = await makeMergeableRecheck({ graphql })({ subjects: [] });
    expect(answers).toStrictEqual([]);
    expect(queries.length).toBe(0);
  });
});

describe("makeMergeableRecheck — the head it answered about", () => {
  it("carries GitHub's CURRENT head back, so a caller can refuse an answer about a head it did not judge", async () => {
    const { graphql } = seam({ document: { p0: { pullRequest: { headRefOid: "moved99", mergeable: "MERGEABLE" } } } });
    const answers = await makeMergeableRecheck({ graphql })({ subjects: [subject({ number: 1 })] });
    expect(answers).toStrictEqual([{ kind: "read", value: { headOid: "moved99", mergeable: "MERGEABLE" } }]);
  });

  it("REFUSES an answer that carried no head, because an unpinnable mergeability is worse than none", async () => {
    const { graphql } = seam({ document: { p0: { pullRequest: { mergeable: "MERGEABLE" } } } });
    const answers = await makeMergeableRecheck({ graphql })({ subjects: [subject({ number: 1 })] });
    expect(answers).toStrictEqual([
      {
        kind: "unread",
        why: "the re-read carried no head for this pull request, so its mergeability cannot be pinned to one",
      },
    ]);
  });

  it("asks GitHub for the head alongside the mergeability", async () => {
    const { graphql, queries } = seam({ document: {} });
    await makeMergeableRecheck({ graphql })({ subjects: [subject({ number: 1 })] });
    expect(queries[0]).toBe(
      "query SlopweaverMergeableRecheck($o0: String!, $r0: String!, $n0: Int!) {\n" +
        "p0: repository(owner: $o0, name: $r0) { pullRequest(number: $n0) { mergeable headRefOid } }\n}",
    );
  });
});
