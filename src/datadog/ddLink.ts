/**
 * The ONE Datadog console-link builder. Every evidence link in this package comes from here.
 *
 * ## The per-domain freeze params, which are not the same
 *
 * A link that does not pin its window opens live at "now", so the number in a claim and the view a reader
 * gets on clicking it silently diverge. The params that pin it **differ by domain**:
 *
 * | domain   | path          | freeze params                      |
 * | -------- | ------------- | ---------------------------------- |
 * | `logs`   | `/logs`       | `from_ts` + `to_ts` + `live=false` |
 * | `traces` | `/apm/traces` | `from_ts` + `to_ts` + `live=false` |
 * | `rum`    | `/rum`        | `start` + `end` + `paused=true`    |
 *
 * One builder means the per-domain decision is made once, in a table, next to the reason it exists.
 *
 * The `logs` row has been checked against a live console: opening a generated link showed the time picker
 * holding the absolute range the link carried (`from_ts`/`to_ts` rendered exactly, to the minute) with the
 * stream paused rather than live.
 *
 * The `traces` row was `start`/`end`/`paused=true` — Datadog's documented APM params — until it was
 * MEASURED against this install's site through the governed relay. A growth-ops citation over a 24-hour
 * window opened on **15 minutes**: the console rewrote the address to `start=<end - 900000>`, the picker
 * read `15m`, and the panel counted 78 indexed spans. The same query and window as
 * `from_ts`/`to_ts`/`live=false` held the day — picker `1d`, `3.23k indexed spans`, against the metric's
 * own 3,213 for the same probe. So every traces citation this package had ever shipped opened a reader on
 * a window the claim was not computed over. Repro:
 * `slopweaver browser shot --raw --url '<a /apm/traces link>' --out /tmp/t.png --settle 15000 --json`
 * and read `finalUrl`.
 *
 * `rum` still follows the documented behaviour and has not been re-checked in a browser — said plainly,
 * because "documented" is a weaker claim than "measured" and the next person should know which row is
 * which.
 *
 * A fourth view, `/metric/explorer`, is CITED but never built here; it lives in {@link DdCitedView} below
 * with the reason it is not a builder domain.
 *
 * ## A dead host is uncomposable
 *
 * `consoleHost` is a {@link DdConsoleHost} — the literal union of `./config.ts`'s console-host table — so a
 * hand-typed host fails to compile, and every real caller passes `resolveDatadogConfig`'s own table value. The
 * builder ALSO checks at runtime, because a cast, a JSON round trip or a future widening of that type all reach
 * here as a plain string — and it THROWS, naming the host it should have been, rather than returning a refusal:
 * the type already makes this state unreachable, so it is a programming error no caller can act on, and a
 * `Result` every caller must unwrap for a branch none of them can reach is ceremony. The bot once posted dead `app.<site>` monitor links, so the same host check sits on the Datadog
 * link builder and the wrong host is never composed. No hatch opens this: the one
 * builder must never manufacture a dead link, even for a session holding the outbound hatch.
 *
 * ## A windowless link is unrepresentable
 *
 * `window.ts` resolves every window to a total {@link AbsoluteWindow} before anything is queried, so a
 * single required field of that type carries the guarantee that a link is always built with a resolved
 * window — there is no partial-window state a link builder could be handed.
 */
import { consoleHostFor, DD_SITES, type DdConsoleHost } from "./config.js";
import { invalidDatadogConsoleHosts } from "./invalidConsoleHost.js";
import type { AbsoluteWindow } from "./window.js";

/** Every real console host, for the builder's runtime check. */
const REAL_CONSOLE_HOSTS: ReadonlySet<string> = new Set(DD_SITES.map((site) => consoleHostFor({ site })));

/** The console areas a link can point at. */
export type DdLinkDomain = "logs" | "traces" | "rum";

/** Console path per domain. */
export const DD_LINK_PATHS: Readonly<Record<DdLinkDomain, string>> = {
  logs: "/logs",
  traces: "/apm/traces",
  rum: "/rum",
};

/**
 * How each domain's view is frozen: which params carry the window, and which one pins it.
 *
 * Exported because a link is now also VALIDATED before it ships as evidence (`citation.ts`), and the
 * builder and the validator disagreeing about what "frozen" means would be the same class of defect as
 * having two separate builders drift apart. Deriving both sides from this record is what makes that
 * unrepresentable — a validator demanding `live=false` AND `paused=true` on every link would reject a
 * correctly frozen logs link, which sets `live=false` and no `paused` at all.
 */
