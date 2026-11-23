/**
 * `slopweaver atlas datadog sync [--live] [--json] [--home <dir>]` — publish the compiled catalogue, and
 * with `--live`, ask THIS organisation what it holds.
 *
 * ## Two acts under one verb, and why they are not two verbs
 *
 * Without `--live` this makes no network call and presents no credential. The subject is
 * `src/atlas/datadog/generated/surfaces.ts`, a registry committed to this repository and pinned by digest
 * and census in `generated/sdkLock.ts`, so it is local-state rather than external-read and publishes
 * identically on an installation holding no Datadog keys.
 *
 * `--live` runs that publish and then fills the `api` channel of the very entities it just made
 * (`src/atlas/datadog/syncApi.ts`). One verb rather than two because the second act is meaningless without
 * the first — the live pass REFUSES when no generation exists, since there would be nothing to merge onto —
 * and a caller who ran only the second would publish an atlas holding what answered today and nothing about
 * what Datadog offers, which reads as "no such endpoint" for every operation this organisation does not
 * serve.
 *
 * The flag's absence is the safe default on purpose: this verb is reached by every install, including ones
 * with no Datadog keys, and 329 requests against a metered tenant is something a caller should ask for.
 */
import { type DatadogSyncOutcome, syncDatadogCatalogue } from "../../../atlas/datadog/sync.js";
import { datadogApiCaller, datadogApiCensus, syncDatadogApi } from "../../../atlas/datadog/syncApi.js";
import type { DatadogApiSyncOutcome } from "../../../atlas/datadog/syncApiTypes.js";
import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import { createRawTransport } from "../../../datadog/rawTransport.js";
import { loadDatadogConfig } from "../../../datadog/source.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";

/** Where a Datadog atlas verb sits: past the runtime, the script, `atlas` and the `datadog` platform. */
const DATADOG_VERB_INDEX = 4;

/**
 * Exported so a test can assert this equals the manifest's own copy.
 * @internal
 */
export const DATADOG_SYNC_USAGE = "usage: slopweaver atlas datadog sync [--live] [--json] [--home <dir>]";

/** Parse the flag tail this verb accepts. */
function parseSyncOptions({
  rest,
}: {
  rest: readonly string[];
}): Result<{ home: string; json: boolean; live: boolean }> {
  const parsed = parseFlagTail({ rest, spec: { boolean: ["json", "live"], value: ["home"] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({
    home: resolveHome({ named: parsed.value.values["home"] }),
    json: parsed.value.flags.has("json"),
    live: parsed.value.flags.has("live"),
  });
}

/** Print what the sync published. */
function report({ asJson, outcome }: { asJson: boolean; outcome: DatadogSyncOutcome }): void {
  if (asJson) {
    logger.out({ line: JSON.stringify(outcome, null, 1) });
    return;
  }
  const counts = outcome.dispositionCounts;
  logger.out({
    line:
      `datadog compiled catalogue — ${String(outcome.operationCount)} operation(s) across ` +
      `${String(outcome.kindCount)} kind(s) from datadog-api-client ${outcome.sdkVersion}: ` +
      `${String(counts.entity)} entity, ${String(counts["shape-index"])} shape-index, ` +
      `${String(counts["probe-only"])} probe-only, ${String(counts.excluded)} excluded. ` +
      "The `api` and `console` channels remain unfilled and every kind's coverage says why",
  });
}

/** Print what the live pass reached, and what it did not. */
function reportLive({ asJson, outcome }: { asJson: boolean; outcome: DatadogApiSyncOutcome }): void {
  if (asJson) {
    logger.out({ line: JSON.stringify(outcome, null, 1) });
    return;
  }
  const census = datadogApiCensus();
  logger.out({
    line:
      `datadog api channel at ${outcome.scope} — ${String(outcome.answered)} of ` +
      `${String(outcome.attempted)} admitted operation(s) answered, ${String(outcome.failed)} did not, ` +
      `${String(outcome.firstPageOnly)} kept a first page only, ${String(outcome.specNamesOnly)} were ` +
      "admitted against the specification's names alone, every value unread. NOT reached: " +
      `${String(census.fanoutDeferred)} entity operation(s) that take an identifier and ` +
      `${String(census.shapeIndexDeferred)} shape-index operation(s) — each kind's \`api\` coverage cell ` +
      "and gap names which, and the `api` surface stays declared-unfilled until all four remainders close",
  });
  // Printed as its own line rather than folded above, because it answers a different question. Everything
  // above counts OPERATIONS; this counts the things this organisation actually has, which is what the
  // atlas was asked for and did not hold — `atlas/datadog/estateAcquisition.ts` carries the measurement.
  logger.out({
    line:
      `datadog estate at ${outcome.scope} — ${String(outcome.estateRecords)} of this organisation's own ` +
      "record(s) stored as entities of their own, across the kinds `estateAcquisition.ts` names. Read them " +
      "with `slopweaver atlas datadog read --kind monitor`; a count here is of STORED records and the " +
      "`api-first-page-only` gap says where a page was cut",
  });
}

/**
 * Run the live pass, which only ever follows a successful compiled publish.
 *
 * @param home the resolved state home
 * @param asJson whether to print the machine-readable document
 * @returns the process exit code
 */
async function runLive({ home, asJson }: { home: string; asJson: boolean }): Promise<number> {
  const config = loadDatadogConfig({ home });
  if (config.isErr()) {
    datadogConfigErrorLines({ error: config.error }).forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  const transport = createRawTransport({ config: config.value, logger });
  const synced = await syncDatadogApi({
    deps: {
      at: new Date().toISOString(),
      call: datadogApiCaller({ transport }),
      onProgress: ({ line }) => {
        logger.info({ msg: line });
      },
      scope: `${config.value.site} ${config.value.apiHost}`,
    },
    // The publish gate refuses a generation containing either key verbatim, wherever it appears. Handing it
    // the values this process actually holds is what makes that exact rather than a pattern guess — and
    // `store.ts` records why a hex-run rule would refuse most real generations instead.
    knownSecrets: [config.value.apiKey, config.value.appKey],
    home,
  });
  if (synced.isErr()) {
    synced.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  reportLive({ asJson, outcome: synced.value });
  return EXIT_OK;
}

/**
 * Run the Datadog compiled-catalogue sync, and with `--live` the pass that asks this organisation.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export async function datadogAtlasSyncCommand(argv: readonly string[]): Promise<number> {
  const rest = verbTail({ argv, at: DATADOG_VERB_INDEX, verbs: ["sync"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: DATADOG_SYNC_USAGE });
    return EXIT_OK;
  }
  const options = parseSyncOptions({ rest });
  if (options.isErr()) {
    options.error.forEach((line) => {
      logger.error({ msg: line });
    });
    logger.error({ msg: DATADOG_SYNC_USAGE });
    return EXIT_USAGE;
  }
  const { home, json: asJson, live } = options.value;
  const published = syncDatadogCatalogue({ at: new Date().toISOString(), home });
  if (published.isErr()) {
    published.error.forEach((line) => {
      logger.error({ msg: line });
    });
    return EXIT_ERROR;
  }
  report({ asJson, outcome: published.value });
  return live ? runLive({ asJson, home }) : EXIT_OK;
}
