import { describe, expect, it } from "vitest";

import { BoundaryErrors } from "#lib/boundary.js";

import { DatadogQueryErrors, datadogBoundaryRefusal, datadogQueryErrorLines } from "../../../datadog/queryErrors.js";

describe("DatadogQueryErrors", () => {
  it("prints a logs-count failure as its one sentence", () => {
    const error = DatadogQueryErrors.logCountStringInvalid({ raw: "12x" });
    expect(error).toEqual({
      code: "LOG_COUNT_STRING_INVALID",
      message: "Datadog returned the count as the string '12x', which is not an integer",
      raw: "12x",
    });
    expect(datadogQueryErrorLines({ error })).toEqual([
      "Datadog returned the count as the string '12x', which is not an integer",
    ]);
  });

  it("distinguishes an unreachable logs endpoint from a rejected logs query", () => {
    const unreachable = DatadogQueryErrors.logQueryUnreachable({
      apiHost: "api.us3.datadoghq.com",
      detail: "ENOTFOUND",
    });
    expect(unreachable.code).toBe("LOG_QUERY_UNREACHABLE");
    expect(unreachable.message).toBe("the logs query never reached Datadog at api.us3.datadoghq.com: ENOTFOUND");
    const rejected = DatadogQueryErrors.logQueryRejected({ detail: "Forbidden", status: 403 });
    expect(rejected.code).toBe("LOG_QUERY_REJECTED");
    expect(datadogQueryErrorLines({ error: rejected })).toEqual([
      "Datadog rejected the logs query with HTTP 403: Forbidden",
    ]);
  });

  it("refuses a route not recorded as read-only and names the allowed ones", () => {
    const error = DatadogQueryErrors.readOnlyRouteRefused({
      allowedRoutes: ["/api/v2/logs/analytics/aggregate"],
      route: "/api/v1/monitor",
    });
    expect(error.code).toBe("READ_ONLY_ROUTE_REFUSED");
    expect(datadogQueryErrorLines({ error })).toEqual([
      "refusing to POST /api/v1/monitor: it is not one of the routes recorded as read-only",
      "the raw path never changes Datadog configuration — a write is a named, door-routed verb such as datadog monitor — so a POST here has to be named as a search or an aggregate before it can be issued",
      "if it genuinely only reads, add it to READ_ONLY_POST_ROUTES in datadog/rawTransport.ts. Currently allowed: /api/v2/logs/analytics/aggregate",
    ]);
    expect(error.message).toBe(
      "refusing to POST /api/v1/monitor: it is not one of the routes recorded as read-only; the raw path never changes Datadog configuration — a write is a named, door-routed verb such as datadog monitor — so a POST here has to be named as a search or an aggregate before it can be issued; if it genuinely only reads, add it to READ_ONLY_POST_ROUTES in datadog/rawTransport.ts. Currently allowed: /api/v2/logs/analytics/aggregate",
    );
  });

  it("frames a body that is not JSON as malformed rather than empty, leading with the boundary's sentence", () => {
    const error = datadogBoundaryRefusal({ refusal: BoundaryErrors.notJson({ endpoint: "GET /api/v2/x" }) });
    expect(error.code).toBe("RAW_BODY_NOT_JSON");
    expect(datadogQueryErrorLines({ error })).toEqual([
      "GET /api/v2/x answered a body that is not JSON",
      "this is a malformed response, NOT an empty result — reading it as zero would be a confident wrong answer",
    ]);
  });

  it("carries a refused shape's drift and the boundary's sentence verbatim", () => {
    const drift = [{ detail: 'new field "addedField"', kind: "new", path: "addedField" }] as const;
    const refusal = BoundaryErrors.shapeChanged({ drift, endpoint: "GET /api/v2/x" });
    const error = datadogBoundaryRefusal({ refusal });
    expect(error).toEqual({
      code: "RAW_BODY_INVALID",
      drift,
      endpoint: "GET /api/v2/x",
      message: `${refusal.message}; this is a malformed response, NOT an empty result — the request may have been rejected in a way the status code did not show`,
      reasons: [
        refusal.message,
        "this is a malformed response, NOT an empty result — the request may have been rejected in a way the status code did not show",
      ],
    });
  });

  it("carries a foreign request failure's lines unchanged", () => {
    const error = DatadogQueryErrors.queryRequestFailed({ reasons: ["HTTP 500 from /api/v2/x"] });
    expect(error.code).toBe("QUERY_REQUEST_FAILED");
    expect(error.message).toBe("HTTP 500 from /api/v2/x");
    expect(datadogQueryErrorLines({ error })).toEqual(["HTTP 500 from /api/v2/x"]);
  });

  it("appends why an unverified env scope leaves prod unestablished", () => {
    const error = DatadogQueryErrors.envScopeUnverified({ reasons: ["the grouped aggregate failed"] });
    expect(error.code).toBe("ENV_SCOPE_UNVERIFIED");
    expect(datadogQueryErrorLines({ error })).toEqual([
      "the grouped aggregate failed",
      "this query was scoped to production and the env facet could not be re-checked, so nothing establishes that the matched events are production",
    ]);
  });

  it("names a cardinality compute that came back grouped", () => {
    const error = DatadogQueryErrors.cardinalityBucketGrouped({ facet: "@usr.id", groupKeys: ["service"] });
    expect(error.code).toBe("CARDINALITY_BUCKET_GROUPED");
    expect(datadogQueryErrorLines({ error })[0]).toBe(
      "a cardinality(@usr.id) compute returned a bucket grouped by service, but a population must come from an ungrouped compute",
    );
  });
});