export const DD_LINK_FREEZE: Readonly<Record<DdLinkDomain, DdFreezeSpec>> = {
  logs: { from: "from_ts", to: "to_ts", pin: "live", pinValue: "false" },
  traces: { from: "from_ts", to: "to_ts", pin: "live", pinValue: "false" },
  rum: { from: "start", to: "end", pin: "paused", pinValue: "true" },
};

/** Which params carry a view's window, and which one pins it to that window rather than to "now". */
export interface DdFreezeSpec {
  readonly from: string;
  readonly to: string;
  readonly pin: string;
  readonly pinValue: string;
}

/**
 * Every console view a CITATION may point at — the builder's three domains plus the metric explorer.
 *
 * ## Why this is wider than {@link DdLinkDomain}, and why it is not a second table
 *
 * This package BUILDS logs, traces and rum links and builds no metric-explorer link at all — that view takes
 * `exp_metric`/`exp_agg`/`exp_scope` rather than a `query`, so `ddConsoleLink`'s shape does not fit it and
 * widening the builder to cover it would mean a `query` param it must never emit. But an ANSWER cites metric
 * links constantly, and the one this repository has measured going wrong is a metric link. So the validator's
 * vocabulary is a strict superset of the builder's, spread from the builder's own tables below rather than
 * restated: the three shared rows cannot drift, because there is only one place they are written.
 *
 * The `metrics` freeze row is **documented, not measured** — `start`/`end`/`paused=true` is what the console
 * itself emits and what every metric citation in this install's own review records carries, but nobody has put
 * a generated one through a browser the way this file's header records for `traces`. Said plainly for the same
 * reason the `rum` row says it: the next person should know which rows have been measured and which have not.
 */
export type DdCitedView = DdLinkDomain | "metrics";

/** Console path per cited view. The three builder rows are spread, never restated — see {@link DdCitedView}. */
export const DD_CITED_VIEW_PATHS: Readonly<Record<DdCitedView, string>> = {
  ...DD_LINK_PATHS,
  metrics: "/metric/explorer",
};

/** Freeze params per cited view. The three builder rows are spread, never restated — see {@link DdCitedView}. */
export const DD_CITED_VIEW_FREEZE: Readonly<Record<DdCitedView, DdFreezeSpec>> = {
  ...DD_LINK_FREEZE,
  metrics: { from: "start", to: "end", pin: "paused", pinValue: "true" },
};

/**
 * The window params that freeze each domain's view. See the table in the file header — `logs` genuinely
 * needs a different set, and a total record makes that a fact of the type rather than a branch to forget.
 *
 * @param domain the console area
 * @param window the absolute window to pin
 * @returns the freeze params, already `&`-prefixed
 */
function freezeParams({ domain, window }: { domain: DdLinkDomain; window: AbsoluteWindow }): string {
  const spec = DD_LINK_FREEZE[domain];
  return `&${spec.from}=${String(window.fromMs)}&${spec.to}=${String(window.toMs)}&${spec.pin}=${spec.pinValue}`;
}

/**
 * Build a frozen console link.
 *
 * @param consoleHost the site's console host, from `DatadogConfig.consoleHost` — never hard-coded, since a
 *   literal host would be a second source of truth for which org the tool is talking to
 * @param domain which console area the link opens
 * @param query the Datadog query the claim was computed from
 * @param window the absolute window the claim was computed over
 * @param extraParams additional query-string params appended verbatim, or `null` for none
 * @returns the frozen console URL
 * @throws when `consoleHost` is not a Datadog console host, naming the right host when it is a derived dead one
 */
export function ddConsoleLink({
  consoleHost,
  domain,
  query,
  window,
  extraParams = null,
}: {
  consoleHost: DdConsoleHost;
  domain: DdLinkDomain;
  query: string;
  window: AbsoluteWindow;
  extraParams?: string | null;
}): string {
  if (!REAL_CONSOLE_HOSTS.has(consoleHost)) {
    const dead = invalidDatadogConsoleHosts({ text: consoleHost })[0];
    if (dead !== undefined) {
      throw new Error(`${consoleHost} is not a Datadog console host — the console is ${dead.correctHost}`);
    }
    throw new Error(
      `${consoleHost} is not a Datadog console host; expected one of ${[...REAL_CONSOLE_HOSTS].join(", ")}`,
    );
  }
  const encoded = encodeURIComponent(query.trim());
  const extra = extraParams === null || extraParams === "" ? "" : `&${extraParams}`;
  return `https://${consoleHost}${DD_LINK_PATHS[domain]}?query=${encoded}${freezeParams({ domain, window })}${extra}`;
}
