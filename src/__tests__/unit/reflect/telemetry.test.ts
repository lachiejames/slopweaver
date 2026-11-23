/**
 * The reflection loop's telemetry leg.
 *
 * The assertion this file exists for is the one the phase was gated on: **an aged-out window and an
 * empty-but-live window must not read the same.** Everything else here is the machinery that keeps that
 * true — the horizon classification, the projection, and the residue that carries it into the output.
 *
 * No mocks: the page reader is a plain function passed in, and the retention reader takes a plain object
 * that satisfies `RawRequester`. Both are injected seams, not `vi.fn`.
 */
import { describe, expect, it } from "vitest";

import { type RawRequester, rawRequesterFrom } from "../../../datadog/rawRequest.js";
import { rawTransportFrom } from "../../../datadog/rawTransport.js";
import { err, ok, type Result, unwrap, unwrapErr } from "../../../lib/result.js";
import { type TelemetryReadError, TelemetryReadErrors } from "../../../reflect/errors.js";
import {
  classifyWindowCoverage,
  projectToolExecutionError,
  type RetentionHorizon,
  readToolExecutionErrors,
  type TelemetryPage,
  type TelemetryPageFetcher,
  TOOL_ERROR_QUERY,
} from "../../../reflect/telemetry.js";
import { RETENTION_PATH } from "../../../reflect/telemetryBoundaries.js";
import { describeResidue } from "../../../reflect/telemetryResidue.js";
import { createTelemetryPageFetcher, eventsPath, readRetentionHorizon } from "../../../reflect/telemetrySource.js";

const DAY_MS = 86_400_000;
const NOW_MS = 1_787_860_000_000;
const RETENTION_15D: RetentionHorizon = { maxDays: 15, minDays: 15 };

/** One wire-shaped `claude_code.tool_result` failure, with the fields the projection reads. */
function wireEvent({
  toolName = "Bash",
  error = "Shell command failed",
  errorType = "ShellError",
  durationMs = "58",
  toolUseId = "toolu_01ESEZQZDtTn6yKFu11aYGib",
  traceId = "42e1b0e9f23a61272429ab34e64ca3ef",
  timestamp = "2026-08-27T19:42:06.712Z",
}: {
  toolName?: string;
  /** `null` omits the field, the wire shape since the exporter stopped sending error text. */
  error?: string | null;
  errorType?: string;
  durationMs?: string;
  toolUseId?: string;
  traceId?: string;
  timestamp?: string;
} = {}): unknown {
  const errorField = error === null ? {} : { error };
  return {
    attributes: {
      attributes: {
        duration_ms: durationMs,
        ...errorField,
        error_type: errorType,
        otel: { trace_id: traceId },
        tool_name: toolName,
        tool_use_id: toolUseId,
      },
      timestamp,
    },
  };
}

/** A page reader over fixed pages, which also records how many times it was asked. */
function pagesFetcher({ pages }: { pages: readonly TelemetryPage[] }): {
  fetch: TelemetryPageFetcher;
  calls: () => number;
} {
  let calls = 0;
  const fetch: TelemetryPageFetcher = async (input) => {
    const page = pages[calls]!;
    calls += 1;
    expect(input.query).toBe(TOOL_ERROR_QUERY);
    return ok(page);
  };
  return { calls: () => calls, fetch };
}

/** A page reader that always refuses, so the failure path is reachable without a network. */
const refusingFetcher: TelemetryPageFetcher = async (input) =>
  err<TelemetryPage, TelemetryReadError>(
    TelemetryReadErrors.queryFailed({ query: input.query, reasons: ["datadog answered HTTP 403"] }),
  );

/** A `RawRequester` whose transport answers every request with one fixed body as JSON text, read by the REAL boundary. */
function fixedRequester({ body }: { body: unknown }): RawRequester {
  const transport = rawTransportFrom({
    lastRateLimit: () => null,
    requestRawTextWithStatus: async () => ok({ bodyText: JSON.stringify(body), rateLimit: null, status: 200 }),
  });
  return rawRequesterFrom({ transport });
}

