/**
 * The effectful half of an alert's estimated blast radius, shared by both alert cards: rerun each alert's own
 * event search grouped by service, then ask how much that service produced in total over the same window.
 *
 * Two callers, and the reason this is neither of theirs. `../slack/alertImpactRun.ts` resolves a Slack
 * notification to the Datadog MONITOR it links to and reruns that monitor's search; `./alertDigestMeasure.ts`
 * reruns a digest PROBE's own declared logs query. What they share is everything after the search is known —
 * the grouped numerator, the dominant service and the memoised denominator — and a copy of that per card is
 * how two cards come to rank the same alert differently (`../../../outbound/artifact/priority.ts` is the matrix
 * both feed).
 *
 * It never fails a card. Every read that cannot be taken becomes one warning naming its subject, and that
 * alert reads `impact ?`.
 *
 * ## The denominator is memoised, and that is the budget
 *
 * Each target costs one aggregate. Each distinct SERVICE costs one more, once. Ten alerts on one card usually
 * name one to four services between them, so a card comes to about a dozen sequential reads rather than twenty
 * — see `../../../live/slack/alertImpact.ts` for why the denominator is a service at all.
 */

import { createDatadogClient } from "../../../datadog/client.js";
import type { DatadogConfig } from "../../../datadog/config.js";
import { investigate } from "../../../datadog/investigate/run.js";
import { createRawRequester } from "../../../datadog/rawRequest.js";
import type { AbsoluteWindow } from "../../../datadog/window.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { logger } from "../../../lib/logger.js";
import { BEHIND_FACET } from "../../../live/slack/alertBehind.js";
import {
  type AlertImpact,
  dominantService,
  impactOf,
  noDominantServiceReason,
  noImpactReason,
} from "../../../live/slack/alertImpact.js";

/** One event search to measure, and every card key its one reading is attributed to. */
export interface ImpactMeasureTarget {
  /** How a warning names this target — `monitor 700001`, `probe 'knock-user-upsert-failures'`. */
  readonly subject: string;
  /** The event search, exactly as its product's search syntax reads it. */
  readonly search: string;
  /** Which investigate product counts it. */
  readonly product: "logs" | "apm";
  /**
   * Every key this one reading lands under. A summary monitor that produced three tally rows is one target
   * with three labels; a digest probe is one target with its own id.
   */
  readonly keys: readonly string[];
}

/** What a measurement came to: one impact per key, and one line per thing that kept one out. */
export interface ImpactMeasurement {
  readonly impacts: ReadonlyMap<string, AlertImpact>;
  readonly warnings: readonly string[];
}

/**
 * Take every aggregate, memoising each service's total across the run.
 *
 * Sequential on purpose: these share one rate-limit budget with every other scheduled Datadog read, and a burst
 * of ten from eleven channels is what would spend it.
 *
 * @param config the resolved Datadog configuration
 * @param targets the searches to measure, in the order their warnings should read
 * @param window the card's window, absolute — numerator and denominator are both taken over exactly this
 * @returns one impact per key whose target produced two usable numbers, and the warnings for the rest
 */
export async function measureImpactTargets({
  config,
  targets,
  window,
}: {
  config: DatadogConfig;
  targets: readonly ImpactMeasureTarget[];
  window: AbsoluteWindow;
}): Promise<ImpactMeasurement> {
  const impacts = new Map<string, AlertImpact>();
  const warnings: string[] = [];
  const scopes = new Map<string, number | undefined>();
  for (const target of targets) {
    const matched = await matchedFor({ config, target, window });
    if (typeof matched === "string") {
      warnings.push(matched);
      continue;
    }
    const scope = await scopeFor({ config, product: target.product, scopes, service: matched.service, window });
    if (typeof scope === "string") {
      warnings.push(scope);
      continue;
    }
    const impact = impactOf({ matched: matched.total, scope, service: matched.service });
    if (impact === undefined) {
      const reason = noImpactReason({ matched: matched.total, scope, service: matched.service });
      warnings.push(`no impact estimate for ${target.subject}: ${reason}`);
      continue;
    }
    for (const key of target.keys) {
      impacts.set(key, impact);
    }
  }
  return { impacts, warnings };
}

