/**
 * The frozen console link one alert probe's reading cites.
 *
 * A logs probe cites the query it ran; a metric probe cites the search it declared, because a metric query is
 * not a console search. `alertProbe.ts`'s shape check guarantees exactly one of the two is set.
 *
 * **A `logs-facet-sum` link also names the measure it took.** Its number SUMS an attribute across the matching
 * logs, while the same search in the Log Explorer counts log LINES — measured on the integrity-audit card, 2,569
 * on the row against a chart of 30 logs. So the link carries `agg_m=<attribute>&agg_t=sum`, the Log Explorer's
 * own aggregation params: a reader who flips it to a timeseries sees the summed quantity, and
 * `live/automation/digestShots.ts` can tell from the card alone that no capture adapter reads that quantity back.
 *
 * Pure: no fs, no clock, no network. `cli/commands/datadog/alertDigestRun.ts` validates what this builds.
 */
import { err, ok, type Result } from "../lib/result.js";

import type { AlertProbe } from "./alertProbe.js";
import { AlertProbeErrors } from "./alertProbeErrors.js";
import type { DdConsoleHost } from "./config.js";
import { type DdLinkDomain, ddConsoleLink } from "./ddLink.js";
import type { AbsoluteWindow } from "./window.js";

/**
 * Build the citation one probe's reading carries.
 *
 * @internal — `alertDigestRun.ts` is the one production caller; exported for its unit test.
 * @param consoleHost the site's console host the link must point at
 * @param probe the declared check whose reading this cites
 * @param window the absolute window the reading was taken over
 * @returns the frozen console link and the domain it opens, or why a facet-sum probe reached here with no
 *   attribute to name
 */
export function alertProbeCitationUrl({
  consoleHost,
  probe,
  window,
}: {
  readonly consoleHost: DdConsoleHost;
  readonly probe: AlertProbe;
  readonly window: AbsoluteWindow;
}): Result<{ readonly domain: DdLinkDomain; readonly url: string }> {
  let cited: { readonly domain: DdLinkDomain; readonly query: string } = { domain: "logs", query: probe.query };
  if (probe.citation !== undefined) {
    cited = probe.citation;
  }
  let extraParams: string | null = null;
  if (probe.kind === "logs-facet-sum") {
    const sumAttribute = probe.sumAttribute;
    if (sumAttribute === undefined) {
      return err([
        AlertProbeErrors.shapeMismatch({
          detail: "kind 'logs-facet-sum' reached the citation with no sumAttribute to name",
          probeId: probe.id,
        }).message,
      ]);
    }
    extraParams = `agg_m=${encodeURIComponent(sumAttribute)}&agg_t=sum`;
  }
  const url = ddConsoleLink({ consoleHost, domain: cited.domain, extraParams, query: cited.query, window });
  return ok({ domain: cited.domain, url });
}
