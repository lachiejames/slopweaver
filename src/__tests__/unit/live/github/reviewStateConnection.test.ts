/*
 * The GraphQL shape readers under a pull-request node. `connectionIntact` carries the weight: an absent review is
 * only an absence when the page that would have held it came back whole.
 */
import { describe, expect, it } from "vitest";

import {
  connectionIntact,
  hasNextPage,
  isBotActor,
  login,
  nodesOf,
  str,
  totalCountOf,
} from "../../../../live/github/reviewStateConnection.js";

describe("connectionIntact", () => {
  it("is true only when every node is a record and they number exactly totalCount", () => {
    const whole = { nodes: [{ id: "PRR_1" }], totalCount: 1 };
    expect(connectionIntact({ connection: whole })).toBe(true);
    expect(connectionIntact({ connection: { nodes: [], totalCount: 0 } })).toBe(true);
  });

  it("is false for a null node, a short page, a missing count and a missing connection", () => {
    const broken = [
      { nodes: [null], totalCount: 1 },
      { nodes: [{ id: "PRR_1" }], totalCount: 2 },
      { nodes: [] },
      undefined,
    ];
    expect(broken.map((connection) => connectionIntact({ connection }))).toEqual([false, false, false, false]);
  });
});

describe("hasNextPage and totalCountOf", () => {
  it("read pageInfo and totalCount, false and zero when GitHub reported neither", () => {
    expect(hasNextPage({ connection: { pageInfo: { hasNextPage: true } } })).toBe(true);
    expect(hasNextPage({ connection: { pageInfo: { hasNextPage: false } } })).toBe(false);
    expect(hasNextPage({ connection: undefined })).toBe(false);
    expect(totalCountOf({ connection: { totalCount: 4 } })).toBe(4);
    expect(totalCountOf({ connection: {} })).toBe(0);
  });
});

describe("nodesOf", () => {
  it("keeps only the records, and is empty for a missing connection", () => {
    expect(nodesOf({ connection: { nodes: [{ id: "a" }, null, 3] } })).toEqual([{ id: "a" }]);
    expect(nodesOf({ connection: undefined })).toEqual([]);
  });
});

describe("actors and fields", () => {
  it("types a Bot by __typename alone, since GraphQL drops the REST [bot] suffix", () => {
    expect(isBotActor({ value: { __typename: "Bot", login: "renovate" } })).toBe(true);
    expect(isBotActor({ value: { __typename: "User", login: "renovate" } })).toBe(false);
    expect(isBotActor({ value: null })).toBe(false);
  });

  it("reads a login and a string field, the empty string when either is not there", () => {
    expect(login({ value: { login: "octocat" } })).toBe("octocat");
    expect(login({ value: null })).toBe("");
    expect(str({ value: "MERGEABLE" })).toBe("MERGEABLE");
    expect(str({ value: 5 })).toBe("");
  });
});
