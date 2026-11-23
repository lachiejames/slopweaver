/**
 * `slopweaver datadog probe [--query Q] [--from 15m] [--to now] [--prod-env] [--sum-metric ATTR]
 * [--verify-env] [--json]` — does the Datadog foundation actually work, against real Datadog?
 *
 * One thin verb over the whole stack: resolve credentials, verify them, resolve a window, run one real
 * query, and print the number beside a frozen — and independently VALIDATED — console link that reproduces
 * it. It is the proof that the plumbing works, which a unit test over a faked client cannot give, and it is
 * deliberately not a full query surface: aggregation, group-bys and the high-cardinality guard belong to a
 * caller's own investigation logic, built on `groupedAggregate.ts`/`counting.ts`/`envFacetGuard.ts`
 * directly (or `datadog metrics` for the metrics-scalar equivalent of this verb).
 *
 * `--sum-metric ATTR` switches the number from a plain logs count (`logsCount`) to the sum of a numeric log
 * attribute (`logsSum`) over the same query and window. `--verify-env` re-checks the matched events' real
 * `env` facet via `verifyEnvScope` before reporting — a secondary check that never changes the exit code on
 * its own, since it only makes sense to run alongside `--prod-env`.
 *
 * ## The exit-code contract, which is the point of the verb
 *
 * The failure this verb is built to make impossible is **an empty result reported as success**. If a verb
 * cannot tell "Datadog returned nothing" from "the query never reached Datadog", every number it prints is
 * worthless. So the two are separate codes:
 *
 * | situation                                              | code | why |
 * | ------------------------------------------------------ | ---- | --- |
 * | a bad flag                                              | `2`  | refused before the act phase |
 * | credentials unset, malformed, or rejected by Datadog    | `3`  | a prerequisite is absent |
 * | Datadog answered, and the honest answer is zero         | `3`  | ran the full pipeline, legitimate non-success status |
 * | Datadog answered with a non-zero number                 | `0`  | the only success |
 * | Datadog was never reached, answered unreadably, or the citation link this verb built failed its own validator | `1`  | a genuine fault |
 *
 * A zero and absent credentials share code `3` because both are "a prerequisite for a useful answer is
 * missing" and both must fail a `probe || alert` gate. They are still told apart without reading prose: the
 * JSON output carries an `outcome` discriminant, and the text output says which happened.
 *
 * Note what is NOT here: no branch returns `0` on an empty result, and no branch turns an unreadable
 * response into a zero. `logsCount`'s `readTotalCount` returns a `Result` precisely so that this file has
 * nothing to coerce.
 *
 * ## On the default window
 *
 * `--from` defaults to `15m`. The window is resolved once against a single `now`, printed in the output,
 * and encoded in the link, so the default is visible in every result it produced — never a silent lookback
 * baked into the link builder.
 *
 * ## Why the emitted link is validated, not just built
 *
 * `ddLink.ts` builds a well-formed link by construction, but this package's own doctrine is that a citation
 * is checked rather than claimed (see `citation.ts`). Running the freshly built link back through
 * `validateCitation` before printing is cheap self-defence: if the builder and the validator ever disagree
 * about what "frozen" means, this verb is where that surfaces, rather than a reader's dead click.
 */
import { validateCitation } from "../../../datadog/citation.js";
import { datadogCitationErrorLines } from "../../../datadog/citationErrors.js";
import { createDatadogClient, type DatadogClient } from "../../../datadog/client.js";
import type { DatadogConfig } from "../../../datadog/config.js";
import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import { ddConsoleLink } from "../../../datadog/ddLink.js";
import { type EnvFacetVerdict, verifyEnvScope } from "../../../datadog/envFacetGuard.js";
import { logsCount, logsSum } from "../../../datadog/logsCount.js";
import { prodEnvFilter } from "../../../datadog/prodEnvFilter.js";
import { datadogQueryErrorLines } from "../../../datadog/queryErrors.js";
import { describeRateLimit } from "../../../datadog/rateLimit.js";
import { verifyCredentials } from "../../../datadog/verifyCredentials.js";
import type { AbsoluteWindow } from "../../../datadog/window.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { buildProbeQuery, parseDatadogProbeOptions } from "./core.js";
import { resolveDatadogPreflight } from "./shell.js";

