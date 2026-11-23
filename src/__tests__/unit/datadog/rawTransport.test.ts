import { describe, expect, it } from "vitest";

import type { DatadogConfig } from "../../../datadog/config.js";
import { datadogQueryErrorLines } from "../../../datadog/queryErrors.js";
import {
  assertReadOnly,
  classifyRawStatus,
  createRawTransport,
  type FetchLike,
  READ_ONLY_POST_ROUTES,
} from "../../../datadog/rawTransport.js";
import { createLogger } from "../../../lib/logger.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const CONFIG: DatadogConfig = {
  apiKey: "0123456789abcdef0123456789abcdef",
  appKey: "A".repeat(40),
  site: "us3.datadoghq.com",
  apiHost: "api.us3.datadoghq.com",
  consoleHost: "us3.datadoghq.com",
};

/** A logger that collects its lines, so a warning is asserted rather than mocked. */
function collectingLogger(): { logger: ReturnType<typeof createLogger>; lines: string[] } {
  const lines: string[] = [];
  return { logger: createLogger({ sink: (line) => lines.push(line), outSink: () => undefined }), lines };
}

/** A replayed response's headers: one that named none carries none. */
function headersOf({ headers }: { headers: Record<string, string> | undefined }): Record<string, string> {
  if (headers === undefined) {
    return {};
  }
  return headers;
}

/** One request the fetch seam saw. */
interface SeenCall {
  url: string;
  method: string;
  body: string | undefined;
  headers: Record<string, string>;
}

/** A fetch seam replaying a fixed sequence of responses, recording what it was asked for. */
function replaying({
  responses,
}: {
  responses: readonly { status: number; body: string; headers?: Record<string, string> }[];
}): { fetchImpl: FetchLike; calls: SeenCall[] } {
  const calls: SeenCall[] = [];
  let index = 0;
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, method: init.method, body: init.body, headers: init.headers });
    const next = responses[Math.min(index, responses.length - 1)];
    if (next === undefined) {
      // Only an EMPTY script reaches here, and no case scripts one: a replay with nothing to replay is a broken
      // fixture, refused here rather than answered with an invented status.
      return Promise.reject(new Error("a replaying fetch was called with no scripted response"));
    }
    index += 1;
    return Promise.resolve({
      status: next.status,
      headers: headersOf({ headers: next.headers }),
      text: () => Promise.resolve(next.body),
    });
  };
  return { fetchImpl, calls };
}

/** A sleep seam that records the waits instead of taking them. */
function recordingSleep(): { sleep: ({ seconds }: { seconds: number }) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    sleep: ({ seconds }) => {
      waits.push(seconds);
      return Promise.resolve();
    },
    waits,
  };
}

describe("assertReadOnly — mutation is unrepresentable, and POST is allowlisted", () => {
  it("allows any GET, because a GET reads by definition", () => {
    expect(unwrap(assertReadOnly({ method: "GET", path: "/api/v1/anything/at/all" }))).toBeNull();
  });

  it("allows an allowlisted POST route", () => {
    expect(unwrap(assertReadOnly({ method: "POST", path: "/api/v1/logs-analytics/list" }))).toBeNull();
  });

  it("ignores the query string, so one entry covers every parameterisation", () => {
    expect(unwrap(assertReadOnly({ method: "POST", path: "/api/v1/logs-analytics/list?type=logs" }))).toBeNull();
  });

  it("names the route without its query string when it refuses one", () => {
    const error = unwrapErr(assertReadOnly({ method: "POST", path: "/api/v1/dashboard?x=1" }));
    expect(error.code).toBe("READ_ONLY_ROUTE_REFUSED");
    expect(datadogQueryErrorLines({ error })[0]).toBe(
      "refusing to POST /api/v1/dashboard: it is not one of the routes recorded as read-only",
    );
  });

  it("refuses an empty path as the empty route", () => {
    const error = unwrapErr(assertReadOnly({ method: "POST", path: "" }));
    expect(datadogQueryErrorLines({ error })[0]).toBe(
      "refusing to POST : it is not one of the routes recorded as read-only",
    );
  });

  it("refuses a POST that is not on the list, and says where to add one", () => {
    const error = unwrapErr(assertReadOnly({ method: "POST", path: "/api/v1/dashboard" }));
    expect(error.code).toBe("READ_ONLY_ROUTE_REFUSED");
    const errors = datadogQueryErrorLines({ error });
    expect(errors[0]).toContain("refusing to POST /api/v1/dashboard");
    expect(errors[1]).toContain("the raw path never changes Datadog configuration");
    expect(errors[2]).toContain("READ_ONLY_POST_ROUTES in datadog/rawTransport.ts");
  });

  it("carries both aggregate routes, which is what lets the two oracles cross-check", () => {
    expect(READ_ONLY_POST_ROUTES.has("/api/v2/logs/analytics/aggregate")).toBe(true);
    expect(READ_ONLY_POST_ROUTES.has("/api/v2/spans/analytics/aggregate")).toBe(true);
  });

  it("carries both v2 query routes, needed for cloud_cost reads that metricsScalar.ts's fixed dataSource cannot reach", () => {
    expect(READ_ONLY_POST_ROUTES.has("/api/v2/query/scalar")).toBe(true);
    expect(READ_ONLY_POST_ROUTES.has("/api/v2/query/timeseries")).toBe(true);
  });

  it("allows a v2 query route as a POST, the only form it takes", () => {
    expect(unwrap(assertReadOnly({ method: "POST", path: "/api/v2/query/scalar" }))).toBeNull();
    expect(unwrap(assertReadOnly({ method: "POST", path: "/api/v2/query/timeseries" }))).toBeNull();
  });
});

