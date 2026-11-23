/** {@link countLandedByDay} — one count per day per repository through the injected GraphQL seam. */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import { countLandedByDay, landedSearchQuery } from "../../../../live/github/landedCount.js";
import type { GithubReadGraphql } from "../../../../live/github/read.js";

describe("landedSearchQuery", () => {
  it("asks for merged pull requests the token's own account authored on one UTC day", () => {
    expect(landedSearchQuery({ day: "2026-09-27", repo: "o/r" })).toBe(
      "is:pr is:merged repo:o/r author:@me merged:2026-09-27T00:00:00+00:00..2026-09-27T23:59:59+00:00",
    );
  });
});

describe("countLandedByDay", () => {
  it("sums each day's count across repositories", async () => {
    const asked: string[] = [];
    const graphql: GithubReadGraphql = async ({ variables }) => {
      const q = String(variables["q"]);
      asked.push(q);
      return ok({ search: { issueCount: q.includes("repo:a/one") ? 2 : 3 } });
    };
    const counted = await countLandedByDay({ days: ["2026-09-26", "2026-09-27"], graphql, repos: ["a/one", "a/two"] });
    expect(counted.isOk()).toBe(true);
    expect(unwrap(counted)).toEqual([
      { day: "2026-09-26", landed: 5 },
      { day: "2026-09-27", landed: 5 },
    ]);
    expect(asked.length).toBe(4);
  });

  it("fails on the first read that fails, and on a response with no count", async () => {
    const failing: GithubReadGraphql = async () => err(GithubLiveErrors.readFailed({ message: "boom" }));
    const failed = await countLandedByDay({ days: ["2026-09-27"], graphql: failing, repos: ["a/one"] });
    expect(unwrapErr(failed).message).toBe("boom");
    const empty: GithubReadGraphql = async () => ok({ search: {} });
    const missing = await countLandedByDay({ days: ["2026-09-27"], graphql: empty, repos: ["a/one"] });
    expect(unwrapErr(missing).code).toBe("READ_FAILED");
    expect(unwrapErr(missing).message).toBe("GitHub returned no issueCount for a/one on 2026-09-27");
  });
});
