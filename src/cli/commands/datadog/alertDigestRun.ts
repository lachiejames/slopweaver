/**
 * `datadog alert-digest` — run a declared probe set as read-only Datadog aggregates and emit the digest
 * form, so a scheduled alert card is composed from counts rather than from a model's recollection.
 *
 * This is the READ half of the three daily postings (Knock, growth-ops, integrity-audit) that stopped when
 * the private work console's `yarn work-console` script left the branch they ran from.
 * The write half is `slack post --as bot --form -`, unchanged and already doored; nothing here posts.
 *
 * ## Why it is `external-read` and routes no door request
 *
 * Every call it makes is a logs aggregate — the same classification `datadog probe` carries, and for the
 * same stated reason: there is no effect to route. The card reaching Slack is a separate verb with its own
 * door request, its own ledger row and its own voice check, which is what keeps a scheduled post
 * indistinguishable from a typed one.
 *
 * ## One window, every probe
 *
 * The window is resolved ONCE against one `nowMs` and handed to every probe and every link. A per-probe
 * window would make two rows of the same card describe two different spans of time while sharing one
 * header — the divergence `window.ts` exists to prevent, reproduced one layer up.
 *
 * ## The matrix and the trend are two more reads, and neither can cost the card
 *
 * After the readings, a firing logs probe is rerun grouped by service and divided by that service's own
 * total (`./impactMeasurementRun.ts`, shared with the alert summary), and every probe that counts toward the
 * trend is reread over the three windows before this one. Both are ESTIMATES feeding a ranking, so a failed read
 * leaves `impact ?` or no trend clause and a line on stderr — never an exit code. Only the readings the card
 * reports are all-or-nothing.
 *
 * ## A probe's citation is a phrase match, and the card says so
 *
 * These checks watch a throw site's own log line, because no facet carries "this catch fired". So the
 * links are built with `allowPhraseMatch: true` (`citation.ts` documents the conditional) and the run
 * reports the drift cost as residue rather than letting a reader infer that a zero is good news.
 */
import {
  type AlertProbe,
  type AlertProbeReading,
  type AlertProbeSet,
  isCardCount,
} from "../../../datadog/alertProbe.js";
import { alertProbeCitationUrl } from "../../../datadog/alertProbeCitation.js";
import { AlertProbeErrors } from "../../../datadog/alertProbeErrors.js";
import { validateCitation } from "../../../datadog/citation.js";
import { datadogCitationErrorLines } from "../../../datadog/citationErrors.js";
import { createDatadogClient, type DatadogClient } from "../../../datadog/client.js";
import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import { datadogDomainErrorLines } from "../../../datadog/domainErrors.js";
import { type DatadogConfig, loadDatadogConfig } from "../../../datadog/source.js";
import { verifyCredentials } from "../../../datadog/verifyCredentials.js";
import { type AbsoluteWindow, resolveWindow } from "../../../datadog/window.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { resolveRecommendationSet } from "../../../live/automation/recommendationDocument.js";
import {
  type RecommendationSetError,
  recommendationSelectionLines,
} from "../../../live/automation/recommendationSet.js";
import type { RecommendationAuthored } from "../../../outbound/artifact/recommendations.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { refuseRunnerOnStandingRuling } from "../../rulingGateDoor.js";

import {
  ALERT_DIGEST_RESIDUE,
  alertDigestLines,
  buildAlertDigestForm,
  type DatadogAlertDigestOptions,
  datadogAlertDigestReport,
  parseDatadogAlertDigestArgs,
} from "./alertDigestCore.js";
import { type DigestEnrichment, measureProbe, readEnrichment } from "./alertDigestMeasure.js";
import { resolveProbeSet } from "./alertDigestProbeSet.js";
import { datadogArgsErrorLines } from "./errors.js";
import { DATADOG_ALERT_DIGEST_USAGE } from "./usage.js";

