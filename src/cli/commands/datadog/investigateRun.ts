/**
 * `slopweaver datadog logs | apm | rum | ci | tests | dbm | profiles` — the investigation verbs.
 *
 * ## One run function, seven verb names
 *
 * A command per product does the heavy lifting, with no hand-built console
 * URLs and no raw calls outside an obscure case. So each verb is a thin entry over
 * {@link ../../../datadog/investigate/run}: it resolves the window, opens the client and the read-only raw
 * path, reads the local census so a group can be labelled by what it IS rather than by a hex fingerprint,
 * and prints the reported counts before events. `--json` carries each result's `countLabel` (a plain count,
 * or a sampled lower bound), its `partition` audit and its `corroborate` hint beside the numbers they qualify.
 *
 * ## The census is read, never required
 *
 * An install that has never run `datadog catalogue build` still gets counts and rows; what it loses is the
 * label on a group. That is deliberate: the verbs have to work on a fresh machine, and a missing label is a
 * poorer report rather than a wrong one.
 */

import { createDatadogClient } from "../../../datadog/client.js";
import { datadogConfigErrorLines } from "../../../datadog/configErrors.js";
import type { Catalogue } from "../../../datadog/detective/catalogue.js";
import { readCatalogue } from "../../../datadog/detective/store.js";
import { datadogDomainErrorLines } from "../../../datadog/domainErrors.js";
import { investigate } from "../../../datadog/investigate/run.js";
import type { InvestigateProduct } from "../../../datadog/investigate/spec.js";
import { createRawRequester } from "../../../datadog/rawRequest.js";
import { loadDatadogConfig } from "../../../datadog/source.js";
import { resolveWindow } from "../../../datadog/window.js";
import { slopweaverHome } from "../../../homeDir.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { type CommandRun, defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { verbTail } from "../../optionParsers.js";
import { datadogArgsErrorLines } from "./errors.js";
import { type InvestigateArgs, investigateLines, parseInvestigateArgs } from "./investigateCore.js";
import { investigateUsage } from "./usage.js";

/**
 * The census this install has built, or nothing when it has none.
 *
 * @param home the Slopweaver home
 * @returns the census, or nothing
 */
function censusOrNone({ home }: { home: string }): Catalogue | null {
  const read = readCatalogue({ home });
  if (read.isErr()) {
    return null;
  }
  return read.value;
}

/**
 * Build one product's verb.
 *
 * @param product which product this verb investigates
 * @returns the command the router dispatches
 */
export function investigateCommand({ product }: { product: InvestigateProduct }): CommandRun {
  return defineCommand({
    run: async (argv: readonly string[]): Promise<number> => {
      const rest = verbTail({ argv, verbs: [product] });
      if (rest.includes("--help") || rest.includes("-h")) {
        logger.out({ line: investigateUsage({ product }) });
        return EXIT_OK;
      }
      const asked = parseInvestigateArgs({ rest });
      if (asked.isErr()) {
        for (const line of datadogArgsErrorLines({ error: asked.error })) {
          logger.error({ msg: line });
        }
        logger.error({ msg: investigateUsage({ product }) });
        return EXIT_USAGE;
      }
      return runInvestigation({ args: asked.value, product });
    },
  });
}

/**
 * Run one already-parsed investigation and print it.
 *
 * Split from the verb so the command reads as parse-then-run rather than as one body carrying both, which is
 * the length the reader-holds-it-all gate is about.
 *
 * @param args what the invocation asked for
 * @param product which product to investigate
 * @returns the process exit code
 */
async function runInvestigation({
  args,
  product,
}: {
  args: InvestigateArgs;
  product: InvestigateProduct;
}): Promise<number> {
  const window = resolveWindow({ from: args.from, nowMs: Date.now(), to: args.to });
  if (window.isErr()) {
    datadogDomainErrorLines({ error: window.error }).forEach((msg) => {
      logger.error({ msg });
    });
    logger.error({ msg: investigateUsage({ product }) });
    return EXIT_USAGE;
  }
  const { home = slopweaverHome() } = args;
  const config = loadDatadogConfig({ home });
  if (config.isErr()) {
    datadogConfigErrorLines({ error: config.error }).forEach((msg) => {
      logger.error({ msg });
    });
    return EXIT_EXPECTED_EMPTY;
  }
  const result = await investigate({
    catalogue: censusOrNone({ home }),
    client: createDatadogClient({ config: config.value, logger }),
    logger,
    request: {
      excludes: args.excludes,
      facets: args.facets,
      product,
      query: args.query,
      rows: args.rows,
      window: window.value,
    },
    requester: createRawRequester({ config: config.value, logger }),
  });
  if (args.json) {
    logger.out({ line: safeJsonStringify({ label: `datadog ${product}`, value: result }) });
  } else {
    investigateLines({ result }).forEach((line) => {
      logger.out({ line });
    });
  }
  if (result.total === null && result.groups.length === 0) {
    // Datadog answered nothing at all — a fault rather than an empty estate, and the notes say which.
    return EXIT_ERROR;
  }
  // A zero is a legitimate non-success: `datadog logs 'service:x status:error' || alert` has to fire.
  return result.total === 0 ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/** `slopweaver datadog logs`. */
export const datadogLogsCommand = investigateCommand({ product: "logs" });

/** `slopweaver datadog apm`. */
export const datadogApmCommand = investigateCommand({ product: "apm" });

/** `slopweaver datadog rum`. */
export const datadogRumCommand = investigateCommand({ product: "rum" });

/** `slopweaver datadog ci`. */
export const datadogCiCommand = investigateCommand({ product: "ci" });

/** `slopweaver datadog tests`. */
export const datadogTestsCommand = investigateCommand({ product: "tests" });

/** `slopweaver datadog dbm`. */
export const datadogDbmCommand = investigateCommand({ product: "dbm" });

/** `slopweaver datadog profiles`. */
export const datadogProfilesCommand = investigateCommand({ product: "profiles" });
