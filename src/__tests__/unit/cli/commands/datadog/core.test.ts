import { describe, expect, it } from "vitest";

import {
  buildProbeQuery,
  METRICS_DEFAULT_FROM,
  METRICS_DEFAULT_LIMIT,
  PROBE_DEFAULT_FROM,
  parseDatadogJsonOnlyOptions,
  parseDatadogMetricsOptions,
  parseDatadogProbeOptions,
} from "../../../../../cli/commands/datadog/core.js";
import { DatadogArgsErrors, datadogArgsErrorLines } from "../../../../../cli/commands/datadog/errors.js";
import { datadogRawOutputLines, parseDatadogRawOptions } from "../../../../../cli/commands/datadog/rawCore.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

describe("parseDatadogJsonOnlyOptions", () => {
  it("defaults json to false when the flag is absent", () => {
    expect(unwrap(parseDatadogJsonOnlyOptions({ rest: [] }))).toEqual({ json: false });
  });

  it("honours --json", () => {
    expect(unwrap(parseDatadogJsonOnlyOptions({ rest: ["--json"] }))).toEqual({ json: true });
  });

  it("refuses an unknown flag", () => {
    expect(unwrapErr(parseDatadogJsonOnlyOptions({ rest: ["--bogus"] }))).toEqual(["unknown flag: --bogus"]);
  });
});

