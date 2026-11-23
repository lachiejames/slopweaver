/**
 * The body read behind a proof gap: the document it builds, what it makes of an answer, and that an unanswered pull
 * request is absent rather than an empty body. The transport is a plain function the test supplies.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import {
  makeReadPrBodies,
  parsePrBodies,
  prAddressOfIdentity,
  prBodyKey,
  prBodyQuery,
} from "../../../../live/github/prBody.js";
import type { PrAddress } from "../../../../live/github/prPremise.js";
import type { GithubReadGraphql } from "../../../../live/github/read.js";

const EV: PrAddress = { number: 17564, owner: "Acme", repo: "acme-admin" };

describe("prBodyKey and prAddressOfIdentity", () => {
  it("keys a body by the lowercased identity and reads one back", () => {
    expect(prBodyKey({ address: EV })).toBe("acme/acme-admin#17564");
    expect(prAddressOfIdentity({ identity: "acme/acme-admin#17564" })).toEqual({
      number: 17564,
      owner: "acme",
      repo: "acme-admin",
    });
  });

  it("reads nothing out of a string that is not an identity", () => {
    expect(prAddressOfIdentity({ identity: "acme-admin#17564" })).toBe(undefined);
    expect(prAddressOfIdentity({ identity: "a/b#c" })).toBe(undefined);
  });
});

describe("prBodyQuery", () => {
  it("asks only for the number and body, owner and repo as variables", () => {
    const { query, variables } = prBodyQuery({ addresses: [EV] });

    expect(query).toBe(
      "query SlopweaverPrProofBody($o0: String!, $r0: String!, $n0: Int!) {\n" +
        "  p0: repository(owner: $o0, name: $r0) {\n" +
        "    pullRequest(number: $n0) { number body }\n" +
        "  }\n}",
    );
    expect(variables).toEqual({ n0: 17564, o0: "Acme", r0: "acme-admin" });
  });
});

describe("parsePrBodies", () => {
  it("reads an answered body, an empty one included", () => {
    const bodies = parsePrBodies({
      addresses: [EV, { number: 1, owner: "o", repo: "r" }],
      data: { p0: { pullRequest: { body: "## Summary" } }, p1: { pullRequest: { body: "" } } },
    });

    expect([...bodies]).toEqual([
      ["acme/acme-admin#17564", "## Summary"],
      ["o/r#1", ""],
    ]);
  });

  it("leaves out an unanswered node and a body that is not a string", () => {
    const bodies = parsePrBodies({
      addresses: [EV, { number: 1, owner: "o", repo: "r" }],
      data: { p0: { pullRequest: null }, p1: { pullRequest: { body: null } } },
    });

    expect(bodies.size).toBe(0);
  });
});

describe("makeReadPrBodies", () => {
  it("asks once for repeated addresses and returns what GitHub said", async () => {
    const asked: Readonly<Record<string, unknown>>[] = [];
    const graphql: GithubReadGraphql = ({ variables }) => {
      asked.push(variables);
      return Promise.resolve(ok({ p0: { pullRequest: { body: "b" } } }));
    };

    const bodies = unwrap(await makeReadPrBodies({ graphql })({ addresses: [EV, EV] }));

    expect(asked).toEqual([{ n0: 17564, o0: "Acme", r0: "acme-admin" }]);
    expect(bodies.get("acme/acme-admin#17564")).toBe("b");
  });

  it("asks nothing for an empty address list", async () => {
    let calls = 0;
    const graphql: GithubReadGraphql = () => {
      calls += 1;
      return Promise.resolve(ok({}));
    };

    expect(unwrap(await makeReadPrBodies({ graphql })({ addresses: [] })).size).toBe(0);
    expect(calls).toBe(0);
  });

  it("reads the rest of a batch one at a time when one number resolves to nothing", async () => {
    const asked: Readonly<Record<string, unknown>>[] = [];
    const gone: PrAddress = { number: 18414, owner: "acme", repo: "acme-admin" };
    const graphql: GithubReadGraphql = ({ variables }) => {
      asked.push(variables);
      if (variables["n0"] === 18414 || variables["n1"] === 18414) {
        return Promise.resolve(
          err(
            GithubLiveErrors.readFailed({
              message:
                "Request failed due to following response errors:\n - Could not resolve to a PullRequest with the number of 18414.",
            }),
          ),
        );
      }
      return Promise.resolve(ok({ p0: { pullRequest: { body: "## Test evidence" } } }));
    };

    const bodies = unwrap(await makeReadPrBodies({ graphql })({ addresses: [EV, gone] }));

    expect([...bodies]).toEqual([["acme/acme-admin#17564", "## Test evidence"]]);
    expect(asked).toEqual([
      { n0: 17564, n1: 18414, o0: "Acme", o1: "acme", r0: "acme-admin", r1: "acme-admin" },
      { n0: 17564, o0: "Acme", r0: "acme-admin" },
      { n0: 18414, o0: "acme", r0: "acme-admin" },
    ]);
  });

  it("does not retry address by address when the batch failed for any other reason", async () => {
    let calls = 0;
    const graphql: GithubReadGraphql = () => {
      calls += 1;
      return Promise.resolve(err(GithubLiveErrors.readFailed({ message: "Bad credentials" })));
    };

    const failure = unwrapErr(
      await makeReadPrBodies({ graphql })({ addresses: [EV, { number: 1, owner: "o", repo: "r" }] }),
    );

    expect(failure.message).toBe("Bad credentials");
    expect(calls).toBe(1);
  });

  it("fails the whole read when an unresolved number arrives beside any other error, as a rate limit, or names a number never asked for", async () => {
    const mixed =
      "Request failed due to following response errors:\n - Could not resolve to a PullRequest with the number of 18414.\n - API rate limit exceeded";
    const sameBullet =
      "Request failed due to following response errors:\n - Could not resolve to a PullRequest with the number of 2. API rate limit exceeded";
    const failures = [
      GithubLiveErrors.readFailed({ message: mixed }),
      GithubLiveErrors.readFailed({ message: sameBullet }),
      GithubLiveErrors.readFailed({
        message: "Bad credentials\n - Could not resolve to a PullRequest with the number of 17564.",
      }),
      GithubLiveErrors.readFailed({
        message:
          "Request failed due to following response errors:\n\n - Could not resolve to a PullRequest with the number of 18414.",
      }),
      GithubLiveErrors.readFailed({
        message:
          " \tRequest failed due to following response errors:\n\t - Could not resolve to a PullRequest with the number of 18414. ",
      }),
      GithubLiveErrors.rateLimited({
        message: " - Could not resolve to a PullRequest",
        resetAt: "2026-10-14T10:00:00Z",
      }),
      GithubLiveErrors.readFailed({
        message:
          "Request failed due to following response errors:\n - Could not resolve to a PullRequest with the number of 18414.",
      }),
      GithubLiveErrors.readFailed({
        message:
          "Request failed due to following response errors:\n - Could not resolve to a PullRequest with the number of 017564.",
      }),
    ];
    const read = await Promise.all(
      failures.map((failure) =>
        makeReadPrBodies({ graphql: () => Promise.resolve(err(failure)) })({ addresses: [EV] }),
      ),
    );

    expect(read.map((one) => unwrapErr(one).code)).toEqual([
      "READ_FAILED",
      "READ_FAILED",
      "READ_FAILED",
      "READ_FAILED",
      "READ_FAILED",
      "RATE_LIMITED",
      "READ_FAILED",
      "READ_FAILED",
    ]);
  });

  it("carries a transport failure out as the typed error", async () => {
    const graphql: GithubReadGraphql = () =>
      Promise.resolve(err(GithubLiveErrors.readFailed({ message: "rate limited" })));

    const failure = unwrapErr(await makeReadPrBodies({ graphql })({ addresses: [EV] }));

    expect(failure.code).toBe("READ_FAILED");
    expect(failure.message).toBe("rate limited");
  });
});
