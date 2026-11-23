/**
 * The pure half of an alert's estimated blast radius: which service one alert lives on, and how its two
 * counted numbers become a form field. Pure.
 *
 * The effectful half is `../../cli/commands/slack/alertImpactRun.ts`, which issues the two aggregates. The
 * priority those numbers derive is `../../outbound/artifact/priority.ts`, which knows nothing about Datadog.
 * Three files because the three things fail differently: a census that cannot be read, an aggregate that
 * cannot be taken, and a matrix that is a decision.
 *
 * ## Why the denominator is the SERVICE and why that is what makes this affordable
 *
 * "Blast radius" needs something to be a radius OF. The Datadog census (`../../datadog/detective/map.ts`)
 * stores each monitor's id, name, query and type and nothing else — no tags, no SLO, no audience — so there is
 * no population on this install to divide by. What there is, for a log alert, is the service its own events
 * land on: rerun the monitor's query grouped by `service`, take the largest group, and ask how much that
 * service logged in total over the same window.
 *
 * The consequence is the reason the lane fits in an unattended tick at all. The numerator is per ROW and the
 * denominator is per SERVICE, and ten monitors in one alerts channel usually name one to four services between
 * them — so a channel costs about a dozen reads rather than twenty, and the same service read twice inside one
 * run is read once.
 */

import { safeJsonParse } from "../../lib/safeJson.js";
import { IMPACT_EVENTS_MAX, IMPACT_SERVICE_MAX } from "../../outbound/artifact/priority.js";
import { BEHIND_FACET, type BehindGroup, type BehindMonitor, type BehindRow, monitorIdOf } from "./alertBehind.js";

/**
 * How many rows one run measures.
 *
 * Every row a card keeps, because `foldTally` already caps them at `TABLE_MAX_ROWS` and the ranking cannot know
 * which rows ride above the fold until the impact is measured. Measuring only the noisiest would decide the
 * ranking by noise, which is the ordering this whole change replaces.
 */
export const ALERT_IMPACT_MAX = 10;

/**
 * The two monitor kinds whose own query is an EVENT SEARCH, and the investigate product each is rerun under.
 *
 * MEASURED on the installed census (`slopweaver datadog catalogue show`): of a couple of hundred
 * monitors, under half are log alerts and about a fifth are trace-analytics alerts, so these two cover about
 * two-thirds — where log alerts alone left the payments channel with ONE measured row of several, every other
 * alert there being a span or a metric monitor. The remaining third are metric-shaped (`sum(last_15m):sum:payments.sentinel.fired{…}`) and are left
 * unmeasured on purpose: a metric threshold has no event population to be a share of, and inventing one is
 * exactly the guessing this lane's `unknown` band exists to avoid.
 */
const SEARCH_MONITORS: Readonly<Record<string, { readonly product: "logs" | "apm"; readonly wrapper: string }>> = {
  "log alert": { product: "logs", wrapper: "logs" },
  "trace-analytics alert": { product: "apm", wrapper: "trace-analytics" },
};

/** One monitor whose own event search can be rerun to measure what it matched. */
export interface ImpactTarget {
  /** The noisiest tally row this monitor produced, so a warning names a row a reader can see. */
  readonly monitor: string;
  readonly monitorId: number;
  /** The event search the monitor evaluates, unwrapped from its own call. */
  readonly search: string;
  /** Which investigate product counts it. */
  readonly product: "logs" | "apm";
  /**
   * EVERY tally row this monitor produced, noisiest first — what one reading is attributed to.
   *
   * One monitor commonly becomes several rows: `alertTally` condenses a grouped notification to `head · key`,
   * so Datadog monitor 700001 arrives as three rows, one per `check:` group. The search rerun is the MONITOR's,
   * covering all of them, so attributing its numerator to the noisiest row alone would overstate that row and
   * leave the other two reading `impact ?` beside a warning claiming they named no measurable monitor — which
   * would be false. MEASURED on `acme-payments-alerts-critical`.
   */
  readonly labels: readonly string[];
}

/** `<wrapper>("<json string>")` at the head of a monitor's query. */
const SEARCH_CALL = /^([a-z-]+)\(("(?:[^"\\]|\\.)*")\)/u;

/**
 * The event search one monitor's query evaluates, and the product that counts it.
 *
 * A COMPOSITE monitor is refused rather than half-run, the same judgement `./alertBehind.ts` makes and for the
 * same reason: unwrapping the head of `logs("a") … AND logs("b") …` reruns one arm while the card's own number
 * claims to be the monitor's. Here it would also make the numerator a fraction of what fired.
 *
 * @param query the monitor's whole query
 * @param type the monitor's own type, as the census stores it
 * @returns the unwrapped search and its product, or nothing when this monitor is not an event search
 */
