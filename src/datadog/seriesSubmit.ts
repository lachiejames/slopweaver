/**
 * The WRITE half of the Datadog door: submitting gauge and count metric points to `/api/v1/series`.
 *
 * ## Why this is a separate module from `rawTransport.ts`
 *
 * `rawTransport.ts` states, in its own header, that read-only is a property of its TYPE — `RawMethod`
 * admits `GET` and `POST`, and a POST is additionally checked against an allowlist of routes that only
 * read. Adding `/api/v1/series` to that allowlist would be a lie: it is the one Datadog route in this
 * package that changes what the estate says about itself. So the write lives here, named as a write, and
 * `rawTransport.ts`'s property survives intact. A reader auditing "what can this package change" reads one
 * file, not an allowlist that has quietly grown a mutation in it.
 *
 * What may be submitted at all — gauges, and counts carrying their interval — is the payload's schema, in
 * `seriesPayload.ts`. This module reads Datadog's answer for its status alone.
 *
 * ## A late point is opt-in, because getting it wrong is unrecoverable
 *
 * Datadog accepts a backdated point only for a metric with Historical Metrics Ingestion enabled. Sent to
 * one without it, that point does not error: it silently BURNS its (timestamp, tagset) slot, permanently,
 * and no later submission is ever accepted for it. That is not a hypothetical — it is what destroyed an
 * earlier metric namespace outright and forced a rename to recover.
 *
 * So `planSubmission` refuses any point older than `now` unless the caller states `allowLate`. The default
 * is the safe direction: a caller who has not thought about HMI cannot damage a namespace by accident, and
 * a caller who has says so in the argv, where it is visible in the door ledger afterwards.
 *
 * The comparison is STRICT — no grace window — and that is a decision rather than an oversight. Datadog does
 * accept some recent backdated points without HMI, but nothing here has measured where that boundary sits on
 * this site, and a tolerance picked from memory is precisely the unmeasured constant this repo's comment rule
 * exists to keep out. The consequence is stated rather than hidden: a payload built even seconds before it is
 * sent counts as late, so anything not generated and submitted in one breath passes `--allow-late`. The check
 * this mirrors is the producer's own `registerOnly` assertion, which is strict for the same reason — the
 * failure it guards is permanent, and the cost of being wrong in the safe direction is one flag.
 *
 * ## A failed batch never means nothing was written
 *
 * The payload is submitted in batches, because `/api/v1/series` answers an oversized one with a 413. A
 * batch that fails after earlier batches succeeded has still changed Datadog, so every failure carries
 * `submittedBatches` — the same discipline `live/automation/schedulerComplete.ts` applies to a completion that
 * appended before it failed. Reporting "the submit failed" without that number would describe a partial
 * write as no write, and the caller would re-run and double-submit.
 */
import { epochSecondsToIso } from "../lib/date.js";
import { errorMessage } from "../lib/errorMessage.js";
import type { Logger } from "../lib/logger.js";
import { err, ok, type Result } from "../lib/result.js";
import type { DatadogConfig } from "./config.js";
import {
  describeRateLimitWait,
  parseRateLimit,
  RATE_LIMIT_BACKOFF_BASE_SECONDS,
  RATE_LIMIT_MAX_RETRIES,
  type RateLimitSnapshot,
} from "./rateLimit.js";
import { classifyRawStatus, type FetchLike, type SleepLike } from "./rawTransport.js";
import type { SubmittedSeries } from "./seriesPayload.js";
import { type DatadogSubmitError, DatadogSubmitErrors } from "./seriesSubmitErrors.js";

/** The one route this module writes to. v1, never v2 — v2 silently DROPS a late-timestamped point. */
export const SERIES_ROUTE = "/api/v1/series";

/**
 * Series per request.
 *
 * `/api/v1/series` answers an oversized payload with a 413, and a multi-day backfill (days × per-tagset
 * points) passes that size easily. 500 is the batch size the producer this door was built to serve has
 * used against this same route since the namespace was created, so it is a measured bound rather than a
 * guess — reproduce with `grep SERIES_BATCH_SIZE` in that producer.
 */
export const SERIES_BATCH_SIZE = 500;

/** What a submission would do, computed before anything is sent. */
export interface SubmissionPlan {
  readonly batches: readonly (readonly SubmittedSeries[])[];
  readonly seriesCount: number;
  readonly pointCount: number;
  readonly latePointCount: number;
  /** The distinct UTC dates the points are stamped on, ascending — the "which days" of a backfill. */
  readonly utcDays: readonly string[];
  readonly earliestIso: string;
  readonly latestIso: string;
}

/** What a submission actually did. */
export interface SubmissionOutcome {
  readonly submittedBatches: number;
  readonly seriesCount: number;
  readonly pointCount: number;
}

