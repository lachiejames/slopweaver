/**
 * Which addresses this verb will open, and how a console address is built from structured arguments.
 *
 * ## An address is checked against the configured SITE — which is not the same as its org
 *
 * A URL whose host is not the console host this install is configured for is REFUSED rather than opened.
 * State the guarantee precisely, because the tempting overclaim is wrong: `DD_SITE` names a Datadog SITE
 * (`us3.datadoghq.com`, say), and several ORGANISATIONS can live on one site behind the same host. So this check
 * establishes that a shot was taken on the site this install is pointed at; it does NOT establish which org
 * the signed-in profile was looking at. What settles the org is the browser session in the profile, and the
 * honest statement of that is here rather than in a comment claiming more than the code does.
 *
 * Even so it is worth having: the failure it does prevent — a `datadoghq.eu` or `us3` address pasted in and
 * shot against an install configured for another site — is one nothing downstream could ever detect.
 *
 * ## And against a path list, because a console is not only dashboards
 *
 * The signed-in console reaches settings, billing, API keys and every team member's profile. This verb
 * photographs a VIEW, so it opens only the view paths below — an allowlist, not a denylist, because the
 * interesting failure is the path nobody thought of.
 *
 * `datadog probe`'s refusal to build a link from free text stands: the query mode here does not invent a
 * URL grammar, it delegates to `ddConsoleLink`, which is the one builder in this package and the one place
 * the per-domain freeze params live.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { AbsoluteWindow } from "../window.js";
import { type DatadogShotError, DatadogShotErrors } from "./errors.js";

/**
 * The console paths a capture may open, matched as a prefix of the path.
 *
 * Ordered as a reader would name them: the three query surfaces `ddLink.ts` already builds for, the metric
 * explorer, then the two saved-view kinds a person actually links a colleague to.
 * @internal
 */
export const SHOTTABLE_PATH_PREFIXES: readonly string[] = [
  "/logs",
  "/apm/traces",
  "/rum",
  "/metric/explorer",
  "/metric/summary",
  "/notebook/",
  "/dashboard/",
  "/monitors/",
];

/**
 * The window params that pin a Metrics Explorer view.
 *
 * `ddLink.ts` owns the freeze params for `logs`, `traces` and `rum`, and deliberately has no `metrics` row —
 * that builder's contract is a `?query=` grammar, and the Metrics Explorer has none (see
 * `explorerScript.ts`'s header for what was measured). So the metric seed is built here, where its own
 * uncertainty is stated, rather than added to a table whose other rows are verified.
 * @internal
 */
export const METRIC_EXPLORER_PATH = "/metric/explorer";

/**
 * A monitor's own read view — what a citation of the monitor opens: its state, history and query.
 *
 * @param consoleHost the site's console host, from `consoleHostFor` — never an `app.`-prefixed guess
 * @param monitorId the monitor's numeric id
 * @returns the address
 */
export function monitorPageUrl({ consoleHost, monitorId }: { consoleHost: string; monitorId: string }): string {
  return `https://${consoleHost}/monitors/${monitorId}`;
}

/**
 * The monitor edit page, which is the only page carrying the backtest panel.
 *
 * `/edit` rather than the monitor's read view on purpose: the "Monitor behavior with this threshold" panel
 * and the time-range picker that scopes it are both part of the EDIT form, and the read view has neither.
 *
 * @param consoleHost the site's console host, from `consoleHostFor`
 * @param monitorId the monitor's numeric id
 * @returns the address to open
 */
export function monitorEditUrl({ consoleHost, monitorId }: { consoleHost: string; monitorId: string }): string {
  return `${monitorPageUrl({ consoleHost, monitorId })}/edit`;
}

/**
 * Whether a monitor id is one Datadog could have issued.
 *
 * @param raw the `--id` value as typed
 * @returns `true` for a bare run of digits
 */
export function isMonitorId({ raw }: { raw: string }): boolean {
  return /^\d+$/.test(raw);
}

/**
 * Judge an address handed to `shot explorer` before any browser opens it.
 *
 * @param url the address as typed
 * @param consoleHost the console host this install is configured for
 * @returns the address, unchanged, or the typed reason it will not be opened
 */
export function validateExplorerUrl({
  url,
  consoleHost,
}: {
  url: string;
  consoleHost: string;
}): Result<string, DatadogShotError> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return err(DatadogShotErrors.urlRefused({ reason: "it is not a URL", url }));
  }
  if (parsed.protocol !== "https:") {
    return err(
      DatadogShotErrors.urlRefused({ reason: `its scheme is ${parsed.protocol}, and only https is opened`, url }),
    );
  }
  if (parsed.host !== consoleHost) {
    return err(
      DatadogShotErrors.urlRefused({
        reason:
          `its host is ${parsed.host}, and this install is configured for ${consoleHost}. A shot taken on ` +
          "another SITE is evidence about a different estate — set DD_SITE to that site, or pass an address on this one",
        url,
      }),
    );
  }
  if (!SHOTTABLE_PATH_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))) {
    return err(
      DatadogShotErrors.urlRefused({
        reason:
          `its path ${parsed.pathname} is not a view this verb photographs. Openable paths start with: ` +
          SHOTTABLE_PATH_PREFIXES.join(", "),
        url,
      }),
    );
  }
  return ok(url);
}

/**
 * Seed a Metrics Explorer address from structured arguments.
 *
 * This is a REQUEST, not a guarantee: MEASURED,`exp_metric` and `exp_agg` seed a view and no
 * param carrying the scope or the group-by was found, because the Explorer keeps that state in an opaque URL
 * fragment. The caller must therefore read back what the console rendered before it photographs anything —
 * {@link unmetQueryFragments} is that check, and `shot explorer --url` is the mode for a view whose state
 * this verb did not construct.
 *
 * @param consoleHost the site's console host
 * @param metric the metric name, e.g. `copilot.judge.result`
 * @param agg the space aggregation the explorer opens on
 * @param window the absolute window to pin the view to
 * @returns the seed address
 */
export function metricExplorerSeedUrl({
  consoleHost,
  metric,
  agg,
  window,
}: {
  consoleHost: string;
  metric: string;
  agg: string;
  window: AbsoluteWindow;
}): string {
  const params = new URLSearchParams({
    end: String(window.toMs),
    exp_agg: agg,
    exp_metric: metric,
    paused: "true",
    start: String(window.fromMs),
  });
  return `https://${consoleHost}${METRIC_EXPLORER_PATH}?${params.toString()}`;
}

/**
 * Which of the fragments a caller asked for are absent from what the console actually rendered.
 *
 * The postcondition that makes the seed mode safe: an empty list means the view on screen carries the metric
 * and the group-by that were requested, and anything else is an image whose caption would be wrong.
 *
 * @param rendered the query the console's own control is showing, plus any surrounding view text
 * @param required the fragments that must appear in it — the metric name, and the group tag when one was asked for
 * @returns the required fragments that are missing, in the order they were given
 */
export function unmetQueryFragments({
  rendered,
  required,
}: {
  rendered: string;
  required: readonly string[];
}): readonly string[] {
  const haystack = rendered.toLowerCase();
  return required.filter((fragment) => !haystack.includes(fragment.toLowerCase()));
}
