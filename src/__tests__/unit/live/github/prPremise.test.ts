/**
 * The cheap live read behind the briefing gate's freshness half: the aliased document it builds, what it
 * makes of an answer, and the batching and de-duplication a fifty-card page depends on.
 *
 * The transport is a plain function the test supplies — a seam, not a mock — so the whole read is exercised
 * without a network.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../live/github/errors.js";
import {
  makeReadPrPremises,
  noGithubCredential,
  type PrAddress,
  parsePrPremises,
  prAddressOfUrl,
  prIdentity,
  prPremiseQuery,
} from "../../../../live/github/prPremise.js";
import type { GithubReadGraphql } from "../../../../live/github/read.js";

const EV: PrAddress = { number: 16359, owner: "acme", repo: "acme-admin" };
const OTHER: PrAddress = { number: 7, owner: "acme", repo: "widgets" };

describe("prAddressOfUrl", () => {
  it("reads a pull-request URL", () => {
    expect(prAddressOfUrl({ url: "https://github.com/acme/acme-admin/pull/16359" })).toEqual(EV);
  });

  it("reads one carrying a fragment or a tab segment", () => {
    expect(prAddressOfUrl({ url: "https://github.com/acme/acme-admin/pull/16359/files#r1" })).toEqual(EV);
  });

  it("refuses an issue, a discussion and a bare repository link", () => {
    expect(prAddressOfUrl({ url: "https://github.com/acme/acme-admin/issues/16359" })).toBe(undefined);
    expect(prAddressOfUrl({ url: "https://github.com/acme/acme-admin/discussions/12" })).toBe(undefined);
    expect(prAddressOfUrl({ url: "https://github.com/acme/acme-admin" })).toBe(undefined);
  });

  it("refuses a look-alike host", () => {
    expect(prAddressOfUrl({ url: "https://github.com.evil.example/acme/acme-admin/pull/1" })).toBe(undefined);
  });
});

describe("prIdentity", () => {
  it("spells an address the way GitHub does", () => {
    expect(prIdentity({ address: EV })).toBe("acme/acme-admin#16359");
  });
});

describe("prPremiseQuery", () => {
  it("gives each address its own alias and its own variables", () => {
    const { query, variables } = prPremiseQuery({ addresses: [EV, OTHER] });

    expect(query).toContain("p0: repository(owner: $o0, name: $r0)");
    expect(query).toContain("p1: repository(owner: $o1, name: $r1)");
    expect(query).toContain("pullRequest(number: $n0) { number state mergeQueueEntry { state position } }");
    expect(variables).toEqual({
      n0: 16359,
      n1: 7,
      o0: "acme",
      o1: "acme",
      r0: "acme-admin",
      r1: "widgets",
    });
  });

  it("never interpolates a repository slug into the query text", () => {
    const { query } = prPremiseQuery({ addresses: [{ number: 1, owner: `a") { x } #`, repo: "b" }] });

    expect(query).not.toContain('a") { x }');
  });
});

describe("parsePrPremises", () => {
  it("reads an open pull request with no queue entry", () => {
    const premises = parsePrPremises({
      addresses: [EV],
      data: { p0: { pullRequest: { mergeQueueEntry: null, number: 16359, state: "OPEN" } } },
    });

    expect(premises.get("acme/acme-admin#16359")).toEqual({
      identity: "acme/acme-admin#16359",
      queue: undefined,
      state: "OPEN",
    });
  });

  it("reads a queued pull request's entry state and position", () => {
    const premises = parsePrPremises({
      addresses: [EV],
      data: { p0: { pullRequest: { mergeQueueEntry: { position: 3, state: "QUEUED" }, state: "OPEN" } } },
    });

    expect(premises.get("acme/acme-admin#16359")!.queue).toEqual({ position: 3, state: "QUEUED" });
  });

  it("reads a merged pull request", () => {
    const premises = parsePrPremises({ addresses: [EV], data: { p0: { pullRequest: { state: "MERGED" } } } });

    expect(premises.get("acme/acme-admin#16359")!.state).toBe("MERGED");
  });

  it("leaves an unanswered address out of the map rather than defaulting it", () => {
    const premises = parsePrPremises({ addresses: [EV, OTHER], data: { p0: null, p1: { pullRequest: null } } });

    expect(premises.size).toBe(0);
  });

  it("leaves out a node whose state is not a string", () => {
    const premises = parsePrPremises({ addresses: [EV], data: { p0: { pullRequest: { state: 7 } } } });

    expect(premises.size).toBe(0);
  });

  it("answers an empty map for a response that is not a record at all", () => {
    expect(parsePrPremises({ addresses: [EV], data: "nope" }).size).toBe(0);
  });
});

describe("makeReadPrPremises", () => {
  it("asks once and returns what GitHub said", async () => {
    const asked: { query: string; variables: Readonly<Record<string, unknown>> }[] = [];
    const graphql: GithubReadGraphql = (args) => {
      asked.push(args);
      return Promise.resolve(ok({ p0: { pullRequest: { state: "MERGED" } } }));
    };

    const premises = unwrap(await makeReadPrPremises({ graphql })({ addresses: [EV] }));

    expect(asked.length).toBe(1);
    expect(premises.get("acme/acme-admin#16359")!.state).toBe("MERGED");
  });

  it("collapses a duplicate address into one entry in the document", async () => {
    const asked: Readonly<Record<string, unknown>>[] = [];
    const graphql: GithubReadGraphql = ({ variables }) => {
      asked.push(variables);
      return Promise.resolve(ok({ p0: { pullRequest: { state: "OPEN" } } }));
    };

    await makeReadPrPremises({ graphql })({ addresses: [EV, EV, EV] });

    expect(asked).toEqual([{ n0: 16359, o0: "acme", r0: "acme-admin" }]);
  });

  it("splits more than twenty-five addresses across documents", async () => {
    const addresses = Array.from({ length: 30 }, (_, i) => ({ number: i + 1, owner: "o", repo: "r" }));
    const sizes: number[] = [];
    const graphql: GithubReadGraphql = ({ variables }) => {
      sizes.push(Object.keys(variables).length / 3);
      return Promise.resolve(ok({}));
    };

    await makeReadPrPremises({ graphql })({ addresses });

    expect(sizes).toEqual([25, 5]);
  });

  it("asks nothing for an empty address list", async () => {
    let calls = 0;
    const graphql: GithubReadGraphql = () => {
      calls += 1;
      return Promise.resolve(ok({}));
    };

    const premises = unwrap(await makeReadPrPremises({ graphql })({ addresses: [] }));

    expect(calls).toBe(0);
    expect(premises.size).toBe(0);
  });

  it("carries a transport failure out as the typed error", async () => {
    const graphql: GithubReadGraphql = () =>
      Promise.resolve(err(GithubLiveErrors.readFailed({ message: "rate limited" })));

    const failure = unwrapErr(await makeReadPrPremises({ graphql })({ addresses: [EV] }));

    expect(failure.code).toBe("READ_FAILED");
    expect(failure.message).toBe("rate limited");
  });
});

describe("noGithubCredential", () => {
  it("says what a caller with no token could not do", () => {
    expect(noGithubCredential().message).toBe(
      "no GitHub credential is configured, so no pull request's live state could be read",
    );
  });
});