export function monitorSearchOf({
  query,
  type,
}: {
  query: string;
  type: string;
}): { readonly search: string; readonly product: "logs" | "apm" } | null {
  const kind = SEARCH_MONITORS[type];
  if (kind === undefined) {
    return null;
  }
  if (query.split(`${kind.wrapper}(`).length > 2) {
    return null;
  }
  const matched = SEARCH_CALL.exec(query.trim());
  if (matched === null || matched[1] !== kind.wrapper) {
    return null;
  }
  try {
    const search: unknown = safeJsonParse({ label: "monitor event search", text: matched[2]! });
    if (typeof search !== "string" || search.trim().length === 0) {
      return null;
    }
    return { product: kind.product, search };
  } catch {
    return null;
  }
}

/**
 * The rows worth measuring: the noisiest whose link names a census monitor whose query is an event search.
 *
 * Deliberately NOT `./alertBehind.ts`'s `behindTargets` with a bigger limit — that resolver accepts LOG alerts
 * only, because the section it feeds says in its own sentence that it reruns a log search. Widening it would
 * make that sentence false; two criteria get two resolvers, each naming what it accepts.
 *
 * `limit` counts MONITORS, which is what costs a read — a monitor that produced four rows is one target and one
 * aggregate, and all four of its rows are attributed that one reading.
 *
 * @param rows the tally rows, in any order
 * @param monitors the census map's monitors
 * @param limit how many targets to resolve at most
 * @returns at most `limit` targets, noisiest first, one per monitor
 */
