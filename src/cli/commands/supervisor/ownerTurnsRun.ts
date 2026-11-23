/**
 * `slopweaver supervisor owner-turns` — print everything the owner has said to the fleet in a window, one
 * bounded chunk at a time, and record what it printed.
 *
 * ## What this verb is for
 *
 * The owner expects a chair to use good judgement and read everything the owner has said over the last week. Every
 * chair is told to read the owner's turns; none could prove it had, and `../../../supervisor/stateDoc.ts` carries what such an instruction is
 * worth in practice. So this verb DELIVERS them and writes a receipt per turn, and `cmux takeover` refuses
 * to move the pin while any turn in the window has no receipt for the session taking it.
 *
 * ## Two sources, one window
 *
 * The chain read (`../../../supervisor/intakeRead.ts`) walks every transcript that has held the pin and
 * yields the owner's turns inside each chair's own span — including, since
 * `../../../transcripts/queuedTurn.ts` landed, the ones the owner typed MID-TURN, which is where the owner's longest voice
 * dumps live and which no reader in this repository could see before. Beside them, the `### RULINGS` rows of
 * any archived state-doc block touched inside the window: those are the owner's rulings written down as anchored
 * rows, and the state doc's own 24-hour window means a successor never meets them otherwise.
 *
 * A ruling is identified by its WORDS, not its address. Every `state-archive` carries the live RULINGS block into
 * a new file, so one ruling sits at many `ruling:<path>#<line>` pointers: the window keeps one copy, and a ruling
 * receipt carries the hash of the words it printed, so a receipt on any copy reads it
 * (`../../../supervisor/ownerTurnReceipts.ts`'s `collapseRulingCopies`/`readTurnPointers`).
 * Keyed by address alone, a later archive turns an earlier ruling into an unread turn and refuses a
 * takeover over words that chair has already been shown.
 *
 * ## Why it prints in chunks and does not summarise
 *
 * A week of the owner's speech is about 488 KB (`../../../supervisor/ownerTurnReceipts.ts` carries the
 * measurement). Nothing here condenses it: a summary of what the owner wants is precisely the artefact that decays
 * between supervisors, which is the failure the owner named. So it prints the owner's words verbatim, bounded, and the
 * chair runs it until it reports nothing left.
 */
import { slopweaverHome } from "../../../config.js";
import type { IngestError } from "../../../lib/ingestError.js";
import { logger } from "../../../lib/logger.js";
import type { Result } from "../../../lib/result.js";
import {
  appendOwnerTurnReceipts,
  readOwnerTurnReceipts,
  readTurnsShown,
} from "../../../supervisor/ownerTurnReceiptStore.js";
import {
  nextTurnChunk,
  OWNER_TURN_CHUNK_BYTES,
  type OwnerTurnReceipt,
  type ReadableTurn,
  readTurnPointers,
  receiptForTurn,
} from "../../../supervisor/ownerTurnReceipts.js";
import { chairClaudeHome, type OwnerTurnWindow, readOwnerTurnWindow } from "../../../supervisor/ownerTurnWindow.js";
import {
  detectSupervisorSession,
  supervisorSessionProblem,
  type VisibleSupervisorSession,
} from "../../../supervisor/session.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { parseFlagTail, verbTail } from "../../optionParsers.js";

/** How many days of the owner's speech the check covers when the caller names no other number. */
export const OWNER_TURN_WINDOW_DAYS = 7;

export const OWNER_TURNS_USAGE =
  "usage: slopweaver supervisor owner-turns [--days <n>] [--bytes <n>] [--session <id>] [--home <dir>] " +
  "[--now <iso>] [--check] [--json]\n" +
  "\n" +
  "Prints every turn the owner typed into the supervisor chain in the window, oldest first, verbatim and in\n" +
  "bounded chunks, and records one receipt per printed turn against this session. Run it until it reports\n" +
  "nothing left; `slopweaver cmux takeover` refuses to move the pin until it does. `--check` reports what is\n" +
  "unread and prints nothing, so a gate can ask without spending a receipt.\n" +
  "\n" +
  "example: slopweaver supervisor owner-turns";

/** The verb's flag tail. */
export const OWNER_TURNS_FLAG_SPEC = {
  boolean: ["json", "check"],
  value: ["days", "bytes", "session", "home", "now"],
} as const satisfies { boolean: readonly string[]; value: readonly string[] };

/** `--`-prefixed, for the help-truth ratchet. */
export const SUPERVISOR_OWNER_TURNS_FLAG_NAMES: readonly string[] = [
  ...OWNER_TURNS_FLAG_SPEC.value,
  ...OWNER_TURNS_FLAG_SPEC.boolean,
]
  .map((name) => `--${name}`)
  .toSorted();

