/**
 * The effectful half of an alert summary's estimated blast radius: rerun each kept alert's own event search,
 * then ask how much its service produced in total over the same window.
 *
 * It never fails the card. An install with no census, no Datadog keys, or a window past the logs' retention
 * posts the same tally it always did, with one warning on stderr naming why every row reads `impact ?` — the
 * card is unattended, and a Datadog fault is not a reason to post nothing at the hour nobody is watching. That
 * is `./alertBehindRun.ts`'s posture, held deliberately, because this lane issues more reads than that one and
 * so has more ways to be partly absent.
 *
 * What is this lane's own is the RESOLUTION: which census monitor each tally row links to, and whether its
 * query is an event search at all. The aggregates themselves — grouped numerator, memoised per-service
 * denominator — are `../datadog/impactMeasurementRun.ts`, shared with the Datadog digest so both alert cards
 * measure a blast radius the same way.
 */

import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import { readCatalogueManifest } from "../../../datadog/detective/store.js";
import { loadDatadogConfig } from "../../../datadog/source.js";
import type { BehindRow } from "../../../live/slack/alertBehind.js";
import {
  ALERT_IMPACT_MAX,
  type AlertImpact,
  type ImpactTarget,
  impactTargets,
} from "../../../live/slack/alertImpact.js";
import { measureImpactTargets } from "../datadog/impactMeasurementRun.js";

/** Milliseconds in one day, the unit a log index states its retention in. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** What the lane came to: one impact per tally-row LABEL, and one line per thing that kept one out. */
export interface ImpactReading {
  /** Keyed by the tally row's own label, which is what the form's rows are keyed by too. */
  readonly impacts: ReadonlyMap<string, AlertImpact>;
  readonly warnings: readonly string[];
}

/** Nothing measured, and the one line saying why. */
function nothingMeasured({ why }: { why: string }): ImpactReading {
  return { impacts: new Map(), warnings: [`no impact estimates: ${why}`] };
}

/**
 * Measure the blast radius of every alert this card keeps.
 *
 * @param home the state home the census lives under
 * @param rows the tally rows, each carrying the link its notification embedded
 * @param windowMs the card's window, which every aggregate is taken over
 * @param nowMs the instant the window ends at
 * @returns one impact per measurable row, and the warnings explaining every absence
 */
export async function readAlertImpact({
  home,
  rows,
  windowMs,
  nowMs,
}: {
  home: string;
  rows: readonly BehindRow[];
  windowMs: number;
  nowMs: number;
}): Promise<ImpactReading> {
  const manifest = readCatalogueManifest({ home });
  if (manifest.isErr()) {
    return nothingMeasured({ why: manifest.error.message });
  }
  const targets = impactTargets({ limit: ALERT_IMPACT_MAX, monitors: manifest.value.map.monitors, rows });
  if (targets.length === 0) {
    return nothingMeasured({
      why:
        "none of the alerts in this window names a census monitor whose own query is an event search. A metric " +
        "threshold has no event population to take a share of",
    });
  }
  const retentionDays = manifest.value.retentionDays;
  if (retentionDays !== null && windowMs > retentionDays * DAY_MS) {
    return nothingMeasured({ why: `the window is longer than the ${String(retentionDays)}-day log retention` });
  }
  const config = loadDatadogConfig({ home });
  if (config.isErr()) {
    return nothingMeasured({ why: datadogConfigErrorLines({ error: config.error }).join("; ") });
  }
  const measured = await measureImpactTargets({
    config: config.value,
    targets: targets.map((target) => ({
      keys: target.labels,
      product: target.product,
      search: target.search,
      subject: `monitor ${String(target.monitorId)}`,
    })),
    window: { fromMs: nowMs - windowMs, toMs: nowMs },
  });
  return { impacts: measured.impacts, warnings: [...measured.warnings, ...unresolvedWarning({ rows, targets })] };
}

/**
 * The line naming rows this lane never even TRIED, because nothing resolved them to a measurable monitor.
 *
 * Without it those rows are the only silent failure on the card: a row whose aggregate threw gets a warning
 * naming the monitor, while a row whose link points at a metric threshold got no warning at all and simply
 * arrived at `impact ?`. MEASURED on the payments channel: seven rows, one target, and an empty
 * warnings array. An operator reading that could not tell a quiet Datadog from a lane that did nothing.
 *
 * @param rows the tally rows the lane was handed
 * @param targets the ones it resolved
 * @returns one warning line, or none when every row resolved
 */
function unresolvedWarning({
  rows,
  targets,
}: {
  rows: readonly BehindRow[];
  targets: readonly ImpactTarget[];
}): readonly string[] {
  const resolved = new Set(targets.flatMap((target) => target.labels));
  const missed = rows.filter((row) => !resolved.has(row.label));
  if (missed.length === 0) {
    return [];
  }
  return [
    `${String(missed.length)} of ${String(rows.length)} alert(s) carry no impact estimate: their notifications ` +
      "name no census monitor whose own query is an event search (a metric threshold has none). They read " +
      `"impact ?" and rank on severity alone: ${missed.map((row) => row.label).join(", ")}`,
  ];
}