/**
 * Take ONE probe's measurement and freeze the link it was computed from.
 *
 * @param client the shared client
 * @param probe the declared check
 * @param window the absolute window every probe in this run shares
 * @param config the resolved Datadog configuration, for the console host the link must point at
 * @returns the reading, or why this probe could not be measured or cited
 */
async function runOneProbe({
  client,
  probe,
  window,
  config,
}: {
  client: DatadogClient;
  probe: AlertProbe;
  window: AbsoluteWindow;
  config: DatadogConfig;
}): Promise<Result<AlertProbeReading>> {
  const measured = await measureProbe({ client, probe, window });
  if (measured.isErr()) {
    return err(measured.error.map((line) => `probe '${probe.id}': ${line}`));
  }
  // A digest row's count is a whole number of things — `digestFields.ts` bounds it as a safe integer. A logs
  // aggregate over a facet, and a metric sum over a non-count aggregation, can both return a fraction, and
  // such a reading would build a form the door then REFUSES: the card would be lost at the unattended hour
  // with a Zod error nobody could act on. Refused HERE instead, naming the probe and the value it returned.
  if (!isCardCount({ value: measured.value })) {
    return err([AlertProbeErrors.readingNotCountable({ probeId: probe.id, value: measured.value }).message]);
  }
  const cited = alertProbeCitationUrl({ consoleHost: config.consoleHost, probe, window });
  if (cited.isErr()) {
    return err(cited.error);
  }
  const citationUrl = cited.value.url;
  const checked = validateCitation({
    expectation: {
      allowPhraseMatch: true,
      consoleHost: config.consoleHost,
      domain: cited.value.domain,
      label: `probe '${probe.id}' citation`,
      requireProdEnv: false,
    },
    url: citationUrl,
  });
  if (checked.isErr()) {
    return err(datadogCitationErrorLines({ error: checked.error }));
  }
  return ok({ citationUrl, probe, value: measured.value });
}

/**
 * This verb's edges.
 *
 * `writeOut` is a seam for the same reason `slack alert-summary`'s is: `automation run-due` composes this read
 * with the door-routed post, and the form has to reach the second leg as a VALUE. Routing it through the
 * dispatcher would write it to the process's own file descriptor, recoverable only from a pipe or a file.
 */
