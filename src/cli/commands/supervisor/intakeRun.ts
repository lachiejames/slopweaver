/**
 * `slopweaver supervisor intake` — the read edge of the intake check; `./intakeMarkRun.ts` is the write edge.
 *
 * `intake` reads every turn the owner typed into the supervisor and says which of them nothing witnesses,
 * printing the exact `handover register` line that would witness each one. `intake-mark` records the other
 * ways a turn is acted on — it became a page card, it answered something, or it asked for nothing — in the
 * ledger the check reads. Neither decides anything: the judgement is `../../../supervisor/intake.ts`, and the
 * read is `../../../supervisor/intakeRead.ts`.
 *
 * `intake` is diagnostic-shaped: a non-zero exit REPORTS unwitnessed turns, never a broken tool. The
 * reconciliation (`../handover/reconcileRun.ts`) runs the same read every sweep tick and folds the count into
 * the headline the briefing cannot render without, so this verb is how a session sees the turns behind that
 * number rather than the only place the check fires.
 */
import { homedir } from "node:os";
import { join } from "node:path";

import type { HandoverDoc } from "../../../handover/doc.js";
import { scanBoard } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { readSupervisorChainEvents } from "../../../supervisor/chainStore.js";
import type { InboundFinding, OpenInbound } from "../../../supervisor/inbound.js";
import {
  type IntakeFinding,
  type IntakeReport,
  intakeClause,
  registerCommandFor,
  type WitnessedTurn,
} from "../../../supervisor/intake.js";
import { readSupervisorChainIntake, readSupervisorIntake } from "../../../supervisor/intakeRead.js";
import { readIntakeMarks } from "../../../supervisor/intakeStore.js";
import {
  type TypedIntakeReport,
  typedRegisterCommandFor,
  type WitnessedTypedTurn,
} from "../../../supervisor/typedIntake.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { parseFlagTail, resolveHome, verbTail } from "../../optionParsers.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { instantProblem, refuse } from "./intakeFlags.js";
import { INTAKE_USAGE } from "./intakeUsage.js";