describe("classifyWindowCoverage", () => {
  it("calls a window entirely inside the shortest retention live", () => {
    const coverage = classifyWindowCoverage({
      fromMs: NOW_MS - DAY_MS,
      nowMs: NOW_MS,
      retention: RETENTION_15D,
      toMs: NOW_MS,
    });
    expect(coverage).toBe("live");
  });

  it("calls a window that starts before the horizon partial", () => {
    const coverage = classifyWindowCoverage({
      fromMs: NOW_MS - 16 * DAY_MS,
      nowMs: NOW_MS,
      retention: RETENTION_15D,
      toMs: NOW_MS - 14 * DAY_MS,
    });
    expect(coverage).toBe("partial");
  });

  it("calls a window that ends before the horizon aged-out", () => {
    const coverage = classifyWindowCoverage({
      fromMs: NOW_MS - 30 * DAY_MS,
      nowMs: NOW_MS,
      retention: RETENTION_15D,
      toMs: NOW_MS - 20 * DAY_MS,
    });
    expect(coverage).toBe("aged-out");
  });

  it("treats the horizon itself as live rather than as already expired", () => {
    const coverage = classifyWindowCoverage({
      fromMs: NOW_MS - 15 * DAY_MS,
      nowMs: NOW_MS,
      retention: RETENTION_15D,
      toMs: NOW_MS,
    });
    expect(coverage).toBe("live");
  });

  it("stays partial while the indexes disagree about where the horizon is", () => {
    const coverage = classifyWindowCoverage({
      fromMs: NOW_MS - 10 * DAY_MS,
      nowMs: NOW_MS,
      retention: { maxDays: 30, minDays: 7 },
      toMs: NOW_MS,
    });
    expect(coverage).toBe("partial");
  });

  it("refuses to classify at all when retention could not be read", () => {
    const coverage = classifyWindowCoverage({
      fromMs: NOW_MS - DAY_MS,
      nowMs: NOW_MS,
      retention: null,
      toMs: NOW_MS,
    });
    expect(coverage).toBe("unknown");
  });
});

describe("projectToolExecutionError", () => {
  it("projects the fields a failure is made of, coercing the wire's stringly-typed duration", () => {
    const projected = projectToolExecutionError({ event: wireEvent() });
    expect(projected.isOk()).toBe(true);
    const value = unwrap(projected);
    expect(value.toolName).toBe("Bash");
    expect(value.errorType).toBe("ShellError");
    expect(value.message).toBe("Shell command failed");
    expect(value.durationMs).toBe(58);
    expect(value.toolUseId).toBe("toolu_01ESEZQZDtTn6yKFu11aYGib");
    expect(value.traceId).toBe("42e1b0e9f23a61272429ab34e64ca3ef");
    expect(value.tsIso).toBe("2026-08-27T19:42:06.712Z");
  });

  it("carries nothing that identifies a person or reproduces a prompt", () => {
    const value = unwrap(projectToolExecutionError({ event: wireEvent() }));
    expect(Object.keys(value).toSorted()).toStrictEqual([
      "durationMs",
      "errorType",
      "message",
      "toolName",
      "toolUseId",
      "traceId",
      "tsIso",
    ]);
  });

  it("projects a failure whose error text the exporter withheld as a null message", () => {
    const value = unwrap(projectToolExecutionError({ event: wireEvent({ error: null }) }));
    expect(value.message).toBe(null);
    expect(value.toolName).toBe("Bash");
    expect(value.errorType).toBe("ShellError");
  });

  it("still refuses a failure with no error_type on it", () => {
    const projected = projectToolExecutionError({
      event: { attributes: { attributes: { tool_name: "Bash" }, timestamp: "2026-08-27T19:42:06.712Z" } },
    });
    expect(projected.isErr()).toBe(true);
    expect(unwrapErr(projected).join(" | ")).toContain("attributes.attributes.error_type");
  });

  it("still refuses a failure with no tool_name on it", () => {
    const projected = projectToolExecutionError({
      event: { attributes: { attributes: { error_type: "ShellError" }, timestamp: "2026-08-27T19:42:06.712Z" } },
    });
    expect(projected.isErr()).toBe(true);
    expect(unwrapErr(projected).join(" | ")).toContain("attributes.attributes.tool_name");
  });

  it("refuses a body that is not an event at all", () => {
    expect(unwrapErr(projectToolExecutionError({ event: null }))).toEqual([
      ": Invalid input: expected object, received null",
    ]);
  });
});