export interface DatadogAlertDigestDeps {
  readonly nowMs: () => number;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The real edges.
 *
 * @returns the production dependencies, writing to this process's own channels
 * @internal
 */
export function productionDatadogAlertDigestDeps(): DatadogAlertDigestDeps {
  return {
    nowMs: () => Date.now(),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * Emit whatever the caller asked for: the bare form, the whole document, or a readable report.
 *
 * `--form` writes the whole document in ONE call, which is what lets `automation run-due` treat "exactly one
 * line on stdout" as its integrity check on the form it is about to post.
 *
 * @param deps the injected edges
 * @param options the parsed invocation
 * @param readings every reading the run took
 * @param window the absolute window every probe shared
 * @param recommendations the row's authored recommendation set, already checked against its probe ids
 * @param enrichment the measured impacts and baseline, and why any of them is missing
 * @returns nothing; it writes to the data channel
 */
function emit({
  deps,
  options,
  readings,
  window,
  recommendations,
  enrichment,
}: {
  deps: DatadogAlertDigestDeps;
  options: DatadogAlertDigestOptions;
  readings: readonly AlertProbeReading[];
  window: AbsoluteWindow;
  recommendations: readonly RecommendationAuthored[];
  enrichment: DigestEnrichment;
}): void {
  const built = buildAlertDigestForm({
    impacts: enrichment.impacts,
    intro: options.intro,
    label: options.label,
    lead: options.lead,
    readings,
    recommendations,
    trend: enrichment.trend,
    window: options.window,
  });
  // Why an item reads `impact ?`, why the TL;DR carries no trend clause, and a dropped `--lead` are all stated on
  // the DIAGNOSTIC channel, never on the data one: `--form`'s contract with `automation run-due` is exactly one
  // line of stdout, and a warning there would look like a second document.
  for (const line of [...enrichment.warnings, ...built.warnings]) {
    deps.writeDiagnostic(line);
  }
  const { form } = built;
  if (options.output === "form") {
    deps.writeOut(safeJsonStringify({ label: "alert-digest form", value: form }));
    return;
  }
  if (options.output === "json") {
    const report = datadogAlertDigestReport({
      form,
      fromMs: window.fromMs,
      options,
      readings,
      recommendations: built.recommendations,
      residue: ALERT_DIGEST_RESIDUE,
      toMs: window.toMs,
    });
    deps.writeOut(safeJsonStringify({ label: "alert-digest report", value: report }));
    return;
  }
  for (const line of alertDigestLines({ channelHint: undefined, options, readings })) {
    deps.writeOut(line);
  }
  for (const line of recommendationSelectionLines({ selection: built.recommendations })) {
    deps.writeOut(line);
  }
  for (const line of ALERT_DIGEST_RESIDUE) {
    deps.writeOut(`  not proved: ${line}`);
  }
}

/**
 * Run the verb over its own flag tail, against injected edges.
 *
 * Exported separately from the argv wrapper so `automation run-due` can collect the form instead of writing it
 * to a file descriptor — the same code path with one edge swapped, exactly as `slack alert-summary` is
 * composed into the same tick.
 *
 * **Every CALLER MISTAKE is decided before the environment is read, and that order is the contract.** A row
 * whose probe set or window token is wrong should say so wherever it runs, including on a machine holding
 * no Datadog credential at all. MEASURED: with the two the other way round, this verb answered
 * a bad `--window` with the config's own "DD_API_KEY is not set" in CI and with the window refusal on a
 * developer's machine — so its own test passed locally and failed in CI. A refusal that depends on the
 * environment is a refusal that names the wrong thing.
 *
 * @param rest the argv tail after `datadog alert-digest`
 * @param deps the injected edges
 * @returns the process exit code
 */
export async function runDatadogAlertDigestWith({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: DatadogAlertDigestDeps;
}): Promise<number> {
  const gated = refuseRunnerOnStandingRuling({ noun: "datadog", rest, verb: "alert-digest" });
  if (gated !== undefined) {
    return gated;
  }
  const report = ({ errors }: { errors: readonly string[] }): void => {
    for (const line of errors) {
      deps.writeDiagnostic(line);
    }
  };
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(DATADOG_ALERT_DIGEST_USAGE);
    return EXIT_OK;
  }
  const parsed = parseDatadogAlertDigestArgs({ rest });
  if (parsed.isErr()) {
    report({ errors: [...datadogArgsErrorLines({ error: parsed.error }), DATADOG_ALERT_DIGEST_USAGE] });
    return EXIT_USAGE;
  }
  const options = parsed.value;

  const configured = await resolveDigestInputs({ nowMs: deps.nowMs(), options });
  if (configured.isErr()) {
    report({ errors: configured.error });
    return EXIT_USAGE;
  }
  const { set, recommendations, window } = configured.value;

  const connected = await connectDatadog();
  if (connected.isErr()) {
    report({ errors: connected.error });
    return EXIT_ERROR;
  }
  const { client, config } = connected.value;

  const readings = await takeEveryReading({ client, config, set, window });
  if (readings.isErr()) {
    report({ errors: readings.error });
    return EXIT_ERROR;
  }

  const enrichment = await readEnrichment({ client, config, readings: readings.value, set, window });
  emit({
    deps,
    enrichment,
    options,
    readings: readings.value,
    recommendations,
    window,
  });
  return EXIT_OK;
}

/**
 * Take every probe's reading, in declaration order, and stop at the first that could not be taken.
 *
 * Sequential on purpose: these run on a shared rate-limit budget beside every other scheduled Datadog read,
 * and a fan-out that trips the budget turns a quiet card into a run that reports nothing.
 *
 * Stopping rather than reporting a partial set is the same reasoning. A card missing one row does not look
 * like a card missing one row — it looks like a check that found nothing, which is the failure mode every
 * other decision in this module is built against.
 *
 * @param client the shared client
 * @param config the resolved Datadog configuration
 * @param set the parsed probe set
 * @param window the absolute window every probe shares
 * @returns every reading, or the first probe's reason for not producing one
 */
async function takeEveryReading({
  client,
  config,
  set,
  window,
}: {
  client: DatadogClient;
  config: DatadogConfig;
  set: AlertProbeSet;
  window: AbsoluteWindow;
}): Promise<Result<readonly AlertProbeReading[]>> {
  const readings: AlertProbeReading[] = [];
  for (const probe of set.probes) {
    // eslint-disable-next-line no-await-in-loop -- the shared rate-limit budget; see this function's header
    const reading = await runOneProbe({ client, config, probe, window });
    if (reading.isErr()) {
      return err(reading.error);
    }
    readings.push(reading.value);
  }
  return ok(readings);
}

/**
 * Read the `--recommendations` value, when there is one.
 *
 * Only the DOCUMENT is refused here — unreadable, or not a recommendation set. A `clears` naming no declared
 * probe is NOT refused: it is dropped by the selection as `clears-unknown` and reported, because refusing it
 * would cost the whole card at the unattended hour over one mistyped key (adversarial review).
 *
 * @param value the flag's value, when it was passed
 * @returns the authored recommendations (none when the flag was absent), or why the document is unusable
 */
async function resolveDigestRecommendations({
  value,
}: {
  value: string | undefined;
}): Promise<Result<readonly RecommendationAuthored[], RecommendationSetError>> {
  if (value === undefined) {
    return ok([]);
  }
  const set = await resolveRecommendationSet({ value });
  return set.map((resolved) => resolved.recommendations);
}

/**
 * Everything a run decides from its own arguments, before a Datadog client exists: the probe set, the
 * recommendation lane and the absolute window.
 *
 * One function because the three share one exit code — each is a caller mistake in the same document or
 * command, and the operator fixes them in the same place.
 *
 * @param options the parsed invocation
 * @param nowMs the run's own clock reading, which the window is resolved against
 * @returns the probe set, the authored recommendations and the window, or every reason there is not one
 */
async function resolveDigestInputs({ options, nowMs }: { options: DatadogAlertDigestOptions; nowMs: number }): Promise<
  Result<{
    set: AlertProbeSet;
    recommendations: readonly RecommendationAuthored[];
    window: AbsoluteWindow;
  }>
> {
  const set = await resolveProbeSet({ value: options.probes });
  if (set.isErr()) {
    return err(set.error);
  }
  const recommendations = await resolveDigestRecommendations({ value: options.recommendations });
  if (recommendations.isErr()) {
    return err([recommendations.error.message]);
  }
  const window = resolveWindow({ from: options.window, nowMs, to: "now" });
  if (window.isErr()) {
    return err(datadogDomainErrorLines({ error: window.error }));
  }
  return ok({ recommendations: recommendations.value, set: set.value, window: window.value });
}

/**
 * Resolve the Datadog configuration and prove the credentials answer, before any probe is measured.
 *
 * @returns the client and the configuration behind it, or why neither could be had
 */
async function connectDatadog(): Promise<Result<{ client: DatadogClient; config: DatadogConfig }>> {
  const config = loadDatadogConfig({});
  if (config.isErr()) {
    return err(datadogConfigErrorLines({ error: config.error }));
  }
  const client = createDatadogClient({ config: config.value, logger });
  const verified = await verifyCredentials({ client });
  return verified.map(() => ({ client, config: config.value })).mapErr((error) => datadogConfigErrorLines({ error }));
}

/**
 * Run the `datadog alert-digest` verb.
 *
 * @param argv the full process argv (verb tail starts at index 3)
 * @returns the process exit code
 */
export async function runDatadogAlertDigest(argv: readonly string[]): Promise<number> {
  return runDatadogAlertDigestWith({
    deps: productionDatadogAlertDigestDeps(),
    rest: verbTail({ argv, verbs: ["alert-digest"] }),
  });
}

export const datadogAlertDigestCommand = defineCommand({ run: runDatadogAlertDigest });