/**
 * Exported so a test can assert this equals the manifest's own copy — the manifest cannot import it
 * directly without eagerly loading this module's Datadog-client dependency for every CLI invocation, not
 * just this verb's.
 */
export const DATADOG_PROBE_USAGE =
  "usage: slopweaver datadog probe [--query Q] [--from 15m] [--to now] [--prod-env] [--sum-metric ATTR] [--verify-env] [--json]";

/** What the probe established. `outcome` is the machine-readable discriminant — see the file header. */
export interface ProbeReport {
  readonly outcome: "matched" | "empty";
  readonly site: string;
  readonly query: string;
  /** The attribute `--sum-metric` summed, or `null` when this probe counted logs instead. */
  readonly metric: string | null;
  readonly count: number;
  readonly fromMs: number;
  readonly toMs: number;
  readonly link: string;
  /** The rate-limit budget the query ran against, or `null` on an unmetered endpoint. */
  readonly rateLimit: string | null;
  /** `--verify-env`'s re-check of the matched events' real `env` facet, or `null` when not requested. */
  readonly envVerdict: EnvFacetVerdict | null;
}

/**
 * The exit code a count earns.
 *
 * Extracted so the contract in the file header is pinned by a test directly, rather than only through a
 * run whose result depends on whatever the org's log volume happens to be that minute.
 *
 * @param count the number Datadog reported
 * @returns `0` for a real result, `3` for an honest zero
 */
