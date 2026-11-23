/**
 * `slopweaver store pages-import` — every published page and frozen version carried into the store, each body an
 * object in Storage, stage 2 of [published pages](../../../../docs/store/published-pages.md).
 *
 * Straight-line on purpose: scan both folders, project them, and stop there on any refusal or under `--dry-run`, so
 * no connection is ever opened for a run that will not write. Only then is the store opened and the plan written,
 * the bucket opened lazily by the write itself. Neither folder is changed by any path through here.
 */
import { logger } from "#lib/logger.js";
import { safeJsonStringify } from "#lib/safeJson.js";

import { stateHomePaths } from "../../../stateHome.js";
import { connectStore } from "../../../store/client.js";
import { importPublishedPages, publishedPageObjects } from "../../../store/publishedPages/importStore.js";
import { projectPublishedPages } from "../../../store/publishedPages/project.js";
import { scanPublishedPageSources } from "../../../store/publishedPages/scan.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

import { storeTail } from "./core.js";
import {
  type PagesImportArgs,
  type PagesImportReport,
  pagesImportLines,
  parsePagesImportArgs,
} from "./pagesImportCore.js";
import { PAGES_IMPORT_USAGE } from "./pagesImportUsage.js";

/**
 * Print the report, as JSON or as lines, and answer the exit code it means.
 *
 * @param report what the run did
 * @param json whether `--json` was given
 * @returns `EXIT_ERROR` when anything was refused, else `EXIT_OK`
 */
function finish({ report, json }: { report: PagesImportReport; json: boolean }): number {
  if (json) {
    logger.out({ line: safeJsonStringify({ label: "store pages-import report", value: report }) });
  } else {
    pagesImportLines({ report }).forEach((msg) => {
      logger.error({ msg });
    });
  }
  return report.refusals.length > 0 ? EXIT_ERROR : EXIT_OK;
}

/**
 * Scan, project and — unless refused or dry — write.
 *
 * @param args the parsed arguments
 * @returns the exit code
 */
async function pagesImport({ args }: { args: PagesImportArgs }): Promise<number> {
  const home = stateHomePaths(args.home === undefined ? {} : { home: args.home }).root;
  const refused = { counts: undefined, dryRun: args.dryRun, writes: undefined };
  const scan = await scanPublishedPageSources({ home });
  if (scan.isErr()) {
    return finish({ json: args.json, report: { ...refused, refusals: scan.error.map((e) => e.message) } });
  }
  const plan = projectPublishedPages({ home, scan: scan.value });
  if (plan.isErr()) {
    return finish({ json: args.json, report: { ...refused, refusals: plan.error.map((e) => e.message) } });
  }
  const report: PagesImportReport = { counts: plan.value.counts, dryRun: args.dryRun, refusals: [], writes: undefined };
  if (args.dryRun) {
    return finish({ json: args.json, report });
  }
  const opened = await connectStore(args.home === undefined ? {} : { home: args.home });
  if (opened.isErr()) {
    logger.error({ msg: opened.error.message });
    return EXIT_ERROR;
  }
  const client = opened.value;
  try {
    const written = await importPublishedPages({
      client,
      context: { importedAt: new Date(), kind: "import" },
      objects: () => publishedPageObjects(),
      plan: plan.value,
    });
    if (written.isErr()) {
      return finish({ json: args.json, report: { ...report, refusals: written.error.map((e) => e.message) } });
    }
    return finish({ json: args.json, report: { ...report, writes: written.value } });
  } finally {
    await client.close();
  }
}

/**
 * Run the verb.
 *
 * @param argv the full process argv (`[node, cli, store, pages-import, …]`)
 * @returns the process exit code
 */
export async function runPagesImport(argv: readonly string[]): Promise<number> {
  const rest = storeTail({ argv });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: PAGES_IMPORT_USAGE });
    return EXIT_OK;
  }
  const parsed = parsePagesImportArgs({ argv: rest });
  if (parsed.isErr()) {
    parsed.error.forEach((msg) => {
      logger.error({ msg });
    });
    logger.error({ msg: PAGES_IMPORT_USAGE });
    return EXIT_USAGE;
  }
  return pagesImport({ args: parsed.value });
}

/** The verb, as the manifest loads it. */
export const storePagesImportCommand = defineCommand({ run: runPagesImport });
