/**
 * `slopweaver witness list` — every witness this home's journal holds, newest first, and where each stands.
 *
 * A row with a worker and no terminal is the one worth a look: a worker that never settled is a witness that
 * neither posted nor said why it stayed silent.
 */
import { logger } from "#lib/logger.js";
import { foldWitnessJournal, witnessesNewestFirst } from "../../../live/witness/journal.js";
import { readWitnessJournal } from "../../../live/witness/journalStore.js";
import type { WitnessCurrent, WitnessThreadStoodDownEvent } from "../../../live/witness/types.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseWitnessListArgs, VERB_ARG_OFFSET } from "./args.js";
import { WITNESS_LIST_USAGE } from "./usage.js";

/** One record's state word: `revised` once its posted reply was corrected, its outcome once settled, else `live`. */
function stateOf({ record }: { record: WitnessCurrent }): string {
  if (record.revised !== undefined) {
    return "revised";
  }
  if (record.settled !== undefined) {
    return record.settled.outcome;
  }
  return "live";
}

/**
 * One human-readable row.
 *
 * @param record the folded witness
 * @returns `<id>  <state>  <channel>/<messageTs>  <latest instant>  [<workspace>]`
 */
export function witnessListRow({ record }: { record: WitnessCurrent }): string {
  const workspace = record.dispatched === undefined ? "" : `  ${record.dispatched.workspaceRef}`;
  return (
    `${record.witnessId}  ${stateOf({ record }).padEnd(17)} ${record.key.channel}/${record.key.messageTs}  ` +
    `${record.latestIso}${workspace}`
  );
}

/**
 * Run `witness list`.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runWitnessList(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: WITNESS_LIST_USAGE });
    return EXIT_OK;
  }
  const parsed = parseWitnessListArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: WITNESS_LIST_USAGE });
    return EXIT_USAGE;
  }
  const { home, json } = parsed.value;
  const events = readWitnessJournal(home === undefined ? {} : { home });
  if (events.isErr()) {
    logger.error({ msg: `witness list: ${events.error.message}` });
    return EXIT_ERROR;
  }
  const records = witnessesNewestFirst({ current: foldWitnessJournal({ events: events.value }) });
  if (json) {
    logger.out({ line: JSON.stringify(records) });
    return EXIT_OK;
  }
  const threads = events.value.filter((event) => event.kind === "thread-stood-down");
  if (records.length === 0 && threads.length === 0) {
    logger.out({ line: "witness list: no witnesses recorded in this home" });
    return EXIT_OK;
  }
  records.forEach((record) => {
    logger.out({ line: witnessListRow({ record }) });
  });
  threads.forEach((row) => {
    logger.out({ line: threadStandDownListRow({ row }) });
  });
  return EXIT_OK;
}

/**
 * One human-readable row for a whole-thread stand-down, which is about no witness and so is no folded record.
 * `--json` stays the witness records alone, the shape its readers parse.
 *
 * @param row the whole-thread row
 * @returns `<id>  thread-stood-down  <channel>/<threadTs>  <instant>  <why>`
 */
export function threadStandDownListRow({ row }: { row: WitnessThreadStoodDownEvent }): string {
  return `${row.standDownId}  ${row.kind.padEnd(17)} ${row.channel}/${row.threadTs}  ${row.tsIso}  ${row.why}`;
}

export const witnessListCommand = defineCommand({ run: runWitnessList });
