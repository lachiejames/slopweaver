/**
 * `slopweaver witness resume <id>` — the one line a witness worker is handed, and what it prints back: the
 * CODE-authored instructions for that witness (`../../../live/witness/instructions.ts`).
 *
 * Read-only. It reads the journal and prints; it writes nothing, posts nothing and boots nothing, so a worker
 * that runs it twice (a compaction, a resubmitted composer) loses nothing.
 */
import { logger } from "#lib/logger.js";
import { witnessResumeInstructions } from "../../../live/witness/instructions.js";
import { foldWitnessJournal } from "../../../live/witness/journal.js";
import { readWitnessJournal } from "../../../live/witness/journalStore.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseWitnessResumeArgs, VERB_ARG_OFFSET } from "./args.js";
import { WITNESS_RESUME_USAGE } from "./usage.js";

/**
 * Run `witness resume`.
 *
 * @param argv the full process argv
 * @returns the process exit code — `EXIT_OK` for a live witness and for an already-settled one (there is
 *   nothing left to do, which is not a fault), `EXIT_ERROR` for an id the journal does not hold
 */
export function runWitnessResume(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: WITNESS_RESUME_USAGE });
    return EXIT_OK;
  }
  const parsed = parseWitnessResumeArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      logger.error({ msg: problem });
    });
    logger.error({ msg: WITNESS_RESUME_USAGE });
    return EXIT_USAGE;
  }
  const { home, witnessId } = parsed.value;
  const events = readWitnessJournal(home === undefined ? {} : { home });
  if (events.isErr()) {
    logger.error({ msg: `witness resume: ${events.error.message}` });
    return EXIT_ERROR;
  }
  const record = foldWitnessJournal({ events: events.value }).get(witnessId);
  if (record === undefined) {
    logger.error({
      msg: `witness resume: no witness ${witnessId} in the journal — slopweaver witness list shows the ones this home holds`,
    });
    return EXIT_ERROR;
  }
  if (record.settled !== undefined) {
    logger.out({
      line: `witness ${witnessId} is already settled (${record.settled.outcome}) — there is nothing left to do; close this session.`,
    });
    return EXIT_OK;
  }
  if (record.dispatched === undefined) {
    logger.error({ msg: `witness resume: witness ${witnessId} has no dispatched worker to resume` });
    return EXIT_ERROR;
  }
  witnessResumeInstructions({ record: record.dispatched }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

export const witnessResumeCommand = defineCommand({ run: runWitnessResume });
