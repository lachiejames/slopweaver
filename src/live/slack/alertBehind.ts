/**
 * What stands behind an alert-summary card's noisiest monitors, joined through the Datadog census. Pure.
 *
 * ## Why the join is on the monitor id, never the label
 *
 * A tally row's label is normalised for a reader — tails cut, `head · key` condensed, trimmed with an ellipsis
 * (`./alertTally.ts`) — and a monitor's name may carry `{{…}}` template placeholders that no rendered label
 * reproduces. The alerting tool's own link does not suffer either: every Datadog notification
 * links `/monitors/<id>`, and the census map holds each monitor by that id with its query beside it.
 *
 * ## Why only `log alert` monitors
 *
 * A log alert's query is a log search wrapped in `logs("…")`, so rerunning the SAME search over the card's
 * window is exactly what fired, not a query somebody guessed at. The metric, trace and RUM monitors a census
 * also holds are left without a line rather than given an approximate one.
 */

import { safeJsonParse } from "../../lib/safeJson.js";
import {
  ALERT_SUMMARY_BEHIND_GROUPS_MAX,
  ALERT_SUMMARY_BEHIND_MAX,
  ALERT_SUMMARY_ROW_LABEL_MAX,
  type AlertSummaryBehind,
} from "../../outbound/artifact/alertSummary.js";

/** A monitor as the census map holds it. */
export interface BehindMonitor {
  readonly id: number;
  readonly type: string;
  readonly query: string;
}

/** One monitor whose own log search can be rerun behind a tally row. */
export interface BehindTarget {
  /** The tally row's own label, so the line reads as the row it explains. */
  readonly monitor: string;
  readonly monitorId: number;
  /** The log search the monitor evaluates, unwrapped from `logs("…")`. */
  readonly search: string;
}

/** The part of a tally row this join reads. */
export interface BehindRow {
  readonly label: string;
  readonly count: number;
  readonly embeddedLink?: string | undefined;
}

/** One counted group from a grouped aggregate. */
export interface BehindGroup {
  readonly by: Readonly<Record<string, string>>;
  readonly count: number;
}

/** The facet every behind-aggregate groups by. */
export const BEHIND_FACET = "service";

/** A Datadog monitor path, on any site's console host. */
const MONITOR_PATH = /^https:\/\/[^/]+\/monitors\/(\d+)(?:[/?#]|$)/u;

/** `logs("<json string>")` at the head of a log alert's query. */
const LOG_SEARCH = /^logs\(("(?:[^"\\]|\\.)*")\)/u;

/**
 * The monitor id a notification's own link names.
 *
 * @param link the link the alerting tool embedded
 * @returns the id, or nothing when the link is not a Datadog monitor link
 */
export function monitorIdOf({ link }: { link: string }): number | null {
  const matched = MONITOR_PATH.exec(link);
  if (matched === null) {
    return null;
  }
  return Number(matched[1]!);
}

/**
 * The log search a log alert's query evaluates.
 *
 * @param query the monitor's whole query, e.g. `logs("service:x status:error").index("*")….last("5m") > 0`
 * @returns the unwrapped search, or nothing when the query is not a log search
 */
export function logSearchOf({ query }: { query: string }): string | null {
  // A COMPOSITE log alert is refused rather than half-run. A query shaped like
  // `logs("service:billing-api …") … AND logs("service:mailer-api …") …` is one, and unwrapping its head would
  // rerun one arm while the card's own sentence claims it reran "the monitor's own query". Measured by a
  // review pass; `store detect` is where a session investigates such a monitor properly.
  if (query.split("logs(").length > 2) {
    return null;
  }
  const matched = LOG_SEARCH.exec(query.trim());
  if (matched === null) {
    return null;
  }
  try {
    const search: unknown = safeJsonParse({ label: "monitor log search", text: matched[1]! });
    if (typeof search !== "string" || search.trim().length === 0) {
      return null;
    }
    return search;
  } catch {
    return null;
  }
}

/**
 * The monitors worth a "behind it" line: the noisiest rows whose link names a census log-alert monitor.
 *
 * The impact lane (`./alertImpact.ts`) resolves its own targets rather than calling this with a bigger limit,
 * and the reason is the ACCEPTANCE set rather than the budget: this section reruns a LOG search and says so in
 * its own sentence, while impact also measures a span search. Two criteria, two resolvers, each stating what it
 * accepts — where one resolver with a flag would leave this lane's sentence claiming something it stopped doing.
 *
 * @param rows the tally rows, in any order
 * @param monitors the census map's monitors
 * @returns at most {@link ALERT_SUMMARY_BEHIND_MAX} targets, noisiest first, one per monitor
 */
export function behindTargets({
  rows,
  monitors,
}: {
  rows: readonly BehindRow[];
  monitors: readonly BehindMonitor[];
}): readonly BehindTarget[] {
  const byId = new Map(monitors.map((monitor) => [monitor.id, monitor]));
  const ordered = rows.toSorted((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  const targets: BehindTarget[] = [];
  for (const row of ordered) {
    if (targets.length >= ALERT_SUMMARY_BEHIND_MAX) {
      break;
    }
    const target = targetOf({ byId, row });
    if (target !== null && !targets.some((seen) => seen.monitorId === target.monitorId)) {
      targets.push(target);
    }
  }
  return targets;
}

/**
 * One row's target, when its link resolves to a census log alert.
 *
 * @param row one tally row
 * @param byId the census monitors, keyed by id
 * @returns the target, or nothing
 */
function targetOf({ row, byId }: { row: BehindRow; byId: ReadonlyMap<number, BehindMonitor> }): BehindTarget | null {
  if (row.embeddedLink === undefined) {
    return null;
  }
  const monitorId = monitorIdOf({ link: row.embeddedLink });
  if (monitorId === null) {
    return null;
  }
  const monitor = byId.get(monitorId);
  if (monitor?.type !== "log alert") {
    return null;
  }
  const search = logSearchOf({ query: monitor.query });
  if (search === null) {
    return null;
  }
  return { monitor: row.label, monitorId, search };
}

/**
 * The card line one aggregate becomes.
 *
 * @param target the monitor the aggregate was taken for
 * @param total how many events the search matched over the window
 * @param groups the counted groups, in any order
 * @param citationUrl the console link reproducing the aggregate, when one could be built
 * @returns the form entry, largest groups first
 */
export function behindEntry({
  target,
  total,
  groups,
  citationUrl,
}: {
  target: BehindTarget;
  total: number;
  groups: readonly BehindGroup[];
  citationUrl: string | null;
}): AlertSummaryBehind {
  const named = groups
    .filter((group) => group.by[BEHIND_FACET] !== undefined && group.count > 0 && group.count <= total)
    .toSorted((left, right) => right.count - left.count)
    .slice(0, ALERT_SUMMARY_BEHIND_GROUPS_MAX)
    .map((group) => ({ count: group.count, name: clipped({ text: group.by[BEHIND_FACET]! }) }));
  return {
    events: total,
    groups: named,
    monitor: clipped({ text: target.monitor }),
    ...(citationUrl === null ? {} : { citationUrl }),
  };
}

/**
 * A name cut to the form's label cap, with the cut shown.
 *
 * @returns the text, ellipsised when it was longer than the cap
 */
function clipped({ text }: { text: string }): string {
  if (text.length <= ALERT_SUMMARY_ROW_LABEL_MAX) {
    return text;
  }
  return `${text.slice(0, ALERT_SUMMARY_ROW_LABEL_MAX - 1)}…`;
}
