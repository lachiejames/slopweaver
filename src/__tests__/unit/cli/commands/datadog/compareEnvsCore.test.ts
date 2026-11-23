import { describe, expect, it } from "vitest";

import {
  COMPARE_ENVS_DEFAULT_FROM,
  COMPARE_ENVS_DEFAULT_LIMIT,
  parseDatadogCompareEnvsOptions,
  renderCompareEnvs,
} from "../../../../../cli/commands/datadog/compareEnvsCore.js";
import { DatadogArgsErrors } from "../../../../../cli/commands/datadog/errors.js";
import { compareEnvSides } from "../../../../../datadog/compareEnvs.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const QUERY = "p90:trace.http.server.request{*} by {resource_name}";

/** The flags a valid invocation always carries, so a case only spells what it is testing. */
const REQUIRED = ["--query", QUERY, "--before", "proof-before", "--after", "proof-after"];

describe("parseDatadogCompareEnvsOptions", () => {
  it("defaults the window, the limit and json when only the required flags are given", () => {
    expect(unwrap(parseDatadogCompareEnvsOptions({ rest: REQUIRED }))).toEqual({
      after: "proof-after",
      before: "proof-before",
      by: [],
      from: COMPARE_ENVS_DEFAULT_FROM,
      json: false,
      limit: COMPARE_ENVS_DEFAULT_LIMIT,
      query: QUERY,
      to: "now",
    });
  });

  it("splits --by into tag names and honours --limit, --from, --to and --json", () => {
    expect(
      unwrap(
        parseDatadogCompareEnvsOptions({
          rest: [
            ...REQUIRED,
            "--by",
            "resource_name, service",
            "--limit",
            "12",
            "--from",
            "2h",
            "--to",
            "now-1h",
            "--json",
          ],
        }),
      ),
    ).toEqual({
      after: "proof-after",
      before: "proof-before",
      by: ["resource_name", "service"],
      from: "2h",
      json: true,
      limit: 12,
      query: QUERY,
      to: "now-1h",
    });
  });

  it("refuses a missing --query, naming the flag", () => {
    expect(unwrapErr(parseDatadogCompareEnvsOptions({ rest: ["--before", "a", "--after", "b"] })).message).toContain(
      "--query is required, e.g. --query 'p90:trace.http.server.request{*} by {resource_name}'",
    );
  });

  it("refuses a missing --before and a missing --after together", () => {
    const error = unwrapErr(parseDatadogCompareEnvsOptions({ rest: ["--query", QUERY] }));
    expect(error).toEqual(
      DatadogArgsErrors.optionsRefused({
        reasons: [
          "--before is required: the environment tag the baseline side runs under",
          "--after is required: the environment tag the candidate side runs under",
        ],
      }),
    );
  });

  it("refuses two identical env tags, because there is nothing to compare", () => {
    expect(
      unwrapErr(parseDatadogCompareEnvsOptions({ rest: ["--query", QUERY, "--before", "same", "--after", "same"] }))
        .message,
    ).toBe("--before and --after are both 'same', so there is nothing to compare");
  });

  it("refuses a query that scopes env itself, rather than double-scoping it", () => {
    expect(
      unwrapErr(
        parseDatadogCompareEnvsOptions({
          rest: ["--query", "p90:trace.http.server.request{env:production}", "--before", "a", "--after", "b"],
        }),
      ).message,
    ).toContain("already scopes `env:` itself");
  });

  it("refuses a non-positive --limit, naming what was given", () => {
    const error = unwrapErr(parseDatadogCompareEnvsOptions({ rest: [...REQUIRED, "--limit", "0"] }));
    expect(error.code).toBe("OPTIONS_REFUSED");
    expect(error.message).toBe('--limit must be a whole number of at least 1, not "0"');
  });

  it("refuses an unknown flag, naming it rather than any other refusal", () => {
    expect(unwrapErr(parseDatadogCompareEnvsOptions({ rest: [...REQUIRED, "--bogus"] })).code).toBe("FLAGS_INVALID");
    expect(unwrapErr(parseDatadogCompareEnvsOptions({ rest: [...REQUIRED, "--bogus"] })).message).toContain("--bogus");
  });
});

describe("renderCompareEnvs", () => {
  it("prints both env tags, the header row and one line per group, worst first", () => {
    const comparison = compareEnvSides({
      after: {
        buckets: [
          { by: { resource_name: "POST /api/graphql" }, value: 40 },
          { by: { resource_name: "GET /health" }, value: 1 },
        ],
        env: "proof-after",
      },
      before: {
        buckets: [
          { by: { resource_name: "POST /api/graphql" }, value: 25 },
          { by: { resource_name: "GET /health" }, value: 4 },
        ],
        env: "proof-before",
      },
    });

    const lines = renderCompareEnvs({ comparison, query: QUERY });

    expect(lines[0]).toBe(`compare-envs: ${QUERY}`);
    expect(lines[1]).toBe("  before: env:proof-before");
    expect(lines[2]).toBe("  after:  env:proof-after");
    expect(lines[4]).toContain("+15.00 (+60%)");
    expect(lines[4]).toContain("resource_name=POST /api/graphql");
    expect(lines[5]).toContain("-3.00 (-75%)");
  });

  it("says nothing was measured when neither side reported a bucket, and does not call it no change", () => {
    const lines = renderCompareEnvs({
      comparison: compareEnvSides({ after: { buckets: [], env: "b" }, before: { buckets: [], env: "a" } }),
      query: QUERY,
    });

    expect(lines[3]).toBe(
      "neither side reported a single bucket — nothing was measured, which is not the same as no change",
    );
  });

  it("calls out the groups only one side reported, as added and removed work", () => {
    const lines = renderCompareEnvs({
      comparison: compareEnvSides({
        after: { buckets: [{ by: { resource_name: "new" }, value: 5 }], env: "b" },
        before: { buckets: [{ by: { resource_name: "gone" }, value: 9 }], env: "a" },
      }),
      query: QUERY,
    });

    expect(lines).toContain("1 group(s) only the AFTER side reported — work this change added");
    expect(lines).toContain("1 group(s) only the BEFORE side reported — work this change removed");
  });

  it("labels an ungrouped comparison rather than printing an empty label", () => {
    const lines = renderCompareEnvs({
      comparison: compareEnvSides({
        after: { buckets: [{ by: {}, value: 2 }], env: "b" },
        before: { buckets: [{ by: {}, value: 1 }], env: "a" },
      }),
      query: QUERY,
    });

    expect(lines[4]).toContain("(all)");
  });
});
