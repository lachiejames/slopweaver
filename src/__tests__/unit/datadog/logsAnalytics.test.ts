import { describe, expect, it } from "vitest";

import { LOGS_ANALYTICS_LIMIT, logsAnalyticsCount, SPANS_TRACK_UNAVAILABLE } from "../../../datadog/logsAnalytics.js";
import { datadogQueryErrorLines } from "../../../datadog/queryErrors.js";
import { type RawRequester, rawRequesterFrom } from "../../../datadog/rawRequest.js";
import { rawTransportFrom } from "../../../datadog/rawTransport.js";
import { ok, unwrap, unwrapErr } from "../../../lib/result.js";

const WINDOW = { fromMs: 1_785_844_800_000, toMs: 1_785_848_400_000 };

/** A requester whose transport answers one body as text, so the REAL boundary reads it. */
function replaying({ body }: { body: unknown }): {
  requester: RawRequester;
  calls: { method: string; path: string; body: unknown }[];
} {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const transport = rawTransportFrom({
    lastRateLimit: () => null,
    requestRawTextWithStatus: async (input) => {
      calls.push({ method: input.method, path: input.path, body: input.body });
      return ok({ bodyText: JSON.stringify(body), rateLimit: null, status: 200 });
    },
  });
  return { requester: rawRequesterFrom({ transport }), calls };
}

/** The measured happy-path body: hitCount and result.count agree, status done, no rows. */
function goodBody({ count = 7 }: { count?: number } = {}): {
  elapsed: number;
  hitCount: number;
  requestId: string;
  status: string;
  type: string;
  result: { count: number; events: unknown[] };
} {
  return {
    elapsed: 377,
    hitCount: count,
    requestId: "example-request-id",
    status: "done",
    type: "logs",
    result: { count, events: [] },
  };
}

describe("logsAnalyticsCount — the wire shape", () => {
  it("reads hitCount off the response", async () => {
    const { requester } = replaying({ body: goodBody() });
    const counted = unwrap(
      await logsAnalyticsCount({ requester, query: "service:example-api status:error", window: WINDOW }),
    );
    expect(counted.count).toBe(7);
    expect(counted.track).toBe("logs");
    expect(counted.query).toBe("service:example-api status:error");
  });

  it("sends the mandatory `list` wrapper, since a flat body is a hard 400", async () => {
    const { requester, calls } = replaying({ body: goodBody() });
    await logsAnalyticsCount({ requester, query: "q", window: WINDOW });
    expect(calls[0]?.path).toBe("/api/v1/logs-analytics/list?type=logs");
    expect(calls[0]?.body).toEqual({
      list: { search: { query: "q" }, time: { from: WINDOW.fromMs, to: WINDOW.toMs }, limit: LOGS_ANALYTICS_LIMIT },
    });
  });

  it("asks for zero rows, because a count is not a disclosure and a body is", () => {
    expect(LOGS_ANALYTICS_LIMIT).toBe(0);
  });

  it("reads a genuine zero as a zero", async () => {
    const { requester } = replaying({ body: goodBody({ count: 0 }) });
    const result = await logsAnalyticsCount({ requester, query: "q", window: WINDOW });
    expect(unwrap(result).count).toBe(0);
  });

  it("targets the requested track", async () => {
    const { requester, calls } = replaying({ body: { ...goodBody(), type: "citest" } });
    await logsAnalyticsCount({ requester, query: "q", window: WINDOW, track: "citest" });
    expect(calls[0]?.path).toBe("/api/v1/logs-analytics/list?type=citest");
  });

  it("records why the spans track is not one of them", () => {
    expect(SPANS_TRACK_UNAVAILABLE).toContain('HTTP 400 "No valid indexes specified"');
  });
});

describe("logsAnalyticsCount — what it refuses", () => {
  it("refuses a status other than done, because a partial count is not a smaller true count", async () => {
    const { requester } = replaying({ body: { ...goodBody(), status: "timeout" } });
    const error = unwrapErr(await logsAnalyticsCount({ requester, query: "q", window: WINDOW }));
    expect(error.code).toBe("ANALYTICS_INCOMPLETE");
    const errors = datadogQueryErrorLines({ error });
    expect(errors[0]).toContain("reported status 'timeout'");
    expect(errors[1]).toContain("not a smaller true count");
  });

  it("refuses a body whose two totals disagree, since neither could then be an oracle", async () => {
    const { requester } = replaying({ body: { ...goodBody({ count: 7 }), result: { count: 9, events: [] } } });
    const error = unwrapErr(await logsAnalyticsCount({ requester, query: "q", window: WINDOW }));
    expect(error.code).toBe("ANALYTICS_TOTAL_MISMATCH");
    const errors = datadogQueryErrorLines({ error });
    expect(errors[0]).toContain("hitCount 7 but result.count 9");
    expect(errors[1]).toContain("neither can be used as an independent oracle");
  });

  it("refuses event rows if any ever arrive, guarding the disclosure promise structurally", async () => {
    const { requester } = replaying({
      body: { ...goodBody(), result: { count: 7, events: [{ event: { message: "anything" }, id: "x" }] } },
    });
    const error = unwrapErr(await logsAnalyticsCount({ requester, query: "q", window: WINDOW }));
    expect(error.code).toBe("ANALYTICS_ROWS_DISCLOSED");
    const errors = datadogQueryErrorLines({ error });
    expect(errors[0]).toContain("returned 1 event rows");
    expect(errors[1]).toContain("a row is a disclosure a count is not");
  });

  it("treats an absent hitCount as unreadable rather than as zero", async () => {
    const { requester } = replaying({ body: { status: "done", result: { count: 0, events: [] } } });
    const result = await logsAnalyticsCount({ requester, query: "q", window: WINDOW });
    const error = unwrapErr(result);
    expect(error.code).toBe("QUERY_REQUEST_FAILED");
    expect(datadogQueryErrorLines({ error })[0]).toContain('field "hitCount" is missing');
  });

  it("refuses a key Datadog adds to the envelope or to the result, by name", async () => {
    const top = replaying({ body: { ...goodBody(), addedTop: 1 } });
    const topError = unwrapErr(await logsAnalyticsCount({ requester: top.requester, query: "q", window: WINDOW }));
    expect(datadogQueryErrorLines({ error: topError })[0]).toContain('new field "addedTop"');
    const nested = replaying({ body: { ...goodBody(), result: { count: 7, events: [], addedNested: 1 } } });
    const nestedError = unwrapErr(
      await logsAnalyticsCount({ requester: nested.requester, query: "q", window: WINDOW }),
    );
    expect(datadogQueryErrorLines({ error: nestedError })[0]).toContain('new field "result.addedNested"');
    expect(datadogQueryErrorLines({ error: nestedError })[0]).toContain(
      "POST /api/v1/logs-analytics/list?type=logs (limit 0)",
    );
  });

  it("accepts a body with no events key at all, which means the same as an empty one", async () => {
    const { requester } = replaying({ body: { hitCount: 3, status: "done", result: { count: 3 } } });
    const result = await logsAnalyticsCount({ requester, query: "q", window: WINDOW });
    expect(unwrap(result).count).toBe(3);
  });
});