describe("classifyRawStatus — the distinctions that change what a reader concludes", () => {
  it("says a 400 is a wrong request shape and NOT empty", () => {
    const reasons = classifyRawStatus({ status: 400, path: "/p", raw: '{"code":"InvalidArgument"}' });
    expect(reasons[1]).toContain("reachable-but-wrong-request-shape, NOT empty");
  });

  it("says a 403 is not an auth verdict for the whole estate", () => {
    expect(classifyRawStatus({ status: 403, path: "/p", raw: "Forbidden" })[1]).toContain(
      "not an auth verdict for the estate",
    );
  });

  it("says a 404 may be a moved path rather than an absent product", () => {
    expect(classifyRawStatus({ status: 404, path: "/p", raw: "" })[1]).toContain(
      "several documented Datadog paths have moved",
    );
  });

  it("reports an unclassified status with its code", () => {
    expect(classifyRawStatus({ status: 502, path: "/p", raw: "bad gateway" })[0]).toContain("HTTP 502");
  });
});

describe("createRawTransport — answers text, never interprets it", () => {
  it("answers the body byte for byte with its status and rate-limit budget", async () => {
    const text = '{"hitCount":7,  "spacing":"kept"}\n';
    const { fetchImpl } = replaying({
      responses: [
        {
          status: 200,
          body: text,
          headers: { "x-ratelimit-limit": "85", "x-ratelimit-name": "example_queries_execute_request" },
        },
      ],
    });
    const { logger } = collectingLogger();
    const transport = createRawTransport({ config: CONFIG, logger, fetchImpl });
    const response = unwrap(
      await transport.requestRawText({ body: {}, method: "POST", path: "/api/v1/logs-analytics/list?type=logs" }),
    );
    expect(response.bodyText).toBe(text);
    expect(response.status).toBe(200);
    expect(response.rateLimit!.limit).toBe(85);
    expect(transport.lastRateLimit()!.name).toBe("example_queries_execute_request");
  });

  it("answers a 2xx that is not JSON as a success, since only the caller knows what it expected", async () => {
    const { fetchImpl } = replaying({ responses: [{ status: 200, body: "<html>gateway</html>" }] });
    const { logger } = collectingLogger();
    const response = unwrap(
      await createRawTransport({ config: CONFIG, logger, fetchImpl }).requestRawText({ method: "GET", path: "/p" }),
    );
    expect(response.bodyText).toBe("<html>gateway</html>");
  });

  it("sends the method, the body, both credential headers and the site host, never a hard-coded one", async () => {
    const { fetchImpl, calls } = replaying({ responses: [{ status: 200, body: "{}" }] });
    const { logger } = collectingLogger();
    await createRawTransport({ config: CONFIG, logger, fetchImpl }).requestRawText({
      body: { a: 1 },
      method: "POST",
      path: "/api/v1/logs-analytics/list",
    });
    expect(calls).toEqual([
      {
        body: '{"a":1}',
        headers: {
          "content-type": "application/json",
          "dd-api-key": CONFIG.apiKey,
          "dd-application-key": CONFIG.appKey,
        },
        method: "POST",
        url: "https://api.us3.datadoghq.com/api/v1/logs-analytics/list",
      },
    ]);
  });

  it("reports a network failure as never having reached Datadog, with no status to read", async () => {
    const { logger } = collectingLogger();
    const fetchImpl: FetchLike = () => Promise.reject(new Error("ENOTFOUND"));
    const failure = unwrapErr(
      await createRawTransport({ config: CONFIG, logger, fetchImpl }).requestRawTextWithStatus({
        method: "GET",
        path: "/p",
      }),
    );
    expect(failure.status).toBeNull();
    expect(failure.reasons[0]).toContain("never reached Datadog");
  });

  it("keeps a non-2xx status on the failure arm", async () => {
    const { fetchImpl } = replaying({ responses: [{ status: 403, body: "Forbidden" }] });
    const { logger } = collectingLogger();
    const failure = unwrapErr(
      await createRawTransport({ config: CONFIG, logger, fetchImpl }).requestRawTextWithStatus({
        method: "GET",
        path: "/p",
      }),
    );
    expect(failure.status).toBe(403);
    expect(failure.reasons[1]).toContain("not an auth verdict for the estate");
  });
});