/** What the gate and the verb both need to know about one session's reading. */
export interface UnreadReport {
  readonly unread: number;
  readonly unreadBytes: number;
  readonly total: number;
  readonly sinceIso: string;
  readonly unreadable: string | undefined;
}

/**
 * What this session has left to read — the question `cmux takeover` asks without spending a receipt.
 *
 * @param home the state home
 * @param nowIso the instant the window is measured back from
 * @param days how many days back to read
 * @param session the session asking, host and id
 * @returns the counts, or why the window could not be read
 */
export function unreadOwnerTurns({
  home,
  nowIso,
  days,
  session,
}: {
  home: string;
  nowIso: string;
  days: number;
  session: VisibleSupervisorSession;
}): UnreadReport {
  const window = readOwnerTurnWindow({ claudeHome: chairClaudeHome(), days, home, nowIso });
  const receipts = readOwnerTurnReceipts({ home });
  const alreadyRead = receipts.isOk()
    ? readTurnPointers({ receipts: receipts.value, session, turns: window.turns })
    : new Set<string>();
  // A zero budget takes nothing, so the chunk IS the remainder — the count without a receipt being spent.
  const chunk = nextTurnChunk({ alreadyRead, budgetBytes: 0, turns: window.turns });
  return {
    sinceIso: window.sinceIso,
    total: window.turns.length,
    unread: chunk.remaining,
    unreadable: firstUnreadable({ receipts, window }),
    unreadBytes: chunk.remainingBytes,
  };
}

/**
 * The state home to read, the instant to measure from, and how many days back — each written as an `if`
 * naming the absent case, because `no-silent-fallback` refuses an operator standing in for one.
 *
 * @param values the parsed flag values
 * @returns the state home
 */
function homeOf({ values }: { values: Readonly<Record<string, string | undefined>> }): string {
  const named = values["home"];
  if (named === undefined) {
    return slopweaverHome();
  }
  return named;
}

/**
 * The instant the window is measured back from.
 *
 * @param values the parsed flag values
 * @returns the caller's `--now`, or the clock
 */
function nowOf({ values }: { values: Readonly<Record<string, string | undefined>> }): string {
  const named = values["now"];
  if (named === undefined) {
    return new Date().toISOString();
  }
  return named;
}

/**
 * How many days back to read. Parsed here so the caller can refuse a value that is not a number.
 *
 * @param values the parsed flag values
 * @returns the caller's `--days`, or {@link OWNER_TURN_WINDOW_DAYS}
 */
function daysOf({ values }: { values: Readonly<Record<string, string | undefined>> }): number {
  const named = values["days"];
  if (named === undefined) {
    return OWNER_TURN_WINDOW_DAYS;
  }
  return Number.parseInt(named, 10);
}

/**
 * How many bytes of the owner's words this call may carry.
 *
 * @param values the parsed flag values
 * @returns the caller's `--bytes`, or {@link OWNER_TURN_CHUNK_BYTES}
 */
function budgetOf({ values }: { values: Readonly<Record<string, string | undefined>> }): number {
  const named = values["bytes"];
  if (named === undefined) {
    return OWNER_TURN_CHUNK_BYTES;
  }
  const parsed = Number.parseInt(named, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return OWNER_TURN_CHUNK_BYTES;
  }
  return parsed;
}

/**
 * Whose reading this run records: the `--session` the caller named, or the visible session it is running inside.
 *
 * `--session <id>` names a CLAUDE session: the window this verb reads is the Claude chain, and a Codex thread's
 * rollout is not read before slice 4b-ii, which qualifies the flag by host. With no flag, the ambient session is
 * whichever visible host this process runs in, and a process carrying neither host's variable, or both, is refused.
 *
 * @param flag the `--session` value, when one was typed
 * @param env the process environment
 * @returns the session, or the refusal naming what is missing
 */
function sessionOf({
  flag,
  env,
}: {
  flag: string | undefined;
  env: Readonly<Record<string, string | undefined>>;
}): VisibleSupervisorSession | { readonly refusal: string } {
  if (flag !== undefined && flag.trim().length > 0) {
    return { host: "claude-code", id: flag };
  }
  const detection = detectSupervisorSession({ env });
  if (detection.kind !== "active") {
    return {
      refusal:
        "supervisor owner-turns: no session id — this verb records what THIS session read, so it needs a visible " +
        `session or an explicit --session <id>: ${supervisorSessionProblem({ detection })}`,
    };
  }
  return detection.session;
}

/**
 * Which of the two reads failed, when one did — named rather than coalesced, because a reader acting on this
 * has to know whether it is the owner's turns or the receipt journal that would not open.
 *
 * @param window the turn read
 * @param receipts the receipt journal read
 * @returns the reason, or `undefined` when both read
 */