describe("datadogRawOutputLines — the raw verb prints text, never a parse", () => {
  it("answers --json as exactly the status and the body text, verbatim, even when the text is not JSON", () => {
    const lines = datadogRawOutputLines({
      bodyText: "<html>not json</html>",
      json: true,
      method: "GET",
      path: "/api/v1/validate",
      status: 200,
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toStrictEqual({ bodyText: "<html>not json</html>", status: 200 });
  });

  it("prints a heading naming the route and status, then the body text unchanged", () => {
    expect(
      datadogRawOutputLines({ bodyText: '{"valid":true}', json: false, method: "POST", path: "/p", status: 202 }),
    ).toEqual(["datadog raw: POST /p → HTTP 202", '{"valid":true}']);
  });
});

describe("parseDatadogProbeOptions", () => {
  it("defaults every flag when none are given", () => {
    expect(unwrap(parseDatadogProbeOptions({ rest: [] }))).toEqual({
      query: "*",
      from: PROBE_DEFAULT_FROM,
      to: "now",
      prodEnv: false,
      sumMetric: null,
      verifyEnv: false,
      json: false,
    });
  });

  it("honours every flag explicitly", () => {
    const options = unwrap(
      parseDatadogProbeOptions({
        rest: [
          "--query",
          "service:example-api status:error",
          "--from",
          "1h",
          "--to",
          "now",
          "--prod-env",
          "--sum-metric",
          "@violations",
          "--verify-env",
          "--json",
        ],
      }),
    );
    expect(options).toEqual({
      query: "service:example-api status:error",
      from: "1h",
      to: "now",
      prodEnv: true,
      sumMetric: "@violations",
      verifyEnv: true,
      json: true,
    });
  });

  it("refuses an unknown flag", () => {
    expect(unwrapErr(parseDatadogProbeOptions({ rest: ["--bogus"] }))).toEqual(
      DatadogArgsErrors.flagsInvalid({ reasons: ["unknown flag: --bogus"] }),
    );
  });
});

describe("buildProbeQuery", () => {
  it("leaves the query untouched when --prod-env was not passed", () => {
    expect(
      buildProbeQuery({
        query: "service:example-api",
        prodEnv: false,
        prodEnvFilterFragment: "env:(prod OR production)",
      }),
    ).toBe("service:example-api");
  });

  it("wraps the query and appends the filter fragment when --prod-env was passed", () => {
    expect(
      buildProbeQuery({
        query: "service:example-api",
        prodEnv: true,
        prodEnvFilterFragment: "env:(prod OR production)",
      }),
    ).toBe("(service:example-api) env:(prod OR production)");
  });
});

describe("parseDatadogRawOptions", () => {
  it("requires --path", () => {
    const error = unwrapErr(parseDatadogRawOptions({ rest: [] }));
    expect(error.code).toBe("OPTIONS_REFUSED");
    expect(error.message).toContain("--path is required");
  });

  it("defaults method to GET and json to false", () => {
    const options = unwrap(parseDatadogRawOptions({ rest: ["--path", "/api/v1/logs-analytics/list"] }));
    expect(options).toEqual({ method: "GET", path: "/api/v1/logs-analytics/list", body: undefined, json: false });
  });

  it("normalises a lower-case --method", () => {
    const options = unwrap(parseDatadogRawOptions({ rest: ["--path", "/p", "--method", "post"] }));
    expect(options.method).toBe("POST");
  });

  it("rejects an unsupported --method", () => {
    const error = unwrapErr(parseDatadogRawOptions({ rest: ["--path", "/p", "--method", "DELETE"] }));
    expect(error.code).toBe("OPTIONS_REFUSED");
    expect(error.message).toContain("--method must be GET or POST");
  });

  it("parses a JSON --body", () => {
    const options = unwrap(parseDatadogRawOptions({ rest: ["--path", "/p", "--body", '{"a":1}'] }));
    expect(options.body).toEqual({ a: 1 });
  });

  it("rejects a malformed --body", () => {
    const error = unwrapErr(parseDatadogRawOptions({ rest: ["--path", "/p", "--body", "{not json"] }));
    expect(error.code).toBe("OPTIONS_REFUSED");
    expect(error.message).toContain("--body must be valid JSON");
  });

  it("reports every problem at once", () => {
    const error = unwrapErr(parseDatadogRawOptions({ rest: ["--method", "DELETE", "--body", "{not json"] }));
    expect(error).toEqual(
      DatadogArgsErrors.optionsRefused({
        reasons: [
          "--path is required, e.g. --path /api/v1/logs-analytics/list?type=logs",
          "--method must be GET or POST, got 'DELETE'",
          "--body must be valid JSON",
        ],
      }),
    );
  });
});

describe("parseDatadogMetricsOptions", () => {
  it("requires --query", () => {
    const error = unwrapErr(parseDatadogMetricsOptions({ rest: [] }));
    expect(error.code).toBe("OPTIONS_REFUSED");
    expect(error.message).toContain("--query is required");
  });

  it("defaults --by to empty, --limit and the window when only --query is given", () => {
    const options = unwrap(parseDatadogMetricsOptions({ rest: ["--query", "sum:example.metric{*}.as_count()"] }));
    expect(options).toEqual({
      query: "sum:example.metric{*}.as_count()",
      by: [],
      limit: METRICS_DEFAULT_LIMIT,
      from: METRICS_DEFAULT_FROM,
      to: "now",
      json: false,
    });
  });

  it("splits a comma-separated --by, trimming whitespace and dropping empty entries", () => {
    const options = unwrap(
      parseDatadogMetricsOptions({ rest: ["--query", "q", "--by", "region, delivery_status,, "] }),
    );
    expect(options.by).toEqual(["region", "delivery_status"]);
  });

  it("honours an explicit --limit", () => {
    const options = unwrap(parseDatadogMetricsOptions({ rest: ["--query", "q", "--limit", "5"] }));
    expect(options.limit).toBe(5);
  });

  it("rejects a non-positive --limit", () => {
    const error = unwrapErr(parseDatadogMetricsOptions({ rest: ["--query", "q", "--limit", "0"] }));
    expect(error).toEqual(
      DatadogArgsErrors.optionsRefused({ reasons: ["--limit must be a positive integer, got '0'"] }),
    );
  });

  it("rejects a non-integer --limit", () => {
    const error = unwrapErr(parseDatadogMetricsOptions({ rest: ["--query", "q", "--limit", "abc"] }));
    expect(error.code).toBe("OPTIONS_REFUSED");
    expect(error.message).toContain("--limit must be a positive integer");
  });

  it("refuses an unknown flag", () => {
    expect(unwrapErr(parseDatadogMetricsOptions({ rest: ["--query", "q", "--bogus"] }))).toEqual(
      DatadogArgsErrors.flagsInvalid({ reasons: ["unknown flag: --bogus"] }),
    );
  });
});

describe("datadogArgsErrorLines", () => {
  it("prints the tokeniser's list and the verb's own list as those lists, one record per reason", () => {
    const reasons = ["unknown flag: --bogus", "--limit requires a value"];
    expect(datadogArgsErrorLines({ error: DatadogArgsErrors.flagsInvalid({ reasons }) })).toEqual(reasons);
    expect(datadogArgsErrorLines({ error: DatadogArgsErrors.optionsRefused({ reasons }) })).toEqual(reasons);
    expect(DatadogArgsErrors.optionsRefused({ reasons }).message).toBe(
      "unknown flag: --bogus\n--limit requires a value",
    );
  });

  it("prints every other failure as its one message", () => {
    expect(
      datadogArgsErrorLines({ error: DatadogArgsErrors.notAWholeNumber({ flag: "--rows", got: "lots" }) }),
    ).toEqual(['--rows must be a whole number of at least 1, not "lots"']);
    expect(
      datadogArgsErrorLines({ error: DatadogArgsErrors.invariantBroken({ detail: "--path was not provided" }) }),
    ).toEqual(["unreachable: --path was not provided"]);
  });

  it("gives the raw parser's three problems as three records, not one", () => {
    const error = unwrapErr(parseDatadogRawOptions({ rest: ["--method", "DELETE", "--body", "{not json"] }));
    expect(datadogArgsErrorLines({ error })).toEqual([
      "--path is required, e.g. --path /api/v1/logs-analytics/list?type=logs",
      "--method must be GET or POST, got 'DELETE'",
      "--body must be valid JSON",
    ]);
  });
});
