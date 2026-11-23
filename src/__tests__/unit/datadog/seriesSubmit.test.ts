/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import type { DatadogConfig } from "../../../datadog/config.js";
import type { FetchLike } from "../../../datadog/rawTransport.js";
import { type GaugeSeries, parseSeriesPayload } from "../../../datadog/seriesPayload.js";
import {
  chunkSeries,
  planSubmission,
  SERIES_BATCH_SIZE,
  SERIES_ROUTE,
  submitGaugeSeries,
  utcDayOf,
} from "../../../datadog/seriesSubmit.js";
import {
  DatadogSubmitErrors,
  type SeriesLateRefusedError,
  type SeriesRejectedError,
} from "../../../datadog/seriesSubmitErrors.js";
import { createLogger } from "../../../lib/logger.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const CONFIG: DatadogConfig = {
  apiHost: "api.ap1.datadoghq.com",
  apiKey: "0123456789abcdef0123456789abcdef",
  appKey: "0123456789abcdef0123456789abcdef01234567",
  consoleHost: "ap1.datadoghq.com",
  site: "ap1.datadoghq.com",
};

/** The first UTC midnight the real backfill had to stamp. */
const SEP_4 = 1788480000;
const SEP_5 = SEP_4 + 86_400;
const SEP_6 = SEP_5 + 86_400;

const series = ({
  metric = "sdlc.v1.pr.merged_daily",
  seconds = SEP_4,
  value = 12,
  tags = ["team:all"],
}: {
  metric?: string;
  seconds?: number;
  value?: number;
  tags?: readonly string[];
} = {}): GaugeSeries => ({ metric, points: [[seconds, value]], tags: [...tags], type: "gauge" });

const silent = createLogger({ level: "error", outSink: () => undefined, sink: () => undefined });

describe("parseSeriesPayload", () => {
  it("reads a well-formed gauge payload", () => {
    const parsed = parseSeriesPayload({
      label: "p.json",
      text: JSON.stringify({ series: [{ metric: "a.b", points: [[SEP_4, 3]], tags: ["team:all"], type: "gauge" }] }),
    });
    expect(parsed.isOk()).toBe(true);
    const value = unwrap(parsed);
    expect(value.length).toBe(1);
    expect(value[0]!.metric).toBe("a.b");
    expect(value[0]!.points[0]).toEqual([SEP_4, 3]);
  });

  it("defaults an omitted tags array to empty rather than refusing", () => {
    const parsed = parseSeriesPayload({
      label: "p.json",
      text: JSON.stringify({ series: [{ metric: "a.b", points: [[SEP_4, 3]], type: "gauge" }] }),
    });
    expect(unwrap(parsed)[0]!.tags).toEqual([]);
  });

  it("refuses a distribution or a rate, because neither backfills or reads right", () => {
    for (const type of ["distribution", "rate"]) {
      const parsed = parseSeriesPayload({
        label: "p.json",
        text: JSON.stringify({ series: [{ metric: "a.b", points: [[SEP_4, 3]], type }] }),
      });
      expect(unwrapErr(parsed).code).toBe("PAYLOAD_INVALID");
      expect(unwrapErr(parsed).message).toContain("series.0.type");
    }
  });

  it("reads a count carrying its interval", () => {
    const parsed = parseSeriesPayload({
      label: "p.json",
      text: JSON.stringify({ series: [{ interval: 10, metric: "a.b", points: [[SEP_4, 0]], type: "count" }] }),
    });
    expect(unwrap(parsed)).toEqual([{ interval: 10, metric: "a.b", points: [[SEP_4, 0]], tags: [], type: "count" }]);
  });

  it("refuses a count with no interval, because its total would be a total of nothing named", () => {
    const parsed = parseSeriesPayload({
      label: "p.json",
      text: JSON.stringify({ series: [{ metric: "a.b", points: [[SEP_4, 3]], type: "count" }] }),
    });
    expect(unwrapErr(parsed).code).toBe("PAYLOAD_INVALID");
    expect(unwrapErr(parsed).message).toContain("series.0.interval");
  });

  it("refuses an empty series list", () => {
    const parsed = parseSeriesPayload({ label: "p.json", text: JSON.stringify({ series: [] }) });
    expect(unwrapErr(parsed).code).toBe("PAYLOAD_INVALID");
  });

  it("names an issue about the whole document as the root", () => {
    const parsed = parseSeriesPayload({ label: "p.json", text: "[]" });
    expect(unwrapErr(parsed).code).toBe("PAYLOAD_INVALID");
    expect(unwrapErr(parsed).message).toContain("the series payload cannot be submitted: (root): ");
  });

  it("names a nested issue by its dotted path", () => {
    const parsed = parseSeriesPayload({
      label: "p.json",
      text: JSON.stringify({ series: [{ metric: "a.b", points: [[SEP_4, 3]], type: "rate" }] }),
    });
    expect(unwrapErr(parsed).message).toContain("the series payload cannot be submitted: series.0.type: ");
  });

  it("names the file when the text is not JSON at all", () => {
    const parsed = parseSeriesPayload({ label: "broken.json", text: "{not json" });
    expect(unwrapErr(parsed).message).toContain("broken.json is not readable JSON");
  });
});