export function exitCodeForProbeCount({ count }: { count: number }): number {
  return count > 0 ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/**
 * The human view: what was asked, what came back, and the link that reproduces it.
 *
 * @param report what the probe established
 * @returns the rendered report
 */
export function renderProbeText({ report }: { report: ProbeReport }): string {
  const noun = report.metric === null ? "logs matched" : `summed over '${report.metric}'`;
  const verdict =
    report.outcome === "matched"
      ? `Datadog answered: ${String(report.count)} ${noun}`
      : `Datadog answered, and the ${report.metric === null ? "count" : "sum"} is 0 — the query reached Datadog and nothing matched`;
  const lines = [
    `datadog probe: ${verdict}`,
    "",
    `site    ${report.site}`,
    `query   ${report.query}`,
    `window  ${new Date(report.fromMs).toISOString()} → ${new Date(report.toMs).toISOString()}`,
    `count   ${String(report.count)}`,
    `link    ${report.link}`,
  ];
  if (report.rateLimit !== null) {
    lines.push(`limit   ${report.rateLimit}`);
  }
  if (report.envVerdict !== null) {
    lines.push(
      `env     ${report.envVerdict.verdict} (${String(report.envVerdict.prod)} prod / ${String(report.envVerdict.total)} total)`,
    );
  }
  return lines.join("\n");
}

/**
 * The machine view. The same facts, with `outcome` first so a consumer branches on one field.
 *
 * @param report what the probe established
 * @returns the pretty-printed JSON object
 */
export function renderProbeJson({ report }: { report: ProbeReport }): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Log every reason in a rejection, one line each.
 *
 * @param errors every reason a step failed
 */
function reportErrors({ errors }: { errors: readonly string[] }): void {
  errors.forEach((error) => {
    logger.error({ msg: error });
  });
}

/**
 * Build the frozen console link for this probe and validate it before it ships as evidence — see the file
 * header for why a link this package built itself is still run back through `validateCitation`.
 *
 * @param config the validated Datadog configuration
 * @param query the query the count was computed from
 * @param window the absolute window the count was computed over
 * @param prodEnv whether `--prod-env` was passed, so the link's env gate is checked to match
 * @returns the validated link, or every reason it failed its own validator
 */
function buildValidatedProbeLink({
  config,
  query,
  window,
  prodEnv,
}: {
  config: DatadogConfig;
  query: string;
  window: AbsoluteWindow;
  prodEnv: boolean;
}): Result<string> {
  const link = ddConsoleLink({ consoleHost: config.consoleHost, domain: "logs", query, window, extraParams: null });
  const checked = validateCitation({
    url: link,
    // `allowPhraseMatch: false` because this verb's query is whatever the caller typed — an improvised
    // phrase match is exactly the case `citation.ts`'s rule was written for. A DECLARED alert probe says
    // otherwise; an ad-hoc probe never does.
    expectation: {
      allowPhraseMatch: false,
      consoleHost: config.consoleHost,
      domain: "logs",
      label: "probe link",
      requireProdEnv: prodEnv,
    },
  });
  if (checked.isErr()) {
    return err(datadogCitationErrorLines({ error: checked.error }));
  }
  return ok(link);
}

/**
 * Count the matched logs, or sum `--sum-metric` over them — whichever this probe was asked for.
 *
 * @param client the shared client
 * @param query the query to run
 * @param window the absolute window, already resolved
 * @param sumMetric the attribute to sum, or `null` to count matched logs instead
 * @returns the number, or why it could not be obtained
 */
async function countOrSumMetric({
  client,
  query,
  window,
  sumMetric,
}: {
  client: DatadogClient;
  query: string;
  window: AbsoluteWindow;
  sumMetric: string | null;
}): Promise<Result<number>> {
  if (sumMetric === null) {
    const counted = await logsCount({ client, query, window });
    return counted.isErr() ? err(datadogQueryErrorLines({ error: counted.error })) : ok(counted.value.count);
  }
  const summed = await logsSum({ client, query, metric: sumMetric, window });
  return summed.isErr() ? err(datadogQueryErrorLines({ error: summed.error })) : ok(summed.value.sum);
}

/**
 * Re-check the matched events' real `env` facet when `--verify-env` was passed. A failure here is logged
 * but never changes the probe's own exit code — it is a secondary check on a result already established.
 *
 * @param client the shared client
 * @param query the query the probe ran
 * @param window the absolute window, already resolved
 * @param verifyEnv whether `--verify-env` was passed
 * @returns the verdict, or `null` when not requested or when the re-check itself failed
 */
async function maybeVerifyEnv({
  client,
  query,
  window,
  verifyEnv,
}: {
  client: DatadogClient;
  query: string;
  window: AbsoluteWindow;
  verifyEnv: boolean;
}): Promise<EnvFacetVerdict | null> {
  if (!verifyEnv) {
    return null;
  }
  const verdict = await verifyEnvScope({ client, query, window });
  if (verdict.isErr()) {
    reportErrors({ errors: datadogQueryErrorLines({ error: verdict.error }) });
    return null;
  }
  return verdict.value;
}

/**
 * Run the `datadog probe` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runDatadogProbe(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, verbs: ["probe"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DATADOG_PROBE_USAGE });
    return EXIT_OK;
  }
  const preflight = resolveDatadogPreflight({ parseFlags: parseDatadogProbeOptions, rest, usage: DATADOG_PROBE_USAGE });
  if (preflight.isErr()) {
    reportErrors({ errors: preflight.error.errors });
    return preflight.error.code;
  }
  const { flags, config, window } = preflight.value;

  const client = createDatadogClient({ config, logger });
  const verified = await verifyCredentials({ client });
  if (verified.isErr()) {
    reportErrors({ errors: datadogConfigErrorLines({ error: verified.error }) });
    return EXIT_EXPECTED_EMPTY;
  }

  const query = buildProbeQuery({ query: flags.query, prodEnv: flags.prodEnv, prodEnvFilterFragment: prodEnvFilter() });
  const counted = await countOrSumMetric({ client, query, window, sumMetric: flags.sumMetric });
  if (counted.isErr()) {
    // A fault, not an empty result: the query did not come back with a number that could be believed.
    reportErrors({ errors: counted.error });
    return EXIT_ERROR;
  }

  const link = buildValidatedProbeLink({ config, query, window, prodEnv: flags.prodEnv });
  if (link.isErr()) {
    reportErrors({ errors: link.error });
    return EXIT_ERROR;
  }

  const envVerdict = await maybeVerifyEnv({ client, query, window, verifyEnv: flags.verifyEnv });
  const snapshot = client.lastRateLimit();
  const report: ProbeReport = {
    outcome: counted.value > 0 ? "matched" : "empty",
    site: config.site,
    query,
    metric: flags.sumMetric,
    count: counted.value,
    fromMs: window.fromMs,
    toMs: window.toMs,
    link: link.value,
    rateLimit: snapshot === null ? null : describeRateLimit({ snapshot }),
    envVerdict,
  };
  logger.out({ line: flags.json ? renderProbeJson({ report }) : renderProbeText({ report }) });
  return exitCodeForProbeCount({ count: report.count });
}

export const datadogProbeCommand = defineCommand({ run: runDatadogProbe });