describe("describeResidue", () => {
  const base = {
    cap: 500,
    errors: [],
    incompletePages: 0,
    retention: RETENTION_15D,
    truncated: false,
    unreadableEvents: 0,
  };

  it("says an aged-out empty result is unreadable, not zero", () => {
    const lines = describeResidue({ ...base, coverage: "aged-out" });
    expect(lines[0]).toContain("UNREADABLE, not zero failures");
  });

  it("says a live empty result with no projection misses really is zero, which is the opposite claim", () => {
    const lines = describeResidue({ ...base, coverage: "live" });
    expect(lines[0]).toContain("really is zero failures");
  });

  it("does not call a live empty result zero when matched events were unreadable", () => {
    const lines = describeResidue({ ...base, coverage: "live", unreadableEvents: 932 });
    expect(lines[0]).toContain("932 matched event(s) went unread, so an empty result is not proven zero failures");
    expect(lines[0]).not.toContain("really is zero failures");
  });

  it("names how many projected failures had their error text withheld", () => {
    const withheld = unwrap(projectToolExecutionError({ event: wireEvent({ error: null }) }));
    const carried = unwrap(projectToolExecutionError({ event: wireEvent() }));
    const lines = describeResidue({ ...base, coverage: "live", errors: [withheld, withheld, carried] });
    expect(lines[1]).toBe(
      "2 failure(s) carried no error text — the exporter withheld the message, so each is a tool name plus a typed error",
    );
  });

  it("calls a partial window a floor", () => {
    expect(describeResidue({ ...base, coverage: "partial" })[0]).toContain("floor");
  });

  it("says an unknown horizon cannot tell the two apart", () => {
    expect(describeResidue({ ...base, coverage: "unknown", retention: null })[0]).toContain(
      "cannot be told apart from an aged-out one",
    );
  });

  it("names the cap when the read stopped early", () => {
    const lines = describeResidue({ ...base, cap: 10, coverage: "live", truncated: true });
    expect(lines[1]).toBe("stopped at the 10-error cap, so this is a prefix of the window and not all of it");
  });

  it("counts events it could not project instead of dropping them", () => {
    const lines = describeResidue({ ...base, coverage: "live", unreadableEvents: 3 });
    expect(lines[1]).toContain("3 matched event(s) did not carry the tool_result shape");
  });

  it("names pages Datadog did not finish", () => {
    const lines = describeResidue({ ...base, coverage: "live", incompletePages: 2 });
    expect(lines[1]).toContain("2 page(s) came back with a status other than 'done'");
  });

  it("always ends with the content bound and the fleet bound, in that order", () => {
    const lines = describeResidue({ ...base, coverage: "live" });
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("no prompt text, tool input or user identity is read");
    expect(lines[2]).toContain("never automatically the fleet");
  });
});