describe("createRawTransport — the retry loop reads the reset header", () => {
  it("waits the header's reset and then succeeds, announcing the wait", async () => {
    const { fetchImpl, calls } = replaying({
      responses: [
        {
          status: 429,
          body: '{"errors":["Too many requests"]}',
          headers: { "x-ratelimit-reset": "9", "x-ratelimit-name": "logs_public_analytics_aggregate" },
        },
        { status: 200, body: '{"hitCount":7}' },
      ],
    });
    const { logger, lines } = collectingLogger();
    const { sleep, waits } = recordingSleep();
    const result = await createRawTransport({ config: CONFIG, logger, fetchImpl, sleep }).requestRawText({
      body: {},
      method: "POST",
      path: "/api/v2/logs/analytics/aggregate",
    });
    expect(unwrap(result).bodyText).toBe('{"hitCount":7}');
    expect(waits).toEqual([9]);
    expect(calls.length).toBe(2);
    expect(lines[0]).toContain("waiting 9s for the window to reset");
  });

  it("falls back to the base backoff when a 429 carries no reset header", async () => {
    const { fetchImpl } = replaying({
      responses: [
        { status: 429, body: "{}" },
        { status: 200, body: "{}" },
      ],
    });
    const { logger } = collectingLogger();
    const { sleep, waits } = recordingSleep();
    await createRawTransport({ config: CONFIG, logger, fetchImpl, sleep }).requestRawText({
      method: "GET",
      path: "/p",
    });
    expect(waits).toEqual([2]);
  });

  it("falls back to the base backoff when a 429 is metered but names no reset", async () => {
    const { fetchImpl } = replaying({
      responses: [
        { status: 429, body: "{}", headers: { "x-ratelimit-name": "logs_public_analytics_aggregate" } },
        { status: 200, body: "{}" },
      ],
    });
    const { logger } = collectingLogger();
    const { sleep, waits } = recordingSleep();
    await createRawTransport({ config: CONFIG, logger, fetchImpl, sleep }).requestRawText({
      method: "GET",
      path: "/p",
    });
    expect(waits).toEqual([2]);
  });

  it("waits a zero-second reset as zero rather than as a missing one", async () => {
    const { fetchImpl } = replaying({
      responses: [
        { status: 429, body: "{}", headers: { "x-ratelimit-reset": "0" } },
        { status: 200, body: "{}" },
      ],
    });
    const { logger } = collectingLogger();
    const { sleep, waits } = recordingSleep();
    await createRawTransport({ config: CONFIG, logger, fetchImpl, sleep }).requestRawText({
      method: "GET",
      path: "/p",
    });
    expect(waits).toEqual([0]);
  });

  it("gives up after the retry budget and reports the rate limit rather than looping", async () => {
    const { fetchImpl, calls } = replaying({
      responses: [{ status: 429, body: '{"errors":["Too many requests"]}', headers: { "x-ratelimit-reset": "1" } }],
    });
    const { logger } = collectingLogger();
    const { sleep, waits } = recordingSleep();
    const result = await createRawTransport({ config: CONFIG, logger, fetchImpl, sleep }).requestRawText({
      method: "GET",
      path: "/p",
    });
    expect(unwrapErr(result)[0]).toContain("rate limited and the retries were exhausted");
    // Four attempts: the first plus RATE_LIMIT_MAX_RETRIES of 3, so three waits.
    expect(calls.length).toBe(4);
    expect(waits).toEqual([1, 1, 1]);
  });

  it("does not retry a 400, because a wrong body shape will not fix itself", async () => {
    const { fetchImpl, calls } = replaying({
      responses: [{ status: 400, body: '{"errors":["No valid indexes specified"]}' }],
    });
    const { logger } = collectingLogger();
    const { sleep, waits } = recordingSleep();
    const result = await createRawTransport({ config: CONFIG, logger, fetchImpl, sleep }).requestRawText({
      method: "GET",
      path: "/p",
    });
    expect(unwrapErr(result)[0]).toContain("HTTP 400");
    expect(calls.length).toBe(1);
    expect(waits).toEqual([]);
  });

  it("refuses a disallowed POST without issuing any request at all", async () => {
    const { fetchImpl, calls } = replaying({ responses: [{ status: 200, body: "{}" }] });
    const { logger } = collectingLogger();
    const result = await createRawTransport({ config: CONFIG, logger, fetchImpl }).requestRawText({
      body: {},
      method: "POST",
      path: "/api/v1/monitor",
    });
    expect(unwrapErr(result)[0]).toContain("refusing to POST");
    expect(calls).toEqual([]);
  });
});