/** Every point's timestamp in one flat list, so a plan can be computed in a single pass. */
function pointSeconds({ series }: { series: readonly SubmittedSeries[] }): readonly number[] {
  return series.flatMap((one) => one.points.map(([seconds]) => seconds));
}

/**
 * The UTC calendar date an epoch-second timestamp falls on, as `YYYY-MM-DD`.
 *
 * Built off `epochSecondsToIso` rather than a local `new Date(seconds * 1000)`, which the `epoch-arithmetic`
 * gate bans outright — so an unrepresentable timestamp is `undefined` here rather than the string
 * `"Invalid Date"` a hand conversion produces, and the caller refuses the payload instead of stamping it.
 *
 * @param seconds the epoch seconds
 * @returns the UTC date, or `undefined` when the timestamp is not a representable instant
 */
export function utcDayOf({ seconds }: { seconds: number }): string | undefined {
  return epochSecondsToIso({ seconds })?.slice(0, 10);
}

/**
 * Decide what a submission would do, and refuse it when backdated points are present and unstated.
 *
 * Pure — the clock is passed in — so every refusal below is a unit test rather than a machine it happened
 * to run on. Nothing is sent from here.
 *
 * @param series the parsed series
 * @param nowSeconds the instant to judge lateness against
 * @param allowLate whether the caller has stated that HMI covers every metric in the payload
 * @returns the plan, or the reason nothing should be sent
 */
export function planSubmission({
  series,
  nowSeconds,
  allowLate,
}: {
  series: readonly SubmittedSeries[];
  nowSeconds: number;
  allowLate: boolean;
}): Result<SubmissionPlan, DatadogSubmitError> {
  const seconds = pointSeconds({ series });
  if (seconds.length === 0) {
    return err(DatadogSubmitErrors.payloadInvalid({ issues: ["the payload carries no points at all"] }));
  }
  const days = seconds.map((one) => utcDayOf({ seconds: one }));
  const unrepresentable = seconds.filter((one) => utcDayOf({ seconds: one }) === undefined);
  if (unrepresentable.length > 0) {
    return err(
      DatadogSubmitErrors.payloadInvalid({
        issues: [
          `${String(unrepresentable.length)} point(s) carry a timestamp that is not a representable instant, ` +
            `the first being ${String(unrepresentable[0])}`,
        ],
      }),
    );
  }
  const late = seconds.filter((one) => one < nowSeconds);
  if (late.length > 0 && !allowLate) {
    return err(
      DatadogSubmitErrors.latePointsRefused({
        earliestIso: isoOf({ seconds: Math.min(...late) }),
        latePointCount: late.length,
      }),
    );
  }
  return ok({
    batches: chunkSeries({ series, size: SERIES_BATCH_SIZE }),
    earliestIso: isoOf({ seconds: Math.min(...seconds) }),
    latePointCount: late.length,
    latestIso: isoOf({ seconds: Math.max(...seconds) }),
    pointCount: seconds.length,
    seriesCount: series.length,
    utcDays: [...new Set(days)].filter((day) => day !== undefined).toSorted(),
  });
}

/**
 * The instant for a timestamp `planSubmission`'s own guard has already proved representable.
 *
 * The assertion is honest rather than a coalesce: every caller sits AFTER the `unrepresentable` check, so an
 * `undefined` here would mean that check stopped working, and an empty string would carry that breakage into
 * a plan that reads as if it had a span.
 *
 * @param seconds the epoch seconds
 * @returns the ISO instant
 */
function isoOf({ seconds }: { seconds: number }): string {
  return epochSecondsToIso({ seconds })!;
}

/**
 * Split a series list into request-sized batches.
 *
 * @param series the series to split
 * @param size the maximum series per batch
 * @returns the batches, in order
 */
export function chunkSeries({
  series,
  size,
}: {
  series: readonly SubmittedSeries[];
  size: number;
}): readonly (readonly SubmittedSeries[])[] {
  const batches: (readonly SubmittedSeries[])[] = [];
  for (let start = 0; start < series.length; start += size) {
    batches.push(series.slice(start, start + size));
  }
  return batches;
}

/** The default HTTP seam: the global `fetch`, with its headers flattened into a plain record. */
const globalFetch: FetchLike = async (url, init) => {
  const response = await globalThis.fetch(url, init);
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return { headers, status: response.status, text: () => response.text() };
};

/** The default wait seam: a real timer. */
const realSleep: SleepLike = ({ seconds }) =>
  new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });

/**
 * How long to wait before retrying a rate-limited batch, preferring Datadog's own reset over the backoff base.
 *
 * The series intake answers a 429 with `x-ratelimit-reset` when it is metering properly; a 429 carrying no
 * rate-limit headers, or a set without the reset, leaves nothing to honour, so the batch waits the base.
 */
