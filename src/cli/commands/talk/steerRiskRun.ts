/**
 * `slopweaver talk steer-risk` — the explicitly steered deliverables at risk now, as the console voice says them.
 *
 * The console's `steer-risk` route runs this while they are on a call (`site/app/api/talk/call/[id]/steer-risk/route.ts`),
 * so the voice cuts in once per note with the row and its reason, the minute the note is up. The source is the open `steer-at-risk` notes in the hand register, so the voice and their screen always name the
 * same thing. The rules are `src/talk/steerRisk.ts`'s; nothing is written. A register line that will not read is
 * counted in the answer, never dropped silently: it may be the very note the voice was owed.
 */
import { laterPressed } from "../../../hand/laterPresses.js";
import { readNoteMarkers } from "../../../hand/note/markers.js";
import { pendingSnoozeRecords } from "../../../hand/snoozePresses.js";
import { readSnoozes } from "../../../hand/snoozeStore.js";
import { readOpenHandSteps } from "../../../hand/store.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { openIdsForMonitor } from "../../../monitor/openCards.js";
import { monitorDefinition } from "../../../monitor/registry.js";
import { stateHomePaths } from "../../../stateHome.js";
import { answeredStepIds, steerRiskNoticesOf } from "../../../talk/steerRisk.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { TALK_STEER_RISK_USAGE } from "./knowUsage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "steer-risk", ...]`. */
const VERB_ARG_OFFSET = 4;

/** The flags `talk steer-risk` accepts. */
const STEER_RISK_FLAGS: FlagSpec = { boolean: ["json"], string: ["home"] };

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_STEER_RISK_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: STEER_RISK_FLAGS }),
  ...booleanFlagsOf({ spec: STEER_RISK_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `talk steer-risk`'s own flags — exported for the help-truth ratchet.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's own refusals
 */
export function parseTalkSteerRiskArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: STEER_RISK_FLAGS });
}

/**
 * Run `talk steer-risk` over its own flags.
 *
 * @param rest argv after `talk steer-risk`
 * @returns the process exit code
 */
function steerRisk({ rest }: { rest: readonly string[] }): number {
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_STEER_RISK_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTalkSteerRiskArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of [...parsed.error, TALK_STEER_RISK_USAGE]) {
      logger.error({ msg: problem });
    }
    return EXIT_USAGE;
  }
  const homeFlag = parsed.value.values["home"];
  const home = resolveHome({ named: typeof homeFlag === "string" ? homeFlag : undefined });
  // Their answers are read BEFORE the register: a reconcile removes a marker only once what it settled has landed, so
  // a Done whose marker this read missed is already off the register read after it.
  const answered = readAnswered({ home });
  if (answered.isErr()) {
    logger.error({ msg: `talk steer-risk: ${answered.error.message}` });
    return EXIT_ERROR;
  }
  const open = readOpenHandSteps({ home });
  if (open.isErr()) {
    logger.error({ msg: `talk steer-risk: the hand register would not read: ${open.error.message}` });
    return EXIT_ERROR;
  }
  const stepIds = openIdsForMonitor({
    openIds: open.value.steps.map((step) => step.id),
    prefix: monitorDefinition({ monitorId: "steer-at-risk" }).prefix,
  });
  const answer = {
    ...steerRiskNoticesOf({ answered: answered.value, stepIds, steps: open.value.steps }),
    unreadLines: open.value.unparsed.length,
  };
  logger.out({ line: JSON.stringify(answer) });
  return EXIT_OK;
}

/** Which of their answer stores would not read — the three the answered set is built from. */
type AnsweredReadError =
  | { readonly code: "NOTE_ANSWERS_UNREADABLE"; readonly message: string }
  | { readonly code: "LATER_LEDGER_UNREADABLE"; readonly message: string }
  | { readonly code: "SNOOZE_STORE_UNREADABLE"; readonly message: string };

const AnsweredReadErrors = {
  laterLedger: ({ why }: { why: string }): AnsweredReadError => ({
    code: "LATER_LEDGER_UNREADABLE",
    message: `the Later ledger would not read: ${why}`,
  }),
  noteAnswers: ({ why }: { why: string }): AnsweredReadError => ({
    code: "NOTE_ANSWERS_UNREADABLE",
    message: `the note answers would not read: ${why}`,
  }),
  snoozeStore: ({ why }: { why: string }): AnsweredReadError => ({
    code: "SNOOZE_STORE_UNREADABLE",
    message: `the snooze store would not read: ${why}`,
  }),
} as const;

/**
 * Every step whose note answer still holds, read without writing: this verb settles nothing, so it reads the
 * unreconciled markers beside the Later ledger and the snooze store a reconcile would have written them into.
 *
 * @returns the held step ids, or which store would not read
 */
function readAnswered({ home }: { home: string }): Result<ReadonlySet<string>, AnsweredReadError> {
  const markers = readNoteMarkers({ markerDir: stateHomePaths({ home }).handNoteDismiss });
  if (markers.isErr()) {
    return err(AnsweredReadErrors.noteAnswers({ why: markers.error.message }));
  }
  // Each store is read AFTER the markers it is reconciled from, for the same reason: a marker gone by its stamp's
  // read was written into the store first.
  const pending = pendingSnoozeRecords({ snoozes: markers.value });
  const later = laterPressed({ home });
  if (later.isErr()) {
    return err(AnsweredReadErrors.laterLedger({ why: later.error.message }));
  }
  const snoozes = readSnoozes({ home });
  // An entry that will not read is held down by its id; a store that will not even list names none, so it refuses.
  if (snoozes.problems.length > 0 && snoozes.unreadable.length === 0) {
    return err(AnsweredReadErrors.snoozeStore({ why: snoozes.problems.map((problem) => problem.message).join("; ") }));
  }
  return ok(
    answeredStepIds({
      laterIds: later.value,
      markers: markers.value,
      nowIso: new Date().toISOString(),
      snoozes: [...snoozes.records, ...pending],
      unreadableSnoozes: snoozes.unreadable,
    }),
  );
}

/**
 * `slopweaver talk steer-risk`.
 *
 * @param argv the whole argv, noun and verb first
 * @returns the exit code
 */
function runTalkSteerRisk(argv: readonly string[]): number {
  return steerRisk({ rest: argv.slice(VERB_ARG_OFFSET) });
}

/** `slopweaver talk steer-risk`. */
export const talkSteerRiskCommand = defineCommand({ run: runTalkSteerRisk });