export function impactTargets({
  rows,
  monitors,
  limit = ALERT_IMPACT_MAX,
}: {
  rows: readonly BehindRow[];
  monitors: readonly BehindMonitor[];
  limit?: number;
}): readonly ImpactTarget[] {
  const byId = new Map(monitors.map((monitor) => [monitor.id, monitor]));
  const ordered = rows.toSorted((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  const targets: ImpactTarget[] = [];
  const byMonitorId = new Map<number, string[]>();
  for (const row of ordered) {
    const resolved = targetOf({ byId, row });
    if (resolved === null) {
      continue;
    }
    const seen = byMonitorId.get(resolved.monitorId);
    if (seen !== undefined) {
      seen.push(row.label);
      continue;
    }
    if (targets.length >= limit) {
      continue;
    }
    const labels: string[] = [row.label];
    byMonitorId.set(resolved.monitorId, labels);
    targets.push({ ...resolved, labels });
  }
  return targets;
}

/** One row's target, when its link resolves to a census monitor whose query is an event search. */
function targetOf({
  row,
  byId,
}: {
  row: BehindRow;
  byId: ReadonlyMap<number, BehindMonitor>;
}): Omit<ImpactTarget, "labels"> | null {
  if (row.embeddedLink === undefined) {
    return null;
  }
  const monitorId = monitorIdOf({ link: row.embeddedLink });
  if (monitorId === null) {
    return null;
  }
  const monitor = byId.get(monitorId);
  if (monitor === undefined) {
    return null;
  }
  const unwrapped = monitorSearchOf({ query: monitor.query, type: monitor.type });
  if (unwrapped === null) {
    return null;
  }
  return { monitor: row.label, monitorId, product: unwrapped.product, search: unwrapped.search };
}

/** One alert's measured blast radius, as the form carries it. */
export interface AlertImpact {
  /** How many events this alert's own query matched over the window. */
  readonly matched: number;
  /** How many events the same service logged over the same window. */
  readonly scope: number;
  /** The service both numbers are taken over. */
  readonly service: string;
}

/**
 * The service one alert lives on — the largest group of its own aggregate — and how many of the alert's events
 * landed THERE.
 *
 * The count is the share's numerator, never the aggregate's total: the denominator is that one service's telemetry,
 * so a query spanning four services (every Knock probe does) would otherwise divide all four services' matches by
 * one service's volume and overstate the share.
 *
 * Groups whose count exceeds the aggregate's own total are dropped before the largest is taken, the same guard
 * `./alertBehind.ts`'s `behindEntry` applies to the shares it prints — the total and the groups come from two
 * separately-measured numbers, so a group can legitimately overtake its own total.
 *
 * A group whose service value is the EMPTY string names no service either: the form's impact field requires a
 * non-empty service, so taking one would emit a digest the door refuses where main sent a triage card.
 *
 * @param groups the counted groups, in any order
 * @param total how many events the aggregate matched overall
 * @returns the dominant service and its own matched count, or nothing when no group named one
 */
export function dominantService({
  groups,
  total,
}: {
  groups: readonly BehindGroup[];
  total: number;
}): { readonly service: string; readonly matched: number } | undefined {
  const named = groups
    .filter((group) => namedService({ group }) !== undefined && group.count > 0 && group.count <= total)
    .toSorted((left, right) => right.count - left.count);
  const largest = named[0];
  if (largest === undefined) {
    return undefined;
  }
  const service = namedService({ group: largest });
  if (service === undefined) {
    return undefined;
  }
  return { matched: largest.count, service };
}

/**
 * The service a group names, or nothing when its facet is absent or empty.
 *
 * @param group one counted group of an aggregate
 * @returns the service value, when it is a non-empty string
 */
function namedService({ group }: { group: BehindGroup }): string | undefined {
  const service = group.by[BEHIND_FACET];
  if (service === undefined || service.length === 0) {
    return undefined;
  }
  return service;
}

/**
 * Why {@link dominantService} found nothing, in words that are true of the groups it was given.
 *
 * Two different facts end there and a warning must not merge them: an aggregate whose groups named no service
 * carrying an event, and one that DID name a service whose count overtook the aggregate's own total — the two
 * reads disagreeing, which a line saying "named no service" would misreport.
 *
 * A read that carried NOTES claims neither: a failed grouped read arrives as no groups plus a "not read" note,
 * and a page-folded one is a floor over a sample, so what the groups lack says nothing about the services. The
 * notes are the reason then, verbatim. Both other sentences name only the services the grouped read RETURNED,
 * since a read capped at its group limit can omit one.
 *
 * @param groups the counted groups {@link dominantService} was given
 * @param notes what the read itself said went unread or was estimated
 * @param total how many events the aggregate matched overall
 * @returns the reason, as the clause after a warning's colon
 */
export function noDominantServiceReason({
  groups,
  notes,
  total,
}: {
  groups: readonly BehindGroup[];
  notes: readonly string[];
  total: number;
}): string {
  if (notes.length > 0) {
    return `no dominant service could be taken from what was read: ${notes.join("; ")}`;
  }
  const overtook = groups.filter(
    (group) => namedService({ group }) !== undefined && group.count > 0 && group.count > total,
  );
  if (overtook.length > 0) {
    return (
      `every service the grouped read returned with any of its own query's events counted more than the query's total of ${String(total)} over this window, ` +
      "so the two reads disagree and no share is taken"
    );
  }
  const unnamed = groups.filter((group) => group.by[BEHIND_FACET] === "" && group.count > 0);
  if (unnamed.length > 0) {
    return "the grouped read counted its own query's events only under an empty service name, so there is no service to take a share of";
  }
  return "no service the grouped read returned carried any of its own query's events over this window, so there is nothing to take a share of";
}

/**
 * One row's impact field, or nothing when the two numbers cannot make a blast radius.
 *
 * Refuses a zero or negative `scope` here rather than downstream, so an unmeasurable reading never reaches the
 * form at all: `../../outbound/artifact/priority.ts` would band it `unknown` anyway, and a field carrying a
 * denominator of zero is a number on the card that means nothing.
 *
 * @param matched how many events the alert's own query matched
 * @param scope how many events its service logged over the same window
 * @param service the service both numbers describe
 * @returns the form field, or undefined when there is no usable denominator
 */
export function impactOf({
  matched,
  scope,
  service,
}: {
  matched: number;
  scope: number;
  service: string;
}): AlertImpact | undefined {
  if (scope <= 0 || matched < 0 || matched > IMPACT_EVENTS_MAX || scope > IMPACT_EVENTS_MAX) {
    return undefined;
  }
  return { matched, scope, service: clippedService({ service }) };
}

/**
 * Why {@link impactOf} declined, in words that are true of both numbers it was given.
 *
 * The numerator and the denominator are two separately-issued reads, so a service can carry the alert's own
 * matches while its total reads zero. Saying that service "logged nothing" would contradict the first read,
 * so a positive numerator is reported as the reads disagreeing.
 *
 * @param matched how many events the alert's own query matched on the service
 * @param scope how many events the service logged over the same window
 * @param service the service both numbers describe
 * @returns the reason, as the clause after a warning's colon
 */
export function noImpactReason({
  matched,
  scope,
  service,
}: {
  matched: number;
  scope: number;
  service: string;
}): string {
  if (matched > IMPACT_EVENTS_MAX || scope > IMPACT_EVENTS_MAX) {
    return (
      `a read on service ${service} came back past the impact field's bound of ${String(IMPACT_EVENTS_MAX)} events ` +
      `(matched ${String(matched)}, total ${String(scope)}), so no share is taken`
    );
  }
  if (matched < 0) {
    return `its own query's count on service ${service} read negative, so there is no numerator to take a share of`;
  }
  if (matched > 0 && scope <= 0) {
    return (
      `its own query matched ${String(matched)} on service ${service} while that service's total read ` +
      `${String(scope)}, so the two reads disagree and no share is taken`
    );
  }
  return `service ${service} logged nothing over this window, so there is no denominator to take a share of`;
}

/**
 * A service name cut to the form's label cap, with the cut shown.
 *
 * The same cap and the same visible ellipsis `./alertBehind.ts` uses on a group name, for the same reason: the
 * name is somebody else's, the cap is this repository's, and a silent cut is the failure `../../outbound/strictForm.ts`
 * exists to stop.
 *
 * @param service the service as Datadog named it
 * @returns the name, ellipsised when it was longer than the cap
 */
function clippedService({ service }: { service: string }): string {
  if (service.length <= IMPACT_SERVICE_MAX) {
    return service;
  }
  return `${service.slice(0, IMPACT_SERVICE_MAX - 1)}…`;
}