describe("planSubmission", () => {
  it("refuses backdated points when the caller has not stated allowLate", () => {
    const plan = planSubmission({ allowLate: false, nowSeconds: SEP_6 + 3600, series: [series({ seconds: SEP_4 })] });
    expect(plan.isErr()).toBe(true);
    const error = unwrapErr(plan);
    expect(error.code).toBe("LATE_POINTS_REFUSED");
    expect(error.message).toContain("--allow-late");
  });

  it("carries the late count and the earliest late instant on that refusal", () => {
    const plan = planSubmission({
      allowLate: false,
      nowSeconds: SEP_6 + 3600,
      series: [series({ seconds: SEP_5 }), series({ seconds: SEP_4 })],
    });
    const error = unwrapErr(plan) as SeriesLateRefusedError;
    expect(error.code).toBe("LATE_POINTS_REFUSED");
    expect(error.latePointCount).toBe(2);
    expect(error.earliestIso).toBe("2026-09-04T00:00:00.000Z");
  });

  it("names every distinct UTC day the payload stamps, ascending", () => {
    const plan = planSubmission({
      allowLate: true,
      nowSeconds: SEP_6 + 3600,
      series: [series({ seconds: SEP_6 }), series({ seconds: SEP_4 }), series({ seconds: SEP_5 })],
    });
    expect(unwrap(plan).utcDays).toEqual(["2026-09-04", "2026-09-05", "2026-09-06"]);
  });

  it("counts points and series separately, since one series carries many points", () => {
    const two: GaugeSeries = {
      metric: "a.b",
      points: [
        [SEP_4, 1],
        [SEP_5, 2],
      ],
      tags: [],
      type: "gauge",
    };
    const plan = unwrap(planSubmission({ allowLate: true, nowSeconds: SEP_6, series: [two, series()] }));
    expect(plan.seriesCount).toBe(2);
    expect(plan.pointCount).toBe(3);
  });

  it("accepts a payload with no late points at all without allowLate", () => {
    const plan = planSubmission({ allowLate: false, nowSeconds: SEP_4, series: [series({ seconds: SEP_4 })] });
    expect(unwrap(plan).latePointCount).toBe(0);
  });

  it("reports the span it would stamp", () => {
    const plan = unwrap(
      planSubmission({
        allowLate: true,
        nowSeconds: SEP_6,
        series: [series({ seconds: SEP_4 }), series({ seconds: SEP_6 })],
      }),
    );
    expect(plan.earliestIso).toBe("2026-09-04T00:00:00.000Z");
    expect(plan.latestIso).toBe("2026-09-06T00:00:00.000Z");
  });
});

describe("chunkSeries", () => {
  it("splits at the batch size, keeping order", () => {
    const many = Array.from({ length: 1001 }, (_unused, index) => series({ value: index }));
    const batches = chunkSeries({ series: many, size: SERIES_BATCH_SIZE });
    expect(batches.length).toBe(3);
    expect(batches[0]!.length).toBe(500);
    expect(batches[2]!.length).toBe(1);
    expect(batches[2]![0]!.points[0]![1]).toBe(1000);
  });

  it("returns one batch for a payload smaller than the size", () => {
    expect(chunkSeries({ series: [series()], size: SERIES_BATCH_SIZE }).length).toBe(1);
  });
});

describe("utcDayOf", () => {
  it("reads the UTC calendar date, not the local one", () => {
    expect(utcDayOf({ seconds: SEP_4 })).toBe("2026-09-04");
    expect(utcDayOf({ seconds: SEP_5 - 1 })).toBe("2026-09-04");
  });

  it("answers undefined for a timestamp that is not a representable instant", () => {
    expect(utcDayOf({ seconds: Number.POSITIVE_INFINITY })).toBe(undefined);
  });
});