function waitSeconds({ snapshot }: { snapshot: RateLimitSnapshot | null }): number {
  if (snapshot === null) {
    return RATE_LIMIT_BACKOFF_BASE_SECONDS;
  }
  const { resetSeconds } = snapshot;
  if (resetSeconds === null) {
    return RATE_LIMIT_BACKOFF_BASE_SECONDS;
  }
  return resetSeconds;
}

/** One batch's attempt: whether it landed, and whether a retry could plausibly change that. */
interface BatchAttempt {
  readonly accepted: boolean;
  readonly retryable: boolean;
  readonly rateLimit: RateLimitSnapshot | null;
  readonly status: number;
  readonly detail: string;
  readonly unreachable: boolean;
}

/** Issue one batch once. Split out so the retry loop stays readable and every branch is reachable. */
async function submitBatchOnce({
  doFetch,
  url,
  apiKey,
  batch,
}: {
  doFetch: FetchLike;
  url: string;
  apiKey: string;
  batch: readonly SubmittedSeries[];
}): Promise<BatchAttempt> {
  let status = 0;
  let headers: Readonly<Record<string, string>> = {};
  let raw = "";
  try {
    const response = await doFetch(url, {
      body: JSON.stringify({ series: batch }),
      headers: { "content-type": "application/json", "dd-api-key": apiKey },
      method: "POST",
    });
    status = response.status;
    headers = response.headers;
    raw = await response.text();
  } catch (error: unknown) {
    return {
      accepted: false,
      detail: `the submission to ${url} never reached Datadog: ${errorMessage({ error })}`,
      rateLimit: null,
      retryable: false,
      status: 0,
      unreachable: true,
    };
  }
  const rateLimit = parseRateLimit({ headers: { ...headers } });
  // 202 is the Historical Metrics Ingestion queue accepting a backfill, and is the success every
  // backdated batch answers with — treating only 200 as success would report a landed backfill as failed.
  const accepted = status >= 200 && status < 300;
  return {
    accepted,
    detail: accepted ? "" : classifyRawStatus({ path: SERIES_ROUTE, raw, status }).join(" "),
    rateLimit,
    retryable: status === 429,
    status,
    unreachable: false,
  };
}

/**
 * Submit a planned gauge/count payload, batch by batch, retrying only a rate limit.
 *
 * @param config a validated configuration — the host and the API key come from here, so nothing
 *   hard-codes a site
 * @param plan the plan from {@link planSubmission}; nothing is re-validated here
 * @param logger where a rate-limit wait is announced, so a pause is not silent
 * @param fetchImpl the HTTP seam, defaulting to the global `fetch`
 * @param sleep the wait seam, defaulting to a real timer
 * @returns what landed, or the failure plus how many batches had already been accepted
 */
export async function submitGaugeSeries({
  config,
  plan,
  logger,
  fetchImpl = globalFetch,
  sleep = realSleep,
}: {
  config: DatadogConfig;
  plan: SubmissionPlan;
  logger: Logger;
  fetchImpl?: FetchLike;
  sleep?: SleepLike;
}): Promise<Result<SubmissionOutcome, DatadogSubmitError>> {
  const doFetch = fetchImpl;
  const doSleep = sleep;
  const url = `https://${config.apiHost}${SERIES_ROUTE}`;
  let submittedBatches = 0;

  for (const batch of plan.batches) {
    let attempt: BatchAttempt | undefined;
    // `<=` so RATE_LIMIT_MAX_RETRIES means retries, not total attempts — the reading rawTransport.ts gives it.
    for (let tries = 0; tries <= RATE_LIMIT_MAX_RETRIES; tries += 1) {
      attempt = await submitBatchOnce({ apiKey: config.apiKey, batch, doFetch, url });
      if (!attempt.retryable || tries === RATE_LIMIT_MAX_RETRIES) {
        break;
      }
      logger.warn({ msg: describeRateLimitWait({ snapshot: attempt.rateLimit }) });
      await doSleep({ seconds: waitSeconds({ snapshot: attempt.rateLimit }) });
    }
    if (attempt === undefined) {
      const detail = `the submission to ${url} produced no attempt at all`;
      return err(DatadogSubmitErrors.unreachable({ detail, submittedBatches }));
    }
    if (attempt.unreachable) {
      return err(DatadogSubmitErrors.unreachable({ detail: attempt.detail, submittedBatches }));
    }
    if (!attempt.accepted) {
      return err(
        DatadogSubmitErrors.submitRejected({ detail: attempt.detail, status: attempt.status, submittedBatches }),
      );
    }
    submittedBatches += 1;
  }

  return ok({ pointCount: plan.pointCount, seriesCount: plan.seriesCount, submittedBatches });
}
