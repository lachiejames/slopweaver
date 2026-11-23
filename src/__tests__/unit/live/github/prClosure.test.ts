import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parsePrClosure } from "../../../../live/github/prClosure.js";

const IDENTITY = "lachiejames/slopweaver#2027";
const URL = "https://github.com/lachiejames/slopweaver/pull/2027";

/** One raw response, the pull request's fields as given. */
const response = ({ pullRequest }: { pullRequest: Record<string, unknown> | null }): unknown => ({
  repository: { pullRequest },
});

describe("parsePrClosure", () => {
  it("reads a merged pull request's merge commit and instant", () => {
    const parsed = parsePrClosure({
      data: response({
        pullRequest: {
          closedAt: "2026-10-09T20:34:00Z",
          mergeCommit: { oid: "3c92c09714" },
          mergedAt: "2026-10-09T20:34:00Z",
          state: "MERGED",
          url: URL,
        },
      }),
      identity: IDENTITY,
    });
    expect(unwrap(parsed)).toEqual({
      mergeCommitOid: "3c92c09714",
      mergedAt: "2026-10-09T20:34:00Z",
      state: "MERGED",
      url: URL,
    });
  });

  it("reads a pull request closed unmerged by its close instant", () => {
    const parsed = parsePrClosure({
      data: response({
        pullRequest: { closedAt: "2026-10-08T01:00:00Z", mergeCommit: null, mergedAt: null, state: "CLOSED", url: URL },
      }),
      identity: IDENTITY,
    });
    expect(unwrap(parsed)).toEqual({ closedAt: "2026-10-08T01:00:00Z", state: "CLOSED", url: URL });
  });

  it("reads an open pull request as open", () => {
    const parsed = parsePrClosure({
      data: response({ pullRequest: { closedAt: null, mergeCommit: null, mergedAt: null, state: "OPEN", url: URL } }),
      identity: IDENTITY,
    });
    expect(unwrap(parsed)).toEqual({ state: "OPEN", url: URL });
  });

  it("refuses a MERGED answer with no merge commit, rather than settling over a blank witness", () => {
    const parsed = parsePrClosure({
      data: response({
        pullRequest: { mergeCommit: null, mergedAt: "2026-10-09T20:34:00Z", state: "MERGED", url: URL },
      }),
      identity: IDENTITY,
    });
    expect(unwrapErr(parsed).message).toBe(`GitHub reads ${IDENTITY} MERGED with no merge commit`);
  });

  it("names a pull request GitHub has no entry for as not found", () => {
    const parsed = parsePrClosure({ data: response({ pullRequest: null }), identity: IDENTITY });
    expect(unwrapErr(parsed).code).toBe("NOT_FOUND");
  });
});