describe("readToolExecutionErrors", () => {
  const window = { fromMs: NOW_MS - DAY_MS, nowMs: NOW_MS, toMs: NOW_MS };

  it("reads an empty-but-live window as a measurement of zero", async () => {
    const fetcher = pagesFetcher({ pages: [{ events: [], nextCursor: null, status: "done" }] });
    const reading = unwrap(
      await readToolExecutionErrors({ ...window, fetchPage: fetcher.fetch, retention: RETENTION_15D }),
    );
    expect(reading.coverage).toBe("live");
    expect(reading.errors).toStrictEqual([]);
    expect(reading.pagesRead).toBe(1);
    expect(fetcher.calls()).toBe(1);
    expect(reading.residue[0]).toContain("really is zero failures");
  });

  it("reads an aged-out window as unreadable, and does not query it at all", async () => {
    const fetcher = pagesFetcher({ pages: [{ events: [wireEvent()], nextCursor: null, status: "done" }] });
    const reading = unwrap(
      await readToolExecutionErrors({
        fetchPage: fetcher.fetch,
        fromMs: NOW_MS - 30 * DAY_MS,
        nowMs: NOW_MS,
        retention: RETENTION_15D,
        toMs: NOW_MS - 20 * DAY_MS,
      }),
    );
    expect(reading.coverage).toBe("aged-out");
    expect(reading.errors).toStrictEqual([]);
    expect(reading.pagesRead).toBe(0);
    expect(fetcher.calls()).toBe(0);
    expect(reading.residue[0]).toContain("UNREADABLE, not zero failures");
  });

  it("gives the two empty readings different residue, which is the whole point", async () => {
    const live = unwrap(
      await readToolExecutionErrors({
        ...window,
        fetchPage: pagesFetcher({ pages: [{ events: [], nextCursor: null, status: "done" }] }).fetch,
        retention: RETENTION_15D,
      }),
    );
    const aged = unwrap(
      await readToolExecutionErrors({
        fetchPage: pagesFetcher({ pages: [] }).fetch,
        fromMs: NOW_MS - 30 * DAY_MS,
        nowMs: NOW_MS,
        retention: RETENTION_15D,
        toMs: NOW_MS - 20 * DAY_MS,
      }),
    );
    expect(live.errors.length).toBe(aged.errors.length);
    expect(live.residue[0]).not.toBe(aged.residue[0]);
    expect(live.coverage).not.toBe(aged.coverage);
  });

  it("pages until the cursor runs out", async () => {
    const fetcher = pagesFetcher({
      pages: [
        { events: [wireEvent(), wireEvent({ toolName: "Read" })], nextCursor: "after-1", status: "done" },
        { events: [wireEvent({ toolName: "Edit" })], nextCursor: null, status: "done" },
      ],
    });
    const reading = unwrap(
      await readToolExecutionErrors({ ...window, fetchPage: fetcher.fetch, retention: RETENTION_15D }),
    );
    expect(reading.pagesRead).toBe(2);
    expect(reading.errors.map((error) => error.toolName)).toStrictEqual(["Bash", "Read", "Edit"]);
    expect(reading.truncated).toBe(false);
  });

  it("stops at the cap and reports the reading as a prefix", async () => {
    const fetcher = pagesFetcher({
      pages: [{ events: [wireEvent(), wireEvent(), wireEvent()], nextCursor: "after-1", status: "done" }],
    });
    const reading = unwrap(
      await readToolExecutionErrors({ ...window, cap: 2, fetchPage: fetcher.fetch, retention: RETENTION_15D }),
    );
    expect(reading.errors).toHaveLength(2);
    expect(reading.truncated).toBe(true);
    expect(reading.pagesRead).toBe(1);
    expect(reading.residue[1]).toContain("2-error cap");
  });

  it("reads an errorless wire failure as a failure with a withheld message", async () => {
    const fetcher = pagesFetcher({
      pages: [{ events: [wireEvent({ error: null })], nextCursor: null, status: "done" }],
    });
    const reading = unwrap(
      await readToolExecutionErrors({ ...window, fetchPage: fetcher.fetch, retention: RETENTION_15D }),
    );
    expect(reading.errors).toHaveLength(1);
    expect(reading.errors[0]!.message).toBe(null);
    expect(reading.unreadableEvents).toBe(0);
    expect(reading.residue[1]).toContain("1 failure(s) carried no error text");
  });

  it("counts an event it cannot project without losing the ones it can", async () => {
    const fetcher = pagesFetcher({
      pages: [
        {
          events: [
            wireEvent(),
            { attributes: { attributes: { tool_name: "Bash" }, timestamp: "2026-08-27T19:42:06.712Z" } },
          ],
          nextCursor: null,
          status: "done",
        },
      ],
    });
    const reading = unwrap(
      await readToolExecutionErrors({ ...window, fetchPage: fetcher.fetch, retention: RETENTION_15D }),
    );
    expect(reading.errors).toHaveLength(1);
    expect(reading.unreadableEvents).toBe(1);
    expect(reading.residue[1]).toContain("1 matched event(s)");
  });

  it("names a page Datadog did not finish", async () => {
    const fetcher = pagesFetcher({ pages: [{ events: [wireEvent()], nextCursor: null, status: "timeout" }] });
    const reading = unwrap(
      await readToolExecutionErrors({ ...window, fetchPage: fetcher.fetch, retention: RETENTION_15D }),
    );
    expect(reading.residue[1]).toContain("1 page(s) came back with a status other than 'done'");
  });

  it("refuses a window that does not run forwards", async () => {
    const reading = await readToolExecutionErrors({
      fetchPage: pagesFetcher({ pages: [] }).fetch,
      fromMs: NOW_MS,
      nowMs: NOW_MS,
      retention: RETENTION_15D,
      toMs: NOW_MS - DAY_MS,
    });
    expect(reading.isErr()).toBe(true);
    expect(unwrapErr(reading).code).toBe("WINDOW_INVALID");
  });

  it("passes a refusal through rather than reporting it as an empty window", async () => {
    const reading = await readToolExecutionErrors({ ...window, fetchPage: refusingFetcher, retention: RETENTION_15D });
    expect(reading.isErr()).toBe(true);
    expect(unwrapErr(reading).code).toBe("QUERY_FAILED");
    expect(unwrapErr(reading).message).toContain("datadog answered HTTP 403");
  });

  it("reads a window it cannot place against a horizon as unknown, and still returns the errors", async () => {
    const fetcher = pagesFetcher({ pages: [{ events: [wireEvent()], nextCursor: null, status: "done" }] });
    const reading = unwrap(await readToolExecutionErrors({ ...window, fetchPage: fetcher.fetch, retention: null }));
    expect(reading.coverage).toBe("unknown");
    expect(reading.errors).toHaveLength(1);
  });
});

