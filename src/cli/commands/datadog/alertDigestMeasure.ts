/**
 * Every Datadog number `datadog alert-digest` reads: one probe's own count, and the two reads the priority
 * matrix and the trend add on top of it.
 *
 * Split from `./alertDigestRun.ts`, which keeps the verb's shell: arguments, the probe set, the output. The
 * seam is what the card depends on. A probe's own count is ALL-OR-NOTHING, because the card reports it; the
 * impact and the baseline are ESTIMATES feeding a ranking, so a failed read leaves `impact ?` or no trend
 * clause and a line on stderr, never an exit code.
 */
import {
  type AlertProbe,
  type AlertProbeReading,
  type AlertProbeSet,
  probeCountsTowardTrend,
  readingImpactIsMeasurable,
  readingIsAlarming,
} from "../../../datadog/alertProbe.js";
import { AlertProbeErrors } from "../../../datadog/alertProbeErrors.js";
import type { DatadogClient } from "../../../datadog/client.js";
import type { DatadogConfig } from "../../../datadog/config.js";
import { logsCount, logsSum } from "../../../datadog/logsCount.js";
import { metricsScalarCount } from "../../../datadog/metricsScalar.js";
import { datadogQueryErrorLines } from "../../../datadog/queryErrors.js";
import type { AbsoluteWindow } from "../../../datadog/window.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { DigestItem } from "../../../outbound/artifact/digestFields.js";
import { ALERT_TREND_PRIOR_WINDOWS, type AlertTrendReading } from "../../../outbound/artifact/trend.js";

import { measureImpactTargets } from "./impactMeasurementRun.js";

/**
 * Take ONE probe's number, whichever of the three aggregates its kind selects.
 *
 * A `metric-sum` asks for one bucket with no group-by: the scalar endpoint returns the whole scope's total
 * in a single bucket, which is the number the row reports. An empty bucket list is a real zero here — the
 * metric existed and matched nothing — and is reported as such rather than as a fault, because a metric
 * that has legitimately gone quiet is exactly what a delivery-failure row is watching for.
 *
 * @param client the shared client
 * @param probe the declared check
 * @param window the absolute window every probe in this run shares
 * @returns the measured number, or why it could not be obtained
 */
export async function measureProbe({
  client,
  probe,
  window,
}: {
  client: DatadogClient;
  probe: AlertProbe;
  window: AbsoluteWindow;
}): Promise<Result<number>> {
  if (probe.kind === "logs-count") {
    const counted = await logsCount({ client, query: probe.query, window });
    return counted.isErr() ? err(datadogQueryErrorLines({ error: counted.error })) : ok(counted.value.count);
  }
  if (probe.kind === "logs-facet-sum") {
    const metric = probe.sumAttribute;
    if (metric === undefined) {
      // Unreachable through `parseAlertProbeSet`, which refuses this shape; forwarded rather than authored
      // so the message has one home and this directory grows no new plain error shape.
      return err([
        AlertProbeErrors.shapeMismatch({
          detail: "kind 'logs-facet-sum' reached the runner with no sumAttribute",
          probeId: probe.id,
        }).message,
      ]);
    }
    const summed = await logsSum({ client, metric, query: probe.query, window });
    return summed.isErr() ? err(datadogQueryErrorLines({ error: summed.error })) : ok(summed.value.sum);
  }
  const scalar = await metricsScalarCount({
    client,
    expectedGroupTags: [],
    limit: 1,
    query: probe.query,
    window,
  });
  if (scalar.isErr()) {
    return err([scalar.error.message]);
  }
  const total = scalar.value.buckets.reduce((running, bucket) => running + bucket.count, 0);
  return ok(total);
}

/**
 * The span the trend's baseline is read over: `priorWindows` windows of this one's own length, ending exactly
 * where this one starts.
 *
 * Adjacent and never overlapping, so no event is counted in both the current total and the baseline — the
 * same half-open split `live/slack/alertTrend.ts` makes of a summary's single read.
 *
 * @param window the card's own window
 * @param priorWindows how many windows the baseline spans, which `deriveTrend` divides the total by
 * @returns the absolute baseline span
 */
export function baselineWindow({
  window,
  priorWindows,
}: {
  window: AbsoluteWindow;
  priorWindows: number;
}): AbsoluteWindow {
  const span = window.toMs - window.fromMs;
  return { fromMs: window.fromMs - span * priorWindows, toMs: window.fromMs };
}

/** What the priority matrix and the trend need beyond the readings, and a line for every part that is missing. */
export interface DigestEnrichment {
  readonly impacts: ReadonlyMap<string, NonNullable<DigestItem["impact"]>>;
  readonly trend: AlertTrendReading | undefined;
  readonly warnings: readonly string[];
}

/**
 * Read what the priority matrix and the trend need: each measurable firing probe's blast radius, and the
 * baseline windows behind this one.
 *
 * NEVER fails the card, the posture `../slack/alertImpactRun.ts` takes for the same reason — the card is
 * unattended, and a Datadog fault in an ESTIMATE is no reason to post nothing. Every read that cannot be taken
 * becomes one warning, the item reads `impact ?` and ranks on severity alone, and a missing baseline omits the
 * TL;DR clause. Only the CURRENT readings are all-or-nothing, and they were taken before this runs.
 *
 * @param client the shared client
 * @param config the resolved Datadog configuration, which the investigate lane builds its own requester from
 * @param readings every current reading, all of which succeeded
 * @param set the parsed probe set
 * @param window the card's own window
 * @returns the impacts keyed by probe id, the raw baseline or nothing, and the warnings
 */
