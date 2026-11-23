/**
 * The close-time re-read of one pull request `github bump-drive` is about to close: open and readable, no longer
 * open, or a FAILED read — never a malformed answer read as "no longer open", which would only skip, nor as open.
 */
import { describe, expect, it } from "vitest";

import { ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { GithubReadGraphql } from "../../../../live/github/read.js";
import { parseRecheck, recheckOwnPr } from "../../../../live/github/supersedeRecheck.js";

const node = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  baseRef: { target: { oid: "b".repeat(40), tree: { oid: "d".repeat(40) } } },
  baseRefName: "staging",
  createdAt: "2026-10-05T23:00:00Z",
  files: { nodes: [{ path: "yarn.lock" }], totalCount: 1 },
  headRefOid: "c".repeat(40),
  labels: { nodes: [], totalCount: 0 },
  mergeable: "MERGEABLE",
  number: 18243,
  potentialMergeCommit: {
    parents: { nodes: [{ oid: "b".repeat(40) }, { oid: "c".repeat(40) }], totalCount: 2 },
    tree: { oid: "d".repeat(40) },
  },
  repository: { nameWithOwner: "acme/acme-admin" },
  state: "OPEN",
  title: "chore(deps): update dependency @ai-sdk/openai to v3.0.119",
  url: "https://github.com/acme/acme-admin/pull/18243",
  ...over,
});

const answer = ({ pullRequest }: { pullRequest: unknown }): unknown => ({ repository: { pullRequest } });

describe("parseRecheck", () => {
  it("reads an open pull request with its current test merge", () => {
    const pr = unwrap(
      parseRecheck({ data: answer({ pullRequest: node() }), number: 18243, repoSlug: "acme/acme-admin" }),
    );
    expect([pr!.number, pr!.headOid, pr!.testMerge.mergeTreeOid]).toEqual([18243, "c".repeat(40), "d".repeat(40)]);
  });

  it("answers no pull request when it is no longer open", () => {
    const read = parseRecheck({
      data: answer({ pullRequest: node({ state: "CLOSED" }) }),
      number: 18243,
      repoSlug: "acme/acme-admin",
    });
    expect(unwrap(read)).toBe(undefined);
  });

  it("answers no pull request when it merged", () => {
    const read = parseRecheck({
      data: answer({ pullRequest: node({ state: "MERGED" }) }),
      number: 18243,
      repoSlug: "acme/acme-admin",
    });
    expect(unwrap(read)).toBe(undefined);
  });

  it("refuses a missing or unknown state rather than reading it as closed", () => {
    const messages = [{ state: "OPNE" }, { state: null }].map(
      (over) =>
        unwrapErr(
          parseRecheck({ data: answer({ pullRequest: node(over) }), number: 18243, repoSlug: "acme/acme-admin" }),
        ).message,
    );
    expect(messages).toEqual([
      "GitHub's re-read of acme/acme-admin#18243 carried no state this reads",
      "GitHub's re-read of acme/acme-admin#18243 carried no state this reads",
    ]);
  });

  it("refuses a CLOSED answer about another pull request rather than skipping on it", () => {
    const other = node({ number: 999, state: "CLOSED" });
    const read = parseRecheck({
      data: answer({ pullRequest: other }),
      number: 18243,
      repoSlug: "acme/acme-admin",
    });
    expect(unwrapErr(read).message).toBe(
      "GitHub's re-read of acme/acme-admin#18243 answered about acme/acme-admin#999",
    );
  });

  it("refuses a node that names no pull request", () => {
    const read = parseRecheck({
      data: answer({ pullRequest: node({ number: null }) }),
      number: 18243,
      repoSlug: "acme/acme-admin",
    });
    expect(unwrapErr(read).message).toBe("GitHub's re-read of acme/acme-admin#18243 named no pull request");
  });

  it("refuses an answer carrying no pull request rather than reading it as closed", () => {
    expect(
      unwrapErr(parseRecheck({ data: answer({ pullRequest: null }), number: 18243, repoSlug: "acme/acme-admin" }))
        .message,
    ).toBe("GitHub's re-read of acme/acme-admin#18243 came back without it");
  });

  it("refuses an open pull request it cannot fully read", () => {
    expect(
      unwrapErr(
        parseRecheck({
          data: answer({ pullRequest: node({ headRefOid: null }) }),
          number: 18243,
          repoSlug: "acme/acme-admin",
        }),
      ).message,
    ).toBe("GitHub's re-read of acme/acme-admin#18243 carried a field this decision cannot read");
  });

  it("refuses an answer about another pull request, so a close never stands on one it did not examine", () => {
    const other = node({ number: 999, url: "https://github.com/acme/acme-admin/pull/999" });
    const read = parseRecheck({
      data: answer({ pullRequest: other }),
      number: 18243,
      repoSlug: "acme/acme-admin",
    });
    expect(unwrapErr(read).message).toBe(
      "GitHub's re-read of acme/acme-admin#18243 answered about acme/acme-admin#999",
    );
  });

  it("refuses an answer about the same number in another repository", () => {
    const other = node({ repository: { nameWithOwner: "lachiejames/slopweaver" } });
    const read = parseRecheck({
      data: answer({ pullRequest: other }),
      number: 18243,
      repoSlug: "acme/acme-admin",
    });
    expect(unwrapErr(read).message).toBe(
      "GitHub's re-read of acme/acme-admin#18243 answered about lachiejames/slopweaver#18243",
    );
  });

  it("matches the repository without regard to case", () => {
    const read = parseRecheck({
      data: answer({ pullRequest: node() }),
      number: 18243,
      repoSlug: "Acme/ACME-Admin",
    });
    expect(unwrap(read)!.number).toBe(18243);
  });
});

describe("recheckOwnPr", () => {
  it("asks for the one pull request by owner, name and number", async () => {
    const asked: Readonly<Record<string, unknown>>[] = [];
    const graphql: GithubReadGraphql = ({ variables }) => {
      asked.push(variables);
      return Promise.resolve(ok(answer({ pullRequest: node() })));
    };
    const read = await recheckOwnPr({ graphql, number: 18243, repoSlug: "acme/acme-admin" });
    expect(unwrap(read)!.url).toBe("https://github.com/acme/acme-admin/pull/18243");
    expect(asked).toEqual([{ name: "acme-admin", number: 18243, owner: "acme" }]);
  });
});
