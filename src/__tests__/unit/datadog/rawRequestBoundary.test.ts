/**
 * `rawRequesterFrom`: every typed Datadog raw read crosses its endpoint's strict boundary, and a refusal names the
 * key that drifted — never the value Datadog sent — while the HTTP status and the budget ride through.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineBoundary } from "#lib/boundary.js";

import type { RateLimitSnapshot } from "../../../datadog/rateLimit.js";
import { rawRequesterFrom } from "../../../datadog/rawRequest.js";
import { type RawFailure, type RawTextResponse, rawTransportFrom } from "../../../datadog/rawTransport.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";

const BOUNDARY = defineBoundary({
  endpoint: "GET /api/v1/example",
  schema: z.strictObject({ hitCount: z.number(), status: z.string() }),
});

const BUDGET: RateLimitSnapshot = {
  limit: 85,
  name: "example_queries_execute_request",
  period: 10,
  remaining: 84,
  resetSeconds: 7,
};

/** A sentinel no refusal may print, planted in the answer whose shape is refused. */
const SENTINEL = "sentinel-value-9f3c";

/** A requester over a transport answering one fixed result, recording what it was asked. */
function answering({ answer }: { answer: Result<RawTextResponse, RawFailure> }): {
  requester: ReturnType<typeof rawRequesterFrom>;
  asked: { method: string; path: string; body: unknown }[];
} {
  const asked: { method: string; path: string; body: unknown }[] = [];
  const transport = rawTransportFrom({
    lastRateLimit: () => BUDGET,
    requestRawTextWithStatus: async ({ method, path, body }) => {
      asked.push({ body, method, path });
      return answer;
    },
  });
  return { asked, requester: rawRequesterFrom({ transport }) };
}

/** A 200 carrying this text. */
function okText({ text }: { text: string }): Result<RawTextResponse, RawFailure> {
  return ok({ bodyText: text, rateLimit: BUDGET, status: 200 });
}

describe("rawRequesterFrom — a body crosses the endpoint's boundary", () => {
  it("reads a body the boundary admits, carrying its status and budget", async () => {
    const { requester, asked } = answering({ answer: okText({ text: '{"hitCount":7,"status":"done"}' }) });
    const response = unwrap(
      await requester.request({
        body: { a: 1 },
        boundary: BOUNDARY,
        method: "POST",
        path: "/api/v1/logs-analytics/list",
      }),
    );
    expect(response).toEqual({ body: { hitCount: 7, status: "done" }, rateLimit: BUDGET, status: 200 });
    expect(asked).toEqual([{ body: { a: 1 }, method: "POST", path: "/api/v1/logs-analytics/list" }]);
    expect(requester.lastRateLimit()).toEqual(BUDGET);
  });

  it("refuses a key Datadog added, naming the key and never its value, and keeps the 200", async () => {
    const { requester } = answering({
      answer: okText({ text: `{"hitCount":7,"status":"done","addedField":"${SENTINEL}"}` }),
    });
    const failure = unwrapErr(await requester.requestWithStatus({ boundary: BOUNDARY, method: "GET", path: "/p" }));
    expect(failure.status).toBe(200);
    expect(failure.rateLimit).toEqual(BUDGET);
    expect(failure.reasons[0]).toContain('new field "addedField"');
    expect(failure.reasons[0]).toContain("GET /api/v1/example");
    expect(failure.reasons[1]).toBe(
      "this is a malformed response, NOT an empty result — the request may have been rejected in a way the status code did not show",
    );
    expect(failure.reasons.join("\n")).not.toContain(SENTINEL);
  });

  it("refuses a missing key and a retyped one by name", async () => {
    const { requester } = answering({ answer: okText({ text: '{"status":7}' }) });
    const reasons = unwrapErr(await requester.request({ boundary: BOUNDARY, method: "GET", path: "/p" }));
    expect(reasons[0]).toContain('field "hitCount" is missing');
    expect(reasons[0]).toContain('field "status" changed');
  });

  it("refuses a 200 that is not JSON as malformed, never as zero, without echoing the text", async () => {
    const { requester } = answering({ answer: okText({ text: `<html>${SENTINEL}</html>` }) });
    const failure = unwrapErr(await requester.requestWithStatus({ boundary: BOUNDARY, method: "GET", path: "/p" }));
    expect(failure.status).toBe(200);
    expect(failure.reasons).toEqual([
      "GET /api/v1/example answered a body that is not JSON",
      "this is a malformed response, NOT an empty result — reading it as zero would be a confident wrong answer",
    ]);
  });

  it("passes a transport failure through unchanged, status and all", async () => {
    const refused: RawFailure = { rateLimit: null, reasons: ["/p returned HTTP 403: Forbidden"], status: 403 };
    const { requester } = answering({ answer: err(refused) });
    expect(unwrapErr(await requester.requestWithStatus({ boundary: BOUNDARY, method: "GET", path: "/p" }))).toEqual(
      refused,
    );
    expect(unwrapErr(await requester.request({ boundary: BOUNDARY, method: "GET", path: "/p" }))).toEqual(
      refused.reasons,
    );
  });
});
