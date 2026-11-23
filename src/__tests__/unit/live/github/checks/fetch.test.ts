/**
 * `makeFetchGithubChecks` — the checks read over an injected GraphQL seam: the exact variables it sends, the
 * parse of a successful response, and a transport failure passed through unparsed.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { makeFetchGithubChecks } from "../../../../../live/github/checksRead.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";
import { rollupData } from "./harness.js";

describe("makeFetchGithubChecks", () => {
  it("sends the exact query variables and parses a successful response", async () => {
    const calls: unknown[] = [];
    const fetchChecks = makeFetchGithubChecks({
      graphql: (args) => {
        calls.push(args);
        return Promise.resolve(ok(rollupData({ state: "SUCCESS" })));
      },
    });

    const result = await fetchChecks({ limit: 50, number: 9, owner: "acme", repo: "widget" });

    expect(calls).toHaveLength(1);
    expect((calls[0] as { variables: unknown }).variables).toEqual({
      limit: 50,
      number: 9,
      owner: "acme",
      repo: "widget",
    });
    expect(unwrap(result).rollupState).toBe("SUCCESS");
  });

  it("propagates a GraphQL transport failure without parsing", async () => {
    const failure = GithubLiveErrors.readFailed({ message: "github graphql failed" });
    const fetchChecks = makeFetchGithubChecks({ graphql: () => Promise.resolve(err(failure)) });

    const result = await fetchChecks({ limit: 50, number: 9, owner: "acme", repo: "widget" });

    expect(unwrapErr(result)).toEqual(failure);
  });
});