/** The events one search matched ON the service they mostly landed on, and that service. */
interface MatchedEvents {
  readonly total: number;
  readonly service: string;
}

/**
 * Rerun ONE search, grouped by service.
 *
 * @param config the resolved Datadog configuration
 * @param target the search to rerun
 * @param window the card's window, absolute
 * @returns the numerator and its service, or the one line saying why this target has neither
 */
async function matchedFor({
  config,
  target,
  window,
}: {
  config: DatadogConfig;
  target: ImpactMeasureTarget;
  window: AbsoluteWindow;
}): Promise<MatchedEvents | string> {
  try {
    const result = await investigate({
      catalogue: null,
      client: createDatadogClient({ config, logger }),
      logger,
      request: { excludes: [], facets: [BEHIND_FACET], product: target.product, query: target.search, rows: 0, window },
      requester: createRawRequester({ config, logger }),
    });
    if (result.total === null) {
      return `no impact estimate for ${target.subject}: ${result.notes.join("; ")}`;
    }
    const dominant = dominantService({ groups: result.groups, total: result.total });
    if (dominant === undefined) {
      return `no impact estimate for ${target.subject}: ${noDominantServiceReason({ groups: result.groups, notes: result.notes, total: result.total })}`;
    }
    return { service: dominant.service, total: dominant.matched };
  } catch (error: unknown) {
    return `no impact estimate for ${target.subject}: ${errorMessage({ error })}`;
  }
}

/**
 * How much one service logged over the window — read once per service, whatever the run asks.
 *
 * The memo holds the FAILURE too, as an `undefined` value under a present key: a service whose total could not
 * be read will not be readable for the next target either, and re-asking would spend the budget this lane's
 * whole shape exists to keep small.
 *
 * Keyed by PRODUCT and service together, not by service alone. A share has to be taken over the population its
 * numerator came from: a log search's matched lines against that service's logs, a span search's matched spans
 * against that service's spans. Sharing one key between them would divide spans by log lines and print a
 * confident percentage of the wrong thing.
 *
 * @param config the resolved Datadog configuration
 * @param scopes the per-run memo, mutated
 * @param service the service to total
 * @param product which population to total it over
 * @param window the card's window, absolute
 * @returns the denominator, or the one line saying why this service has none
 */
async function scopeFor({
  config,
  scopes,
  service,
  product,
  window,
}: {
  config: DatadogConfig;
  scopes: Map<string, number | undefined>;
  service: string;
  product: "logs" | "apm";
  window: AbsoluteWindow;
}): Promise<number | string> {
  const key = `${product}:${service}`;
  if (scopes.has(key)) {
    const remembered = scopes.get(key);
    if (remembered === undefined) {
      return `no impact estimate against service ${service}: its own total could not be read over this window`;
    }
    return remembered;
  }
  try {
    const result = await investigate({
      catalogue: null,
      client: createDatadogClient({ config, logger }),
      logger,
      // Quoted, because a service name can carry the characters the search syntax reads as operators.
      request: {
        excludes: [],
        facets: [],
        product,
        query: `${BEHIND_FACET}:${JSON.stringify(service)}`,
        rows: 0,
        window,
      },
      requester: createRawRequester({ config, logger }),
    });
    if (result.total === null) {
      scopes.set(key, undefined);
      return `no impact estimate against service ${service}: ${result.notes.join("; ")}`;
    }
    scopes.set(key, result.total);
    return result.total;
  } catch (error: unknown) {
    scopes.set(key, undefined);
    return `no impact estimate against service ${service}: ${errorMessage({ error })}`;
  }
}
