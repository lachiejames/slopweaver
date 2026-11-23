/**
 * The effectful half of an alert summary's "behind it" section: read the census map, rerun each chosen
 * monitor's log search over the card's window, and hand back form entries plus what could not be read.
 *
 * It never fails the card. An install with no census, no Datadog keys, or a window past the logs' retention
 * posts the same tally it always did, with one warning on stderr naming why the section is absent — the card
 * is unattended, and a Datadog fault is not a reason to post nothing at the hour nobody is watching.
 *
 * Each search is grouped by `service` only, which is what keeps the full census rows (tens of megabytes) off
 * this path: a service needs no census label, and the manifest alone names the monitors.
 */

import { createDatadogClient } from "../../../datadog/client.js";
import { type DatadogConfig } from "../../../datadog/config.js";
import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import { ddConsoleLink } from "../../../datadog/ddLink.js";
import { readCatalogueManifest } from "../../../datadog/detective/store.js";
import { investigate } from "../../../datadog/investigate/run.js";
import { createRawRequester } from "../../../datadog/rawRequest.js";
import { loadDatadogConfig } from "../../../datadog/source.js";
import type { AbsoluteWindow } from "../../../datadog/window.js";
import { errorMessage } from "../../../lib/errorMessage.js";
import { logger } from "../../../lib/logger.js";
import {
  BEHIND_FACET,
  type BehindRow,
  type BehindTarget,
  behindEntry,
  behindTargets,
} from "../../../live/slack/alertBehind.js";
import type { AlertSummaryBehind } from "../../../outbound/artifact/alertSummary.js";

/** Milliseconds in one day, the unit a log index states its retention in. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** What the section came to: the entries, and one line per thing that kept one out. */
export interface BehindReading {
  readonly behind: readonly AlertSummaryBehind[];
  readonly warnings: readonly string[];
}

/**
 * Read what stands behind a tally's noisiest monitors.
 *
 * @param home the state home the census lives under
 * @param rows the tally rows, each carrying the link its notification embedded
 * @param windowMs the card's window, which every search is rerun over
 * @param nowMs the instant the window ends at
 * @returns the entries, possibly none, and the warnings explaining any absence
 */
export async function readAlertBehind({
  home,
  rows,
  windowMs,
  nowMs,
}: {
  home: string;
  rows: readonly BehindRow[];
  windowMs: number;
  nowMs: number;
}): Promise<BehindReading> {
  const manifest = readCatalogueManifest({ home });
  if (manifest.isErr()) {
    return { behind: [], warnings: [`no "behind it" section: ${manifest.error.message}`] };
  }
  const targets = behindTargets({ monitors: manifest.value.map.monitors, rows });
  if (targets.length === 0) {
    return { behind: [], warnings: [] };
  }
  const retentionDays = manifest.value.retentionDays;
  if (retentionDays !== null && windowMs > retentionDays * DAY_MS) {
    return {
      behind: [],
      warnings: [`no "behind it" section: the window is longer than the ${String(retentionDays)}-day log retention`],
    };
  }
  const config = loadDatadogConfig({ home });
  if (config.isErr()) {
    return {
      behind: [],
      warnings: [`no "behind it" section: ${datadogConfigErrorLines({ error: config.error }).join("; ")}`],
    };
  }
  const behind: AlertSummaryBehind[] = [];
  const warnings: string[] = [];
  // Sequential on purpose, as `datadog alert-digest` is: these share one rate-limit budget with every other
  // scheduled Datadog read.
  for (const target of targets) {
    const read = await readOneBehind({
      config: config.value,
      target,
      window: { fromMs: nowMs - windowMs, toMs: nowMs },
    });
    if (typeof read === "string") {
      warnings.push(read);
      continue;
    }
    behind.push(read);
  }
  return { behind, warnings };
}

/**
 * Rerun ONE monitor's own log search and fold the result into a card line.
 *
 * @param config the resolved Datadog configuration, which also names the console host the link is built on
 * @param target the monitor and the search to rerun
 * @param window the card's window, absolute
 * @returns the entry, or the one line saying why this monitor has none
 */
async function readOneBehind({
  config,
  target,
  window,
}: {
  config: DatadogConfig;
  target: BehindTarget;
  window: AbsoluteWindow;
}): Promise<AlertSummaryBehind | string> {
  try {
    const result = await investigate({
      catalogue: null,
      client: createDatadogClient({ config, logger }),
      logger,
      request: { excludes: [], facets: [BEHIND_FACET], product: "logs", query: target.search, rows: 0, window },
      requester: createRawRequester({ config, logger }),
    });
    if (result.total === null) {
      return `no "behind it" line for monitor ${String(target.monitorId)}: ${result.notes.join("; ")}`;
    }
    // The total is the track's own `hitCount` while the groups come from the analytics aggregate
    // (`datadog/investigate/run.ts`'s header), so a share is arithmetic over two separately-measured numbers.
    // A `groupsFromPage` branch stood here and a review pass showed it was DEAD: `fromPage` is set only on
    // the `countedBy === "track"` path and the `logs` product counts through analytics, so the flag this
    // reader could have branched on is never true for it. A guard that cannot fire is worse than none — it
    // reads as protection. `behindEntry` drops a group whose count exceeds the total, which bounds each
    // printed SHARE at 100%; it does not bound their sum, and nothing here claims it does.
    const citationUrl = ddConsoleLink({ consoleHost: config.consoleHost, domain: "logs", query: result.query, window });
    return behindEntry({ citationUrl, groups: result.groups, target, total: result.total });
  } catch (error: unknown) {
    return `no "behind it" line for monitor ${String(target.monitorId)}: ${errorMessage({ error })}`;
  }
}
