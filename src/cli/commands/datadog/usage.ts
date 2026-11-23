/**
 * The usage lines of `slopweaver datadog alert-digest`, `catalogue`, `investigate`, `produce` and `shot`, with the defaults they
 * quote, and nothing else.
 *
 * A LEAF on purpose: `cli/manifests/datadog.ts` reads these strings on EVERY invocation, because `--help`, `catalog`
 * and `discoverCommands` enumerate the manifest barrel whether or not one of these verbs runs. Kept in a command
 * module, a string would put that module and everything it imports on every invocation's load path. The command modules
 * import these from here, never the reverse. Import only other leaves:
 * `src/__tests__/unit/cli/manifestBarrelClosure.test.ts` fails on anything else.
 */

import { type InvestigateProduct, investigateSpec } from "../../../datadog/investigate/spec.js";

/**
 * The window used when the caller names none.
 *
 * A day, because that is the cadence these postings run on: a daily card over a 24h window reports every
 * event exactly once, and any other default would either double-count or leave a hole between runs.
 */
export const DEFAULT_ALERT_DIGEST_WINDOW = "24h";

/** The usage line, shared by `--help` and the manifest so the two cannot drift. */
export const DATADOG_ALERT_DIGEST_USAGE =
  "usage: slopweaver datadog alert-digest --probes <json|-> --label <text> [--window 24h]\n" +
  "                                      [--lead <text>] [--intro <json>] [--recommendations <json|->]\n" +
  "                                      [--form] [--json]\n" +
  "  Runs every declared probe as a read-only Datadog aggregate and emits a digest FORM.\n" +
  '  --probes    the probe set: a JSON document {"probes":[…]}, a path to one, or - for stdin\n' +
  "  --label     the card's subject, e.g. the monitored surface's own name\n" +
  `  --window    how far back each probe counts: 90m, 24h, 7d, 2w (default ${DEFAULT_ALERT_DIGEST_WINDOW})\n` +
  "  --lead      one sentence YOU compose after seeing the counted rows\n" +
  "  --intro     a JSON array of 1-4 day-one lines to open the card with, on a scheduled row's first firing\n" +
  '  --recommendations  {"recommendations":[…]}, a path to one, or - : the act that clears each firing probe\n' +
  "              (its `clears` names a probe id) and opportunities nothing alerted on, shown below the fold\n" +
  "  --form      emit ONLY the form JSON, so it can be piped straight into `slack post`\n" +
  "  --json      emit one machine-readable document: the form plus every reading behind it\n" +
  "  Nothing here posts anything and nothing here runs a model. Every count is a Datadog aggregate and\n" +
  "  every severity is arithmetic: a probe's declared severity when it fired, green when it counted zero.\n" +
  "  Each firing logs probe is also measured for its share of its service's events, and every counting probe\n" +
  "  is reread over the three windows before this one, so the card ranks by the P0-P4 priority matrix and\n" +
  "  its TL;DR says how this window compares. Either read failing leaves impact ? or no trend, never no card.";

/** `slopweaver datadog catalogue`'s usage line. */
export const CATALOGUE_USAGE =
  "usage: slopweaver datadog catalogue build [--from 7d] [--to now] [--product <p,...>] [--home <dir>] [--json]\n" +
  "       slopweaver datadog catalogue show [--service <s>] [--product <p>] [--query <text>] [--limit <n>] [--home <dir>] [--json]";

/**
 * The usage line for one product's verb.
 *
 * @param product which verb
 * @returns the usage, naming that product's own default facets
 */
export function investigateUsage({ product }: { product: InvestigateProduct }): string {
  const spec = investigateSpec({ product });
  return (
    `usage: slopweaver datadog ${product} [<query>] [--from 1h] [--to now] [--by f1,f2] [--not clause,clause] [--rows <n>] [--home <dir>] [--json]\n` +
    `  ${spec.meaning}. Reported counts first, a sampled one labelled as a lower bound; --rows prints events,\n` +
    `  --not cuts noise out of the count.\n` +
    `  default grouping: ${spec.defaultFacets.join(", ")}`
  );
}

/** `slopweaver datadog errors`'s usage line. */
export const DATADOG_ERRORS_USAGE =
  "usage: slopweaver datadog errors [--query Q] [--from 1d] [--to now] [--track trace|logs|rum] " +
  "[--order count|newest] [--state for-review,reviewed,ignored,resolved,excluded] [--limit 25] [--json]";

/** `slopweaver datadog triage`'s usage line. */
export const DATADOG_TRIAGE_USAGE =
  "usage: slopweaver datadog triage --issue ID[,ID...] --state reviewed|ignored|resolved|for-review " +
  "[--dry-run] [--home DIR] [--json]";

/** `slopweaver datadog shot`'s usage line. */
export const DATADOG_SHOT_USAGE =
  "usage: slopweaver datadog shot <monitor|explorer|file> [--id <n>] [--url <url>] [--metric <name>]\n" +
  "         [--scope <s>] [--group <tag>] [--agg sum] [--from 1h] [--to now] [--out <dir>]\n" +
  "         [--image <png>] [--preview-url <url>,...] [--json]\n" +
  "  monitor        capture one monitor's 7-day backtest panel in YOUR signed-in Chrome through the relay:\n" +
  "                 set the backtest to Past 1 Week, box the Alert count, photograph the panel column, prove\n" +
  "                 the window from the evaluation-preview calls, then grade and file the PNG. It clicks the\n" +
  "                 time picker and its preset only — it never saves, types or changes the monitor\n" +
  "  explorer       print how to capture a metric, log or notebook view — either an address you already\n" +
  "                 have (--url), which is one `browser shot` command, or one seeded from --metric/--scope/\n" +
  "                 --group/--from/--to, whose rendered state the brief tells you to read back\n" +
  "  file           grade the PNG that came back and file it. A capture is graded before it is reported,\n" +
  "                 and a failed grade throws the bytes away rather than warning about them\n" +
  "  --id <n>       monitor only: the monitor id, which must already exist. This verb never deploys one\n" +
  "  --url <url>    explorer only: an address on the configured site's console host. The mode to use for a\n" +
  "                 Metrics Explorer view, whose query and group-by live in an opaque URL fragment\n" +
  "  --metric <n>   explorer only: seed a Metrics Explorer view on this metric\n" +
  "  --scope <s>    explorer only: the scope the seeded view must render, e.g. env:staging\n" +
  "  --group <tag>  explorer only: the tag the seeded view must group by, e.g. instrumentation_scope\n" +
  "  --agg <a>      explorer only: the space aggregation to seed (default sum)\n" +
  "  --from/--to    explorer only: the window to pin the seeded view to (default from 1h, to now)\n" +
  "  --out <dir>    where the graded PNG is written (default $SLOPWEAVER_HOME/datadog-shots)\n" +
  "  --image <png>  file only: the capture to grade\n" +
  "  --preview-url  file only: comma-separated evaluation-preview URLs the console issued, which is what\n" +
  "                 PROVES the window on screen. Omitted, the window rests on the picker's own value\n" +
  "  --json         print the result as JSON";

/** `slopweaver datadog produce`'s usage line. */
export const DATADOG_PRODUCE_USAGE =
  "usage: slopweaver datadog produce --producer NAME --day YYYY-MM-DD --out FILE [--home DIR] [--json]";
