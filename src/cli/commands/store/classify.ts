/**
 * `slopweaver store classify` — sort every row the store already holds by the data-class rules, and count what the
 * census says cannot hold a class.
 *
 * A verb rather than a step inside `store push`, for the reason `./bots.ts` gives: the migration that added
 * `data_class` finishes instantly, while sorting every stored row is a data pass that must be safe to interrupt and
 * safe to run again. Run it once after the column lands, again after a rules change, and again whenever an
 * applying pass reports a row still holding no class.
 *
 * **`--dry-run` writes nothing at all**, the store's own migration catch-up included: it opens the store with
 * `catchUp: false`, so a command promising not to write never applies a pending migration on its way in.
 *
 * An installation rules file that exists but cannot be used refuses the pass, exactly as it refuses an ingest:
 * rows sorted under rules the owner did not mean would be wrongly classified with nothing to show it.
 */

import { progressJsonEnabled } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { createRichProgressEmitter, unrefIntervalStallTimer } from "../../../lib/progressRichEmitter.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { connectStore } from "../../../store/client.js";
import { loadDataClassRules } from "../../../store/dataClassRulesFile.js";
import { type DataClassificationReport, resolveDataClasses } from "../../../store/resolveDataClasses.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  CLASSIFY_USAGE,
  classifyFailureLine,
  classifyIncomplete,
  classifyLines,
  parseStoreClassifyArgs,
} from "./classifyCore.js";
import { storeCommandErrorLines } from "./errors.js";

/**
 * Print a finished pass's report, as JSON or as the counts-only lines.
 *
 * @param report the finished pass's report
 * @param json whether the invocation asked for JSON
 */
function printReport({ report, json }: { report: DataClassificationReport; json: boolean }): void {
  if (json) {
    logger.out({ line: safeJsonStringify({ label: "store classify", value: report }) });
    return;
  }
  classifyLines({ report }).forEach((line) => {
    logger.out({ line });
  });
}

/**
 * Classify every stored row.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreClassify(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(argv[3] === "classify" ? 4 : 3);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CLASSIFY_USAGE });
    return EXIT_OK;
  }
  const args = parseStoreClassifyArgs({ rest });
  if (args.isErr()) {
    storeCommandErrorLines({ error: args.error }).forEach((msg) => {
      logger.error({ msg });
    });
    return EXIT_USAGE;
  }
  const { batch, dryRun, home, json, sample } = args.value;
  const where = home === undefined ? {} : { home };
  const rules = loadDataClassRules(where);
  if (rules.isErr()) {
    logger.error({ msg: rules.error.message });
    return EXIT_ERROR;
  }
  const opened = await connectStore({ ...where, catchUp: !dryRun });
  if (opened.isErr()) {
    logger.error({ msg: opened.error.message });
    return EXIT_ERROR;
  }
  const progress = createRichProgressEmitter({
    stallTimer: unrefIntervalStallTimer,
    verb: "store classify",
    ...(progressJsonEnabled() ? {} : { machineSink: () => {} }),
  });
  try {
    const report = await resolveDataClasses({
      client: opened.value,
      dryRun,
      onProgress: ({ table, done, total }) => {
        progress.emit({ done, lane: "heartbeat", phase: table, total });
      },
      rules: rules.value,
      ...(batch === undefined ? {} : { batch }),
      ...(sample === undefined ? {} : { sample }),
    });
    if (report.isErr()) {
      logger.error({ msg: classifyFailureLine({ error: report.error }) });
      return EXIT_ERROR;
    }
    progress.finish({ lane: "heartbeat", phase: "done" });
    printReport({ json, report: report.value });
    return classifyIncomplete({ report: report.value }) ? EXIT_ERROR : EXIT_OK;
  } finally {
    progress.close();
    await opened.value.close();
  }
}

export const storeClassifyCommand = defineCommand({ run: runStoreClassify });