export async function readEnrichment({
  client,
  config,
  readings,
  set,
  window,
}: {
  client: DatadogClient;
  config: DatadogConfig;
  readings: readonly AlertProbeReading[];
  set: AlertProbeSet;
  window: AbsoluteWindow;
}): Promise<DigestEnrichment> {
  const measurable = readings.filter((reading) => readingImpactIsMeasurable({ reading }));
  const measured = await measureImpactTargets({
    config,
    targets: measurable.map((reading) => ({
      keys: [reading.probe.id],
      product: "logs" as const,
      search: reading.probe.query,
      subject: `probe '${reading.probe.id}'`,
    })),
    window,
  });
  const baseline = await readBaseline({ client, set, window });
  return {
    impacts: measured.impacts,
    trend: baseline.trend,
    warnings: [...unmeasuredWarning({ readings }), ...measured.warnings, ...baseline.warnings],
  };
}

/**
 * The line naming every FIRING probe this run never tried to measure, so an `impact ?` beside a red row is
 * explained rather than left looking like a read that failed.
 *
 * A QUIET probe is left out on purpose, every quiet day being most of them: zero events have no service to take a
 * share of, and `green` x `unknown` ranks P4 exactly as `green` x `slim` does, so its `impact ?` changes no rank.
 *
 * @param readings every current reading
 * @returns one warning, or none when every firing probe was measurable
 */
function unmeasuredWarning({ readings }: { readings: readonly AlertProbeReading[] }): readonly string[] {
  const skipped = readings.filter(
    (reading) => readingIsAlarming({ reading }) && !readingImpactIsMeasurable({ reading }),
  );
  if (skipped.length === 0) {
    return [];
  }
  return [
    `${String(skipped.length)} firing probe(s) carry no impact estimate: a metric-sum reads no event population ` +
      'and a heartbeat alarms on silence, so neither has a share to take. They read "impact ?" and rank on ' +
      `severity alone: ${skipped.map((reading) => reading.probe.id).join(", ")}`,
  ];
}

/**
 * Read the baseline: every probe that counts toward the trend, rerun over the windows immediately before this
 * one, summed.
 *
 * All-or-nothing, unlike the impacts. A baseline missing one probe is a SMALLER baseline, and a smaller
 * baseline makes this window look worse than it is — a partial sum would print a confident `2.1×` that is
 * partly an artefact of a read that failed. So one failed read discards the whole baseline and says which.
 * Sequential for the rate-limit reason every read here is.
 *
 * @param client the shared client
 * @param set the parsed probe set
 * @param window the card's own window, which the baseline span ends at
 * @returns the raw baseline, or nothing and the one line saying why
 */
async function readBaseline({
  client,
  set,
  window,
}: {
  client: DatadogClient;
  set: AlertProbeSet;
  window: AbsoluteWindow;
}): Promise<{ readonly trend: AlertTrendReading | undefined; readonly warnings: readonly string[] }> {
  const counted = set.probes.filter((probe) => probeCountsTowardTrend({ probe }));
  if (counted.length === 0) {
    return {
      trend: undefined,
      warnings: ["no trend: every probe here is a heartbeat or declared green, so none counts toward one"],
    };
  }
  const prior = baselineWindow({ priorWindows: ALERT_TREND_PRIOR_WINDOWS, window });
  let priorTotal = 0;
  for (const probe of counted) {
    // eslint-disable-next-line no-await-in-loop -- the shared rate-limit budget; see this function's header
    const measured = await measureProbe({ client, probe, window: prior });
    if (measured.isErr()) {
      return { trend: undefined, warnings: [`no trend: probe '${probe.id}' baseline: ${measured.error.join("; ")}`] };
    }
    if (!Number.isInteger(measured.value) || measured.value < 0) {
      return {
        trend: undefined,
        warnings: [
          `no trend: probe '${probe.id}' baseline read ${String(measured.value)}, which is not a count of zero or more`,
        ],
      };
    }
    priorTotal += measured.value;
  }
  if (!Number.isSafeInteger(priorTotal)) {
    return { trend: undefined, warnings: ["no trend: the baseline total is past the largest safe integer"] };
  }
  // A baseline that counted nothing is carried as read, and `deriveTrend` declines it: a silent past and a probe
  // set newer than the baseline cannot be told apart, so no ratio is honest. That omits the TL;DR clause, and the
  // omission is said here rather than left to look like a read that never happened.
  const warnings =
    priorTotal === 0
      ? [
          `no trend clause: the prior ${String(ALERT_TREND_PRIOR_WINDOWS)} windows counted zero, which yields no verdict`,
        ]
      : [];
  return { trend: { priorTotal, priorWindows: ALERT_TREND_PRIOR_WINDOWS }, warnings };
}
