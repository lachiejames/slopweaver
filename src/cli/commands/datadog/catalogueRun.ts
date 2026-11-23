/**
 * `slopweaver datadog catalogue build | show` — the Datadog census, built and read.
 *
 * ## What this verb is FOR
 *
 * An organisation's Datadog can write more log lines in a day than the whole local store holds, into an index
 * that keeps about fifteen days. Storing the events would multiply the store many times over each fortnight,
 * so the events are never stored — the SHAPES are. A shape is a log pattern, a span kind, a RUM event type, a CI pipeline, a test
 * suite, a database query signature, a profile family or a metric: what it looks like (attribute paths,
 * types, template, allowlisted facet values), what sits under it, how big it is over the window, and the
 * query that reproduces it.
 *
 * A detective reads the census LOCALLY to decide whether Datadog can answer a question at all, and only then
 * runs a live verb. That gate is the join the whole design turns on, and this verb is what fills the local
 * half of it.
 *
 * ## There is no cell ceiling, by design
 *
 * The first version sampled cells under a budget and reported what it deferred. They rejected the question:
 * every service is in scope, every shape is in scope, and a budget "up to about 10 gigabytes" is fine. So
 * this pass counts every shape with the product's own aggregate and fetches one exemplar page each. The only
 * ceilings left are Datadog's — 10,000 groups per request, about fifteen days of retention — and each is
 * stated in `notMeasured` rather than chosen here.
 *
 * ## `build` is a read of Datadog and a write of the home, and neither is doored
 *
 * Every call it makes is a GET or an allowlisted read-only aggregate, the same classification
 * `datadog probe` and `datadog metrics` carry. What it writes is under `$SLOPWEAVER_HOME`, which is the
 * product working normally rather than an external write — `datadog shot`'s own PNG is classified the same
 * way. So `effect: "external-read"` and `doorRouted: false`, and there is no door token to hold.
 *
 * ## Every environment, and there is no flag that narrows it
 *
 * Logs are read from all environments: prod is a fine start, but staging or other kinds of logs sometimes need checking,
 * and pre-existing bugs mean some logs carry the wrong env key or none.
 * So every aggregate carries no `env:` clause at all, and the
 * environments a row names are the ones its own events reported.
 */

import { buildCensus } from "../../../datadog/census/build.js";
import { createDatadogClient } from "../../../datadog/client.js";
import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import { readCatalogue, writeCatalogue } from "../../../datadog/detective/store.js";
import { datadogDomainErrorLines } from "../../../datadog/domainErrors.js";
import { describeRateLimit, RATE_LIMIT_MAX_RETRIES } from "../../../datadog/rateLimit.js";
import { createRawRequester } from "../../../datadog/rawRequest.js";
import { loadDatadogConfig } from "../../../datadog/source.js";
import { resolveWindow } from "../../../datadog/window.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import {
  buildLines,
  type CatalogueBuildArgs,
  type CatalogueShowArgs,
  parseCatalogueArgs,
  selectRows,
  showLines,
} from "./catalogueCore.js";
import { datadogArgsErrorLines } from "./errors.js";
import { CATALOGUE_USAGE } from "./usage.js";

/**
 * How many times the SDK may retry a rate-limited call during a census.
 *
 * Higher than the interactive default, because past the retry budget a rate-limited call IS the pacing
 * mechanism: the spans budget is five requests a minute, so a pass that gave up after three retries would
 * abandon services rather than wait for them.
 */
const SWEEP_RETRIES = RATE_LIMIT_MAX_RETRIES * 10;

/**
 * Print every refusal, then the usage.
 *
 * @param lines every reason the invocation was refused, not just the first
 * @returns the exit code to return
 */
function refuse({ lines }: { lines: readonly string[] }): number {
  lines.forEach((msg) => {
    logger.error({ msg });
  });
  logger.error({ msg: CATALOGUE_USAGE });
  return EXIT_USAGE;
}

