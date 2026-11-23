/**
 * `slopweaver store exclusions` — find the pairs that are pure alert traffic, and remove what the denylist
 * already covers.
 *
 * A thin effectful shell: every parser and every rendered line is pure ({@link ./exclusionCore}), the
 * detector is {@link ../../../corpus/syncExclusionDetector}, and the database work is
 * {@link ../../../store/syncExclusionStore}.
 *
 * ## Why the two verbs are here together and still cannot reach each other
 *
 * `detect` proposes and `purge` acts, and nothing routes one into the other. That is the property the owner
 * bought when they took the generalised detector: a rule that recomputed itself every sync would silently
 * start indexing a channel the week it got busy and stop the week it went quiet, and nobody could say why
 * the corpus changed. So a proposal reaches policy only through a human writing a line into
 * `$SLOPWEAVER_HOME/sync-author-denylist.txt`, and `purge` reads that file and nothing else.
 */

import { loadSyncExclusion } from "../../../corpus/syncExclusion.js";
import { proposeSyncExclusions } from "../../../corpus/syncExclusionDetector.js";
import { logger } from "../../../lib/logger.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { purgeExcludedContent, readAppChannelCounts } from "../../../store/syncExclusionStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

import { storeTail } from "./core.js";
import { storeCommandErrorLines } from "./errors.js";
import { detectLines, type ExclusionArgs, parseExclusionArgs, purgeLines } from "./exclusionCore.js";
import { openStoreOrRefuse, refuseWith } from "./shell.js";

/** The usage line, printed beside every refusal. */
const EXCLUSION_USAGE =
  "usage: slopweaver store exclusions detect|purge [--apply] [--delete-human-threads] [--home <dir>] [--json]\n" +
  "  detect  proposes the (app, channel) pairs that read as pure alert traffic. Changes nothing.\n" +
  "  purge   counts what the denylist already covers; --apply deletes it. Bronze is never touched.\n" +
  "          A denied alert a human replied under is KEPT, so no reply is orphaned (rule D);\n" +
  "          --delete-human-threads takes those too, retroactively.";

/**
 * Run the verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreExclusions(argv: readonly string[]): Promise<number> {
  const args = parseExclusionArgs({ rest: storeTail({ argv }) });
  if (args.isErr()) {
    return refuseWith({ lines: storeCommandErrorLines({ error: args.error }), usage: EXCLUSION_USAGE });
  }
  const opened = await openStoreOrRefuse(args.value.home === undefined ? {} : { home: args.value.home });
  if ("code" in opened) {
    return opened.code;
  }
  try {
    if (args.value.verb === "detect") {
      return await runDetect({ args: args.value, client: opened.client });
    }
    return await runPurge({ args: args.value, client: opened.client });
  } finally {
    await opened.client.close();
  }
}

/**
 * Count every pair the store holds and print the ones that qualify.
 *
 * @param args what was asked for
 * @param client the open store
 * @returns the process exit code
 */
async function runDetect({
  args,
  client,
}: {
  args: ExclusionArgs;
  client: Parameters<typeof readAppChannelCounts>[0]["client"];
}): Promise<number> {
  const counts = await readAppChannelCounts({ client });
  if (counts.isErr()) {
    logger.error({ msg: counts.error.message });
    return EXIT_ERROR;
  }
  const denylist = loadSyncExclusion(args.home === undefined ? {} : { home: args.home });
  if (denylist.isErr()) {
    return refuseWith({ lines: denylist.error, usage: EXCLUSION_USAGE });
  }
  const proposals = proposeSyncExclusions({ counts: counts.value });
  if (args.json) {
    logger.out({ line: safeJsonStringify({ label: "store exclusions detect", value: { proposals } }) });
    return EXIT_OK;
  }
  detectLines({ path: denylist.value.path, proposals }).forEach((msg) => {
    logger.error({ msg });
  });
  return EXIT_OK;
}

/**
 * Count — or, with `--apply`, remove — everything the denylist covers.
 *
 * `--apply` is the escape itself rather than a gate in front of one: a named flag IS a working hatch, and
 * an environment variable beside a flag that already works is the redundancy `error-handling.md` names by
 * measurement. Nothing is refused here — a preview is what was ASKED for when the flag is absent.
 *
 * `--delete-human-threads` is the second such flag, and it waives rule D. It reads as a negation because
 * the default is now the safe direction: an apply run while rule D was deferred orphaned 1,478
 * human replies in one channel ({@link ../../../store/syncExclusionStore}), so keeping the parent is what a
 * plain `purge --apply` does and taking it has to be typed.
 *
 * @param args what was asked for
 * @param client the open store
 * @returns the process exit code
 */
async function runPurge({
  args,
  client,
}: {
  args: ExclusionArgs;
  client: Parameters<typeof purgeExcludedContent>[0]["client"];
}): Promise<number> {
  const denylist = loadSyncExclusion(args.home === undefined ? {} : { home: args.home });
  if (denylist.isErr()) {
    return refuseWith({ lines: denylist.error, usage: EXCLUSION_USAGE });
  }
  const report = await purgeExcludedContent({
    apply: args.apply,
    client,
    exclusion: denylist.value,
    keepHumanThreads: !args.deleteHumanThreads,
  });
  if (report.isErr()) {
    logger.error({ msg: report.error.message });
    return EXIT_ERROR;
  }
  if (args.json) {
    logger.out({ line: safeJsonStringify({ label: "store exclusions purge", value: report.value }) });
    return EXIT_OK;
  }
  purgeLines({ report: report.value }).forEach((msg) => {
    logger.error({ msg });
  });
  return EXIT_OK;
}

/** The `store exclusions` verb. */
export const storeExclusionsCommand = defineCommand({ run: runStoreExclusions });