function firstUnreadable({
  window,
  receipts,
}: {
  window: OwnerTurnWindow;
  receipts: Result<readonly OwnerTurnReceipt[], IngestError>;
}): string | undefined {
  if (window.unreadable !== undefined) {
    return window.unreadable;
  }
  if (receipts.isErr()) {
    return receipts.error.message;
  }
  return undefined;
}

/** Print one turn the way a chair reads it: addressed, dated, then the owner's words whole. */
function printTurn({ turn }: { turn: ReadableTurn }): void {
  logger.out({ line: "" });
  logger.out({ line: `--- ${turn.instantIso} · ${turn.pointer}` });
  logger.out({ line: turn.text });
}

/**
 * Run the verb.
 *
 * @param argv the full process argv
 * @returns the process exit code — non-zero while anything in the window is still unread
 */
export function runSupervisorOwnerTurns(argv: readonly string[]): number {
  const rest = verbTail({ argv, verbs: ["owner-turns"] });
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: OWNER_TURNS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseFlagTail({ rest, spec: OWNER_TURNS_FLAG_SPEC });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: OWNER_TURNS_USAGE });
    return EXIT_USAGE;
  }
  const { values, flags } = parsed.value;
  const home = homeOf({ values });
  const nowIso = nowOf({ values });
  const days = daysOf({ values });
  if (!Number.isFinite(days) || days <= 0) {
    logger.error({ msg: `supervisor owner-turns: --days wants a positive whole number, got "${values["days"]}"` });
    return EXIT_USAGE;
  }
  const session = sessionOf({ env: process.env, flag: values["session"] });
  if ("refusal" in session) {
    logger.error({ msg: session.refusal });
    return EXIT_ERROR;
  }
  return deliver({ check: flags.has("check"), days, home, json: flags.has("json"), nowIso, session, values });
}

/**
 * `--check`: say what is unread and print nothing, so a gate can ask without spending a receipt.
 *
 * @param report what this session has left to read
 * @param jsonLine the machine-readable line naming the session asking, when `--json` asked for it
 * @returns the process exit code — non-zero while anything is unread
 */
function reportOnly({ report, jsonLine }: { report: UnreadReport; jsonLine: string | undefined }): number {
  if (jsonLine !== undefined) {
    logger.out({ line: jsonLine });
  } else {
    logger.out({
      line: `${String(report.unread)} of ${String(report.total)} owner turn(s) since ${report.sinceIso} are unread by this session (${String(report.unreadBytes)} bytes)`,
    });
  }
  return report.unread === 0 ? EXIT_OK : EXIT_ERROR;
}

/** The read, the print and the receipts — split out so the shell above is argument handling alone. */
function deliver({
  home,
  nowIso,
  days,
  session,
  check,
  json,
  values,
}: {
  home: string;
  nowIso: string;
  days: number;
  session: VisibleSupervisorSession;
  check: boolean;
  json: boolean;
  values: Readonly<Record<string, string | undefined>>;
}): number {
  const report = unreadOwnerTurns({ days, home, nowIso, session });
  if (report.unreadable !== undefined) {
    logger.error({ msg: `supervisor owner-turns: ${report.unreadable}` });
    return EXIT_ERROR;
  }
  if (check) {
    const identity = { host: session.host, sessionId: session.id };
    return reportOnly({ jsonLine: json ? JSON.stringify({ ...report, ...identity }) : undefined, report });
  }
  const window = readOwnerTurnWindow({ claudeHome: chairClaudeHome(), days, home, nowIso });
  const chunk = nextTurnChunk({
    alreadyRead: readTurnsShown({ home, session, turns: window.turns }),
    budgetBytes: budgetOf({ values }),
    turns: window.turns,
  });
  if (chunk.turns.length === 0) {
    logger.out({
      line: `supervisor owner-turns: all ${String(window.turns.length)} turn(s) since ${window.sinceIso} are on record as read by this session`,
    });
    return EXIT_OK;
  }
  logger.out({
    line: `supervisor owner-turns: ${String(chunk.turns.length)} turn(s) below, ${String(chunk.remaining)} left after this chunk (${String(chunk.remainingBytes)} bytes) — run this again until none remain`,
  });
  chunk.turns.forEach((turn) => {
    printTurn({ turn });
  });
  const written = appendOwnerTurnReceipts({
    home,
    receipts: chunk.turns.map((turn) => receiptForTurn({ readAtIso: nowIso, session, turn })),
  });
  if (written.isErr()) {
    logger.error({ msg: `supervisor owner-turns: ${written.error.message}` });
    return EXIT_ERROR;
  }
  return chunk.remaining === 0 ? EXIT_OK : EXIT_ERROR;
}

/** `slopweaver supervisor owner-turns`. */
export const supervisorOwnerTurnsCommand = defineCommand({ run: runSupervisorOwnerTurns });