/**
 * Build a census against live Datadog and write it under the home.
 *
 * @param args what the invocation asked for
 * @returns the process exit code
 */
async function runBuild({ args }: { args: CatalogueBuildArgs }): Promise<number> {
  const window = resolveWindow({ from: args.from, nowMs: Date.now(), to: args.to });
  if (window.isErr()) {
    return refuse({ lines: datadogDomainErrorLines({ error: window.error }) });
  }
  const { home = slopweaverHome() } = args;
  const config = loadDatadogConfig({ home });
  if (config.isErr()) {
    datadogConfigErrorLines({ error: config.error }).forEach((msg) => {
      logger.error({ msg });
    });
    return EXIT_EXPECTED_EMPTY;
  }
  const client = createDatadogClient({ config: config.value, logger, maxRetries: SWEEP_RETRIES });
  const requester = createRawRequester({ config: config.value, logger });
  const report = await buildCensus({
    client,
    logger,
    request: { products: args.products, window: window.value },
    requester,
  });
  if (report.isErr()) {
    logger.error({ msg: report.error.message });
    return EXIT_ERROR;
  }
  writeCatalogue({ catalogue: report.value.catalogue, home });
  const manifestPath = stateHomePaths({ home }).datadogCatalogue.manifest;
  if (args.json) {
    logger.out({
      line: safeJsonStringify({
        label: "datadog census build",
        value: { manifest: report.value.catalogue.manifest, manifestPath },
      }),
    });
  } else {
    buildLines({ manifestPath, report: report.value }).forEach((line) => {
      logger.out({ line });
    });
    const budget = client.lastRateLimit();
    // Printed only when a metered response actually carried one. A "budget unknown" line on a pass that
    // made thousands of requests would read as the rate limit being unmeasurable rather than as this
    // particular response being unmetered.
    if (budget !== null) {
      logger.out({ line: describeRateLimit({ snapshot: budget }) });
    }
  }
  // An empty census is a legitimate non-success: Datadog answered and had nothing this pass could shape,
  // which must fail a `catalogue build || alert` gate exactly as `datadog probe`'s own zero does.
  return report.value.catalogue.rows.length === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/**
 * Read a built census back.
 *
 * @param args what the invocation asked for
 * @returns the process exit code
 */
function runShow({ args }: { args: CatalogueShowArgs }): number {
  const { home = slopweaverHome() } = args;
  const catalogue = readCatalogue({ home });
  if (catalogue.isErr()) {
    logger.error({ msg: catalogue.error.message });
    return catalogue.error.code === "CATALOGUE_ABSENT" ? EXIT_EXPECTED_EMPTY : EXIT_ERROR;
  }
  if (args.json) {
    logger.out({
      line: safeJsonStringify({
        label: "datadog census",
        value: {
          manifest: catalogue.value.manifest,
          rows: selectRows({ args, catalogue: catalogue.value }),
        },
      }),
    });
    return EXIT_OK;
  }
  showLines({ args, catalogue: catalogue.value }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

/** `slopweaver datadog catalogue <build|show>`. */
export const datadogCatalogueCommand = defineCommand({
  run: async (argv: readonly string[]): Promise<number> => {
    const rest = verbTail({ argv, verbs: ["catalogue"] });
    if (rest.includes("--help") || rest.includes("-h")) {
      logger.out({ line: CATALOGUE_USAGE });
      return EXIT_OK;
    }
    // Parsed through the ONE dispatching parser rather than by branching on `rest[0]` here, so the parser
    // the help-and-flags ratchet probes is the parser this verb actually runs — see `parseCatalogueArgs`.
    const asked = parseCatalogueArgs({ rest });
    if (asked.isErr()) {
      return refuse({ lines: datadogArgsErrorLines({ error: asked.error }) });
    }
    return asked.value.mode === "build" ? runBuild({ args: asked.value.build }) : runShow({ args: asked.value.show });
  },
});