describe("eventsPath", () => {
  it("encodes the query, pins both bounds and sorts newest first", () => {
    const path = eventsPath({ cursor: null, fromMs: 1, limit: 200, query: TOOL_ERROR_QUERY, toMs: 2 });
    expect(path).toBe(
      "/api/v2/logs/events?filter%5Bfrom%5D=1&filter%5Bquery%5D=service%3Aclaude-code+%40event.name%3Atool_result+%40success%3Afalse&filter%5Bto%5D=2&page%5Blimit%5D=200&sort=-timestamp",
    );
  });

  it("carries the cursor only once there is one", () => {
    const first = eventsPath({ cursor: null, fromMs: 1, limit: 10, query: "*", toMs: 2 });
    const next = eventsPath({ cursor: "after-1", fromMs: 1, limit: 10, query: "*", toMs: 2 });
    expect(first).not.toContain("page%5Bcursor%5D");
    expect(next).toContain("page%5Bcursor%5D=after-1");
  });
});

describe("readRetentionHorizon", () => {
  it("spans every index that declares a retention", async () => {
    const horizon = await readRetentionHorizon({
      requester: fixedRequester({
        body: {
          indexes: [
            { name: "main", num_retention_days: 15 },
            { name: "ci-failure-analysis", num_retention_days: 30 },
          ],
        },
      }),
    });
    expect(unwrap(horizon)).toStrictEqual({ maxDays: 30, minDays: 15 });
  });

  it("reads the measured index shape, every key Datadog sends declared", async () => {
    const index = {
      daily_limit: null,
      daily_limit_reset: null,
      daily_limit_warning_threshold_percentage: null,
      exclusion_filters: [],
      filter: { query: "*" },
      is_rate_limited: false,
      name: "main",
      num_flex_logs_retention_days: 0,
      num_retention_days: 15,
    };
    const horizon = await readRetentionHorizon({ requester: fixedRequester({ body: { indexes: [index] } }) });
    expect(unwrap(horizon)).toStrictEqual({ maxDays: 15, minDays: 15 });
  });

  it("refuses an empty index list, rather than assuming a horizon", async () => {
    const horizon = await readRetentionHorizon({ requester: fixedRequester({ body: { indexes: [] } }) });
    expect(unwrapErr(horizon)).toEqual([
      `${RETENTION_PATH} named no index with a retention, so the aged-out horizon is unknown`,
      "an empty telemetry window cannot be told apart from an expired one without it",
    ]);
  });

  it("refuses an index with no retention, an absent list, and an added key, each by name", async () => {
    const noRetention = await readRetentionHorizon({
      requester: fixedRequester({ body: { indexes: [{ name: "main" }] } }),
    });
    expect(unwrapErr(noRetention)[0]).toContain('field "indexes[0].num_retention_days" is missing');
    const absent = await readRetentionHorizon({ requester: fixedRequester({ body: {} }) });
    expect(unwrapErr(absent)[0]).toContain('field "indexes" is missing');
    const added = await readRetentionHorizon({
      requester: fixedRequester({ body: { indexes: [{ added: 1, name: "main", num_retention_days: 15 }] } }),
    });
    expect(unwrapErr(added)[0]).toContain('new field "indexes[0].added"');
    expect(unwrapErr(added)[0]).toContain("GET /api/v1/logs/config/indexes");
  });
});