/** `intake`'s flag tail — exported so `--help`'s advertised flags and the parser cannot drift. */
export const INTAKE_FLAG_SPEC = {
  boolean: ["json"],
  value: ["session", "since", "now", "home"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/** What `supervisor intake` resolves to. */
export interface IntakeOptions {
  readonly sessionId: string | undefined;
  readonly sinceIso: string | undefined;
  readonly nowIso: string | undefined;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * Parse `intake`'s flag tail. No I/O.
 *
 * @param rest the flag tail, after the noun/verb tokens
 * @returns the options, or every rejection
 */
export function parseIntakeOptions({ rest }: { rest: readonly string[] }): Result<IntakeOptions> {
  const parsed = parseFlagTail({ rest, spec: INTAKE_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values, flags } = parsed.value;
  const problems = [
    instantProblem({ name: "since", value: values["since"] }),
    instantProblem({ name: "now", value: values["now"] }),
  ].filter((problem): problem is string => problem !== undefined);
  if (problems.length > 0) {
    return err(problems);
  }
  return ok({
    home: values["home"],
    json: flags.has("json"),
    nowIso: values["now"],
    sessionId: values["session"],
    sinceIso: values["since"],
  });
}

/** How much of a turn's text one report line carries. */
const TURN_LINE_CHARS = 90;

/** One turn as a report line: its verdict, when, and the start of what the owner said. */
function turnLine({ item }: { item: WitnessedTurn }): string {
  const turn = item.turn;
  const text = turn.text.replace(/\s+/g, " ").trim();
  const excerpt = text.length > TURN_LINE_CHARS ? `${text.slice(0, TURN_LINE_CHARS).trimEnd()}…` : text;
  let verdict: string;
  if (item.witness !== undefined) {
    verdict = `${item.witness.kind}: ${item.witness.witness}`;
  } else if (item.inGrace) {
    verdict = "in grace";
  } else {
    verdict = "UNWITNESSED";
  }
  return `  ${turn.timestamp}  [${verdict}]  ${turn.pointer}\n      ${excerpt}`;
}

/**
 * `supervisor intake` — every owner turn in the supervisor, with its witness or the lack of one.
 *
 * @param argv the full process argv
 * @returns the process exit code — non-zero when a turn is unwitnessed or the intake could not be read
 */
function runIntake(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: ["intake"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: INTAKE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseIntakeOptions({ rest });
  if (parsed.isErr()) {
    return refuse({ errors: parsed.error, usage: INTAKE_USAGE });
  }
  const options = parsed.value;
  const home = resolveHome({ named: options.home });
  const scan = scanBoard({ handoverDir: resolveHandoverDir({ dir: undefined, home }) });
  if (scan.isErr()) {
    logger.error({ msg: `supervisor intake: ${scan.error.message}` });
    return EXIT_ERROR;
  }
  const report = intakeReport({ docs: scan.value.docs, home, options });
  if (options.json) {
    logger.out({ line: JSON.stringify(report) });
    const clean =
      report.kind === "read" &&
      report.finding.unwitnessed.length === 0 &&
      report.inbound.carried.length === 0 &&
      typedClean({ typed: report.typed });
    return clean ? EXIT_OK : EXIT_ERROR;
  }
  logger.out({ line: intakeClause({ report }) });
  if (report.kind === "unavailable") {
    return EXIT_ERROR;
  }
  const turnsExit = printFinding({ finding: report.finding });
  const typedExit = printTyped({ typed: report.typed });
  const inboundExit = printInbound({ inbound: report.inbound });
  return [turnsExit, typedExit, inboundExit].every((code) => code === EXIT_OK) ? EXIT_OK : EXIT_ERROR;
}

/** Whether the typed half leaves nothing owed: absent, excluded, or read with every pending turn witnessed or in grace. */
function typedClean({ typed }: { typed: TypedIntakeReport | undefined }): boolean {
  if (typed === undefined || typed.kind === "excluded") {
    return true;
  }
  return typed.kind === "read" && typed.finding.unwitnessed.length === 0;
}

/** One typed console turn as a report line: its verdict, when, and its pointer. Never its words. */
function typedTurnLine({ item }: { item: WitnessedTypedTurn }): string {
  let verdict: string;
  if (item.witness !== undefined) {
    verdict = `${item.witness.kind}: ${item.witness.witness}`;
  } else if (item.inGrace) {
    verdict = "in grace";
  } else {
    verdict = "UNWITNESSED";
  }
  return `  ${item.turn.timestamp}  [${verdict}]  ${item.turn.pointer}`;
}

/**
 * Print the owner's typed console turns still pending as this read began, and the register lines for the unwitnessed.
 * Pointers and instants only: `talk unread` is where a chair reads what one says.
 *
 * @param typed the typed half of the report
 * @returns the process exit code — non-zero when a typed turn is unwitnessed or the half could not be read
 */
function printTyped({ typed }: { typed: TypedIntakeReport | undefined }): number {
  if (typed === undefined || typed.kind === "excluded") {
    return EXIT_OK;
  }
  logger.out({ line: "" });
  if (typed.kind === "unavailable") {
    logger.error({ msg: `  TYPED CONSOLE TURNS UNREADABLE: ${typed.why}` });
    return EXIT_ERROR;
  }
  const { finding } = typed;
  logger.out({
    line: `typed console turns, read since ${finding.discoveredFromIso} and remembered past it: ${String(finding.turns.length)} pending`,
  });
  finding.unreadable.forEach((gap) => {
    logger.error({ msg: `  UNREADABLE ${gap}` });
  });
  finding.turns.forEach((item) => {
    logger.out({ line: typedTurnLine({ item }) });
  });
  if (finding.unwitnessed.length === 0) {
    return EXIT_OK;
  }
  logger.out({ line: "" });
  logger.out({
    line: "read each with `talk unread`, then witness it with a row (the line below), a settlement, or `supervisor intake-mark`:",
  });
  finding.unwitnessed.forEach((turn) => {
    logger.out({ line: `  ${typedRegisterCommandFor({ turn })}` });
  });
  return EXIT_ERROR;
}

/** How much of a peer message's body one report line carries. */
const INBOUND_LINE_CHARS = 90;

/** One open peer message as a report line: when, which chair, who sent it, and the start of what it said. */
function inboundLine({ item }: { item: OpenInbound }): string {
  const body = item.message.body.replace(/\s+/g, " ").trim();
  const excerpt = body.length > INBOUND_LINE_CHARS ? `${body.slice(0, INBOUND_LINE_CHARS).trimEnd()}…` : body;
  return `  ${item.message.timestamp}  from ${item.message.senderName}  ${item.pointer}\n      ${excerpt}`;
}

/**
 * Print the chain's open peer messages: the carried ones first, then the unanswered ones.
 *
 * @param inbound what the inbound check found
 * @returns the process exit code — non-zero when a message is carried
 */
function printInbound({ inbound }: { inbound: InboundFinding }): number {
  logger.out({ line: "" });
  logger.out({
    line:
      `messages from other sessions: ${String(inbound.read)} read, ${String(inbound.answered)} answered, ` +
      `${String(inbound.marked)} marked, ${String(inbound.chainTraffic)} between chairs, ${String(inbound.inGrace)} in grace`,
  });
  if (inbound.carried.length > 0) {
    logger.out({
      line: `CARRIED — landed after the chair handed over, nobody reading (${String(inbound.carried.length)}):`,
    });
    inbound.carried.forEach((item) => {
      logger.out({ line: inboundLine({ item }) });
    });
  }
  if (inbound.unanswered.length > 0) {
    logger.out({ line: `unanswered inside a chair's own span (${String(inbound.unanswered.length)}):` });
    inbound.unanswered.forEach((item) => {
      logger.out({ line: inboundLine({ item }) });
    });
  }
  if (inbound.carried.length === 0 && inbound.unanswered.length === 0) {
    return EXIT_OK;
  }
  logger.out({
    line: "reply to the sender, or: slopweaver supervisor intake-mark --turn <pointer> --as answered|no-ask --witness <text>",
  });
  return inbound.carried.length > 0 ? EXIT_ERROR : EXIT_OK;
}

/**
 * The instant the grace window is judged from: `--now` when a caller pinned one, else the wall clock.
 *
 * @param options the parsed flag tail
 * @returns an ISO instant
 */
function judgedAt({ options }: { options: IntakeOptions }): string {
  const pinned = options.nowIso;
  if (pinned === undefined) {
    return new Date().toISOString();
  }
  return pinned;
}

/**
 * One supervisor leg as a report line. A leg with no start instant was read from the start of its transcript.
 *
 * @param leg one session the intake walked
 * @returns the line to print
 */
function legLine({ leg }: { leg: IntakeFinding["legs"][number] }): string {
  const walked = `${leg.sessionId}  ${String(leg.turns)} turn(s)`;
  if (leg.fromIso === undefined) {
    return `  from the start of its transcript  ${walked}`;
  }
  return `  from ${leg.fromIso}  ${walked}`;
}

/**
 * Read the intake the caller asked for: the whole chain, or the one session `--session` named.
 *
 * @param options the parsed flag tail
 * @param home the state home
 * @param docs the board's rows
 * @returns the finding, or why it could not be made
 */
function intakeReport({
  options,
  home,
  docs,
}: {
  options: IntakeOptions;
  home: string;
  docs: readonly HandoverDoc[];
}): IntakeReport {
  const marks = readIntakeMarks({ home });
  if (marks.isErr()) {
    return { kind: "unavailable", why: marks.error.message };
  }
  const shared = {
    claudeHome: join(homedir(), ".claude"),
    docs,
    home,
    marks: marks.value,
    nowIso: judgedAt({ options }),
    sinceIso: options.sinceIso,
  };
  if (options.sessionId === undefined) {
    return readSupervisorChainIntake({ ...shared, chain: readSupervisorChainEvents({ home }) });
  }
  return readSupervisorIntake({ ...shared, sessionId: options.sessionId });
}

/**
 * Print the legs walked, the gaps that were not, every turn, and the register lines for the unwitnessed.
 *
 * @param finding what the read found
 * @returns the process exit code — non-zero when a turn is unwitnessed
 */
function printFinding({ finding }: { finding: IntakeFinding }): number {
  const floor = finding.sinceIso === undefined ? "the whole chain" : `turns since ${finding.sinceIso}`;
  logger.out({
    line: `${String(finding.legs.length)} supervisor session(s), ${floor}: ${String(finding.turns.length)} owner turn(s)`,
  });
  finding.legs.forEach((leg) => {
    logger.out({ line: legLine({ leg }) });
  });
  finding.coverage.unreadable.forEach((gap) => {
    logger.error({ msg: `  UNREADABLE ${gap.claudeSessionId}: ${gap.why}` });
  });
  finding.turns.forEach((item) => {
    logger.out({ line: turnLine({ item }) });
  });
  if (finding.unwitnessed.length === 0) {
    return EXIT_OK;
  }
  logger.out({ line: "" });
  logger.out({ line: "witness each one with a row (the line below), a settlement, or `supervisor intake-mark`:" });
  finding.unwitnessed.forEach((turn) => {
    logger.out({ line: `  ${registerCommandFor({ turn })}` });
  });
  return EXIT_ERROR;
}

export const supervisorIntakeCommand = defineCommand({ run: runIntake });
