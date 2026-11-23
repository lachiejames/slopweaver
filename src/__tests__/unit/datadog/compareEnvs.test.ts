import { describe, expect, it } from "vitest";

import { compareEnvSides, type EnvBucket, envScopedQuery, envScopedQueryIssue } from "../../../datadog/compareEnvs.js";

/** One bucket, so a case reads as the measurement it is rather than as object literal noise. */
function bucket({ resource, value }: { resource: string; value: number }): EnvBucket {
  return { by: { resource_name: resource }, value };
}

describe("compareEnvSides", () => {
  it("joins the two sides on their group tags and reports the delta and ratio", () => {
    const comparison = compareEnvSides({
      after: { buckets: [bucket({ resource: "POST /api/graphql", value: 40 })], env: "local-proof-after" },
      before: { buckets: [bucket({ resource: "POST /api/graphql", value: 25 })], env: "local-proof-before" },
    });

    expect(comparison.beforeEnv).toBe("local-proof-before");
    expect(comparison.afterEnv).toBe("local-proof-after");
    expect(comparison.rows).toEqual([
      {
        after: 40,
        before: 25,
        by: { resource_name: "POST /api/graphql" },
        delta: 15,
        ratio: 0.6,
      },
    ]);
  });

  it("ranks the worst regression first", () => {
    const comparison = compareEnvSides({
      after: {
        buckets: [
          bucket({ resource: "GET /api/customers", value: 12 }),
          bucket({ resource: "POST /api/graphql", value: 90 }),
          bucket({ resource: "GET /health", value: 1 }),
        ],
        env: "after",
      },
      before: {
        buckets: [
          bucket({ resource: "GET /api/customers", value: 10 }),
          bucket({ resource: "POST /api/graphql", value: 30 }),
          bucket({ resource: "GET /health", value: 4 }),
        ],
        env: "before",
      },
    });

    expect(comparison.rows.map((row) => row.by["resource_name"])).toEqual([
      "POST /api/graphql",
      "GET /api/customers",
      "GET /health",
    ]);
    expect(comparison.rows.map((row) => row.delta)).toEqual([60, 2, -3]);
  });

  it("carries a group only the after side reported, with a null before and no delta", () => {
    const comparison = compareEnvSides({
      after: { buckets: [bucket({ resource: "POST /api/observations", value: 7 })], env: "after" },
      before: { buckets: [], env: "before" },
    });

    expect(comparison.rows).toEqual([
      { after: 7, before: null, by: { resource_name: "POST /api/observations" }, delta: null, ratio: null },
    ]);
    expect(comparison.onlyAfter.map((row) => row.by["resource_name"])).toEqual(["POST /api/observations"]);
    expect(comparison.onlyBefore).toEqual([]);
  });

  it("carries a group only the before side reported, as work the change removed", () => {
    const comparison = compareEnvSides({
      after: { buckets: [], env: "after" },
      before: { buckets: [bucket({ resource: "SELECT Observation", value: 3219 })], env: "before" },
    });

    expect(comparison.onlyBefore).toEqual([
      { after: null, before: 3219, by: { resource_name: "SELECT Observation" }, delta: null, ratio: null },
    ]);
    expect(comparison.onlyAfter).toEqual([]);
  });

  it("sorts a one-sided group after every measured one, however large its value", () => {
    const comparison = compareEnvSides({
      after: {
        buckets: [bucket({ resource: "new", value: 9999 }), bucket({ resource: "known", value: 11 })],
        env: "after",
      },
      before: { buckets: [bucket({ resource: "known", value: 10 })], env: "before" },
    });

    expect(comparison.rows.map((row) => row.by["resource_name"])).toEqual(["known", "new"]);
  });

  it("reports no ratio against a zero baseline, while still reporting the delta", () => {
    const comparison = compareEnvSides({
      after: { buckets: [bucket({ resource: "cold path", value: 5 })], env: "after" },
      before: { buckets: [bucket({ resource: "cold path", value: 0 })], env: "before" },
    });

    expect(comparison.rows[0]?.delta).toBe(5);
    expect(comparison.rows[0]?.ratio).toBe(null);
  });

  it("joins on every group tag, not just the first", () => {
    const comparison = compareEnvSides({
      after: {
        buckets: [
          { by: { operation_name: "postgresql.query", service: "checkout-api" }, value: 39 },
          { by: { operation_name: "postgresql.query", service: "jobs-api" }, value: 2 },
        ],
        env: "after",
      },
      before: {
        buckets: [
          { by: { operation_name: "postgresql.query", service: "checkout-api" }, value: 3219 },
          { by: { operation_name: "postgresql.query", service: "jobs-api" }, value: 2 },
        ],
        env: "before",
      },
    });

    expect(comparison.rows.map((row) => row.delta)).toEqual([0, -3180]);
    expect(comparison.onlyAfter).toEqual([]);
    expect(comparison.onlyBefore).toEqual([]);
  });

  it("reports nothing at all when neither side returned a bucket", () => {
    const comparison = compareEnvSides({
      after: { buckets: [], env: "after" },
      before: { buckets: [], env: "before" },
    });

    expect(comparison.rows).toEqual([]);
  });
});

describe("envScopedQuery", () => {
  it("adds the env tag to a wildcard filter", () => {
    expect(
      envScopedQuery({ env: "local-proof-before", query: "p90:trace.http.server.request{*} by {resource_name}" }),
    ).toBe("p90:trace.http.server.request{env:local-proof-before} by {resource_name}");
  });

  it("appends the env tag to an existing filter, keeping what was there", () => {
    expect(
      envScopedQuery({ env: "after", query: "sum:trace.http.server.request.hits{service:checkout-api}.as_count()" }),
    ).toBe("sum:trace.http.server.request.hits{service:checkout-api,env:after}.as_count()");
  });

  it("adds the env tag to an empty filter", () => {
    expect(envScopedQuery({ env: "after", query: "p90:trace.http.server.request{}" })).toBe(
      "p90:trace.http.server.request{env:after}",
    );
  });

  it("leaves a query with no brace filter untouched, which the issue check refuses first", () => {
    expect(envScopedQuery({ env: "after", query: "p90:trace.http.server.request" })).toBe(
      "p90:trace.http.server.request",
    );
  });
});

describe("envScopedQueryIssue", () => {
  it("passes a query with a brace filter and no env of its own", () => {
    expect(envScopedQueryIssue({ query: "p90:trace.http.server.request{*} by {resource_name}" })).toBe(null);
  });

  it("refuses a query with no brace filter, naming what was given", () => {
    expect(envScopedQueryIssue({ query: "p90:trace.http.server.request" })).toContain(
      "needs a brace filter for the env scope",
    );
  });

  it("refuses a query that scopes env itself, rather than double-scoping it", () => {
    expect(
      envScopedQueryIssue({ query: "p90:trace.http.server.request{env:production} by {resource_name}" }),
    ).toContain("already scopes `env:` itself");
  });

  it("does not read a `by` clause's tags as an env scope", () => {
    expect(envScopedQueryIssue({ query: "sum:x{service:a} by {env}" })).toBe(null);
  });
});