describe("createTelemetryPageFetcher", () => {
  it("reads Datadog's cursor and status off the wire shape", async () => {
    const fetcher = createTelemetryPageFetcher({
      requester: fixedRequester({
        body: { data: [wireEvent()], meta: { page: { after: "after-1" }, status: "done" } },
      }),
    });
    const page = unwrap(await fetcher({ cursor: null, fromMs: 1, limit: 10, query: TOOL_ERROR_QUERY, toMs: 2 }));
    expect(page.events).toHaveLength(1);
    expect(page.nextCursor).toBe("after-1");
    expect(page.status).toBe("done");
  });

  it("reads the measured last page, which carries no links and no page object, as having no cursor", async () => {
    const fetcher = createTelemetryPageFetcher({
      requester: fixedRequester({ body: { data: [], meta: { elapsed: 9, request_id: "r", status: "done" } } }),
    });
    const page = unwrap(await fetcher({ cursor: null, fromMs: 1, limit: 10, query: TOOL_ERROR_QUERY, toMs: 2 }));
    expect(page.nextCursor).toBe(null);
    expect(page.status).toBe("done");
  });

  it("refuses a page with no status, a page object with no cursor, and an added key, each by name", async () => {
    const refusal = async ({ body }: { body: unknown }): Promise<{ code: string; message: string }> => {
      const fetcher = createTelemetryPageFetcher({ requester: fixedRequester({ body }) });
      return unwrapErr(await fetcher({ cursor: null, fromMs: 1, limit: 10, query: TOOL_ERROR_QUERY, toMs: 2 }));
    };
    const read = async ({ body }: { body: unknown }): Promise<string> => (await refusal({ body })).message;
    // A drifted page is a query that could not be believed, never an empty one.
    expect((await refusal({ body: { data: [], meta: {} } })).code).toBe("QUERY_FAILED");
    expect(await read({ body: { data: [], meta: {} } })).toContain('field "meta.status" is missing');
    expect(await read({ body: { data: [], meta: { page: {}, status: "done" } } })).toContain(
      'field "meta.page.after" is missing',
    );
    const added = await read({ body: { data: [{ attributes: {}, added: 1 }], meta: { status: "done" } } });
    expect(added).toContain('new field "data[0].added"');
    expect(added).toContain("GET /api/v2/logs/events");
  });

  it("turns a refusal into a typed QUERY_FAILED rather than an empty page", async () => {
    const transport = rawTransportFrom({
      lastRateLimit: () => null,
      requestRawTextWithStatus: async () => err({ rateLimit: null, reasons: ["HTTP 403"], status: 403 }),
    });
    const requester: RawRequester = rawRequesterFrom({ transport });
    const page: Result<TelemetryPage, TelemetryReadError> = await createTelemetryPageFetcher({ requester })({
      cursor: null,
      fromMs: 1,
      limit: 10,
      query: TOOL_ERROR_QUERY,
      toMs: 2,
    });
    expect(page.isErr()).toBe(true);
    expect(unwrapErr(page).code).toBe("QUERY_FAILED");
  });
});