describe("submitGaugeSeries", () => {
  const okFetch =
    ({ calls, status }: { calls: { url: string; body: string }[]; status: number }): FetchLike =>
    async (url, init) => {
      calls.push({ body: init.body!, url });
      return { headers: {}, status, text: async () => "" };
    };

  it("posts every batch to the v1 series route on the configured host", async () => {
    const calls: { url: string; body: string }[] = [];
    const plan = unwrap(planSubmission({ allowLate: true, nowSeconds: SEP_6, series: [series(), series()] }));
    const outcome = await submitGaugeSeries({
      config: CONFIG,
      fetchImpl: okFetch({ calls, status: 202 }),
      logger: silent,
      plan,
    });
    expect(unwrap(outcome).submittedBatches).toBe(1);
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe(`https://api.ap1.datadoghq.com${SERIES_ROUTE}`);
    expect(JSON.parse(calls[0]!.body)).toEqual({
      series: [
        { metric: "sdlc.v1.pr.merged_daily", points: [[SEP_4, 12]], tags: ["team:all"], type: "gauge" },
        { metric: "sdlc.v1.pr.merged_daily", points: [[SEP_4, 12]], tags: ["team:all"], type: "gauge" },
      ],
    });
  });

  it("treats 202 as accepted, because that is what the HMI backfill queue answers", async () => {
    const plan = unwrap(planSubmission({ allowLate: true, nowSeconds: SEP_6, series: [series()] }));
    const outcome = await submitGaugeSeries({
      config: CONFIG,
      fetchImpl: okFetch({ calls: [], status: 202 }),
      logger: silent,
      plan,
    });
    expect(outcome.isOk()).toBe(true);
  });

  it("reports how many batches had already landed when a later one is rejected", async () => {
    let seen = 0;
    const failing: FetchLike = async () => {
      seen += 1;
      return { headers: {}, status: seen <= 2 ? 202 : 400, text: async () => "bad payload" };
    };
    const many = Array.from({ length: 1200 }, () => series());
    const plan = unwrap(planSubmission({ allowLate: true, nowSeconds: SEP_6, series: many }));
    const outcome = await submitGaugeSeries({ config: CONFIG, fetchImpl: failing, logger: silent, plan });
    const error = unwrapErr(outcome) as SeriesRejectedError;
    expect(error.code).toBe("SUBMIT_REJECTED");
    expect(error.submittedBatches).toBe(2);
    expect(error.status).toBe(400);
    expect(error.message).toContain("2 batch(es) had already been accepted");
  });

  it("reports a batch that never reached Datadog as unreachable, not as a rejection", async () => {
    const throwing: FetchLike = async () => {
      throw new Error("ENOTFOUND");
    };
    const plan = unwrap(planSubmission({ allowLate: true, nowSeconds: SEP_6, series: [series()] }));
    const outcome = await submitGaugeSeries({ config: CONFIG, fetchImpl: throwing, logger: silent, plan });
    expect(unwrapErr(outcome).code).toBe("UNREACHABLE");
    expect(unwrapErr(outcome).message).toContain("ENOTFOUND");
    expect(unwrapErr(outcome).message).toContain(
      `the submission to https://api.ap1.datadoghq.com${SERIES_ROUTE} never reached Datadog: ENOTFOUND`,
    );
  });

  it("waits each 429's own reset, and the backoff base where a 429 names none", async () => {
    const responses: { headers: Record<string, string>; status: number }[] = [
      { headers: { "x-ratelimit-reset": "7" }, status: 429 },
      { headers: {}, status: 429 },
      { headers: { "x-ratelimit-name": "series_intake" }, status: 429 },
      { headers: {}, status: 202 },
    ];
    let attempts = 0;
    const limited: FetchLike = async () => {
      const response = responses[attempts]!;
      attempts += 1;
      return { headers: response.headers, status: response.status, text: async () => "" };
    };
    const waits: number[] = [];
    const plan = unwrap(planSubmission({ allowLate: true, nowSeconds: SEP_6, series: [series()] }));
    const outcome = await submitGaugeSeries({
      config: CONFIG,
      fetchImpl: limited,
      logger: silent,
      plan,
      sleep: async ({ seconds }) => {
        waits.push(seconds);
      },
    });
    expect(unwrap(outcome).submittedBatches).toBe(1);
    expect(waits).toEqual([7, 2, 2]);
  });

  it("retries a rate limit and succeeds on the retry", async () => {
    let attempts = 0;
    const limited: FetchLike = async () => {
      attempts += 1;
      return { headers: {}, status: attempts === 1 ? 429 : 202, text: async () => "" };
    };
    const plan = unwrap(planSubmission({ allowLate: true, nowSeconds: SEP_6, series: [series()] }));
    const outcome = await submitGaugeSeries({
      config: CONFIG,
      fetchImpl: limited,
      logger: silent,
      plan,
      sleep: async () => undefined,
    });
    expect(unwrap(outcome).submittedBatches).toBe(1);
    expect(attempts).toBe(2);
  });
});

describe("DatadogSubmitErrors", () => {
  it("builds the late refusal the real code builds", () => {
    const error = DatadogSubmitErrors.latePointsRefused({
      earliestIso: "2026-09-04T00:00:00.000Z",
      latePointCount: 5394,
    });
    expect(error.code).toBe("LATE_POINTS_REFUSED");
    expect(error.latePointCount).toBe(5394);
    expect(error.message).toContain("Historical Metrics Ingestion");
  });
});
