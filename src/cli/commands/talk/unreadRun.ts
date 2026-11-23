/**
 * `slopweaver talk unread` — every word they spoke on a console-voice call that a named reader has not yet read,
 * relayed or not, and with `--mark` the record that it now has.
 *
 * Every word of the owner's transcripts with the voice is seen by the supervisor, with no way for one to slip past
 * unread. The supervisor's sweep runs this every tick; most ticks it
 * prints one line saying nothing is new. Reading never moves the cursor. `--mark` reads again, PRINTS everything it
 * is about to record as read, and only then writes — so a word that landed between the chair's read and its mark is
 * on the chair's screen before it is counted, never counted unseen. What one invocation prints is a BATCH that fits
 * whole in a tool result (`src/talk/unreadBatch.ts`), measured on the very text printed (`./unreadReport.ts`).
 * `supervisor tick-record` refuses a tick while any word is unread
 * (`src/supervisor/voiceUnreadGate.ts`).
 */
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { logger } from "../../../lib/logger.js";
import { ok, type Result } from "../../../lib/result.js";
import { readUnreadAnswerContexts } from "../../../talk/answerContextRead.js";
import type { HeldRelay } from "../../../talk/chairWake.js";
import { heldRelays } from "../../../talk/relayCourier.js";
import { unreadCursorPath, writeUnreadCursorIfUnmoved } from "../../../talk/unreadCursorStore.js";
import type { UnreadError } from "../../../talk/unreadErrors.js";
import { readUnread } from "../../../talk/unreadRead.js";
import { advancedCursor, selectUnreadWords } from "../../../talk/unreadWords.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { talkHomeOf } from "./args.js";
import { parseUnreadArgs, type UnreadArgs } from "./callArgs.js";
import { fitsHost, hiddenPhrase, type ResolvedRead, resolveBatch, unreadOutput } from "./unreadReport.js";
import { TALK_UNREAD_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "unread", ...]`. */
const VERB_ARG_OFFSET = 4;

/** Said, with nothing printed or recorded, when even the smallest report a mark could print would not fit. */
const OVERSIZE_REFUSAL =
  "this report would not print whole within a batch even at its smallest, so nothing is printed and nothing is " +
  "recorded as read — run it with a shorter --home path, or read without --mark";

/**
 * Whether a mark must be refused: it would pass, unprinted, stretches the first-read window left out, and the chair
 * did not adopt them. Says so, in the four-line shape, when it is.
 *
 * @param args the invocation
 * @param resolved the batch the report printed
 * @returns whether the mark is refused
 */
function markRefused({ args, resolved }: { args: UnreadArgs; resolved: ResolvedRead }): boolean {
  if (!args.mark || args.adopt) {
    return false;
  }
  if (resolved.selection.beforeFloor === 0) {
    return false;
  }
  const detail = hiddenPhrase({ resolved });
  for (const line of hatchRefusalLines({ detail, hatch: hatchFor({ id: "unread-mark-adopt" }) })) {
    logger.error({ msg: line });
  }
  logger.error({ msg: "Or read them first: slopweaver talk unread --all, then slopweaver talk unread --mark --all" });
  return true;
}

/**
 * Where a mark will be written, known BEFORE anything is printed so the report can name it and still be printed
 * before the write — the one order that never records a line as read that the report did not carry.
 *
 * @param args the invocation
 * @param home the Slopweaver home
 * @returns the cursor path when `--mark` was asked, `undefined` when not, or why the name is unusable
 */
function markPath({ args, home }: { args: UnreadArgs; home: string }): Result<string | undefined, UnreadError> {
  if (!args.mark) {
    return ok(undefined);
  }
  return unreadCursorPath({ home, name: args.cursor });
}

/**
 * Write the mark the report already printed, if one was asked.
 *
 * @param args the invocation
 * @param home the Slopweaver home
 * @param nowIso the instant the mark is recorded at
 * @param resolved the batch the report printed
 * @param path where the mark goes, or `undefined` when none was asked
 * @returns whether the verb may go on — `false` when the write failed, said on stderr
 */
function recordMark({
  args,
  home,
  nowIso,
  resolved,
  path,
}: {
  args: UnreadArgs;
  home: string;
  nowIso: string;
  resolved: ResolvedRead;
  path: string | undefined;
}): boolean {
  if (path === undefined) {
    return true;
  }
  const advanced = advancedCursor({ read: resolved.read, recordedAtIso: nowIso });
  // A part moves only its own call, to the line's start with the part recorded, or past the line after the last.
  const { part } = resolved;
  const cursor =
    part === undefined ? advanced : { ...advanced, calls: { ...advanced.calls, [part.callId]: part.frontier } };
  // Compare-and-swap: a cursor that moved since this read (another mark) is refused rather than overwritten with
  // frontiers computed from what it no longer is.
  const stored = writeUnreadCursorIfUnmoved({ cursor, home, name: args.cursor, nowIso, read: resolved.read.cursor });
  if (stored.isErr()) {
    logger.error({ msg: `talk unread: ${stored.error.message} — nothing above is recorded as read` });
    return false;
  }
  return true;
}

/**
 * The relays held for the chair's quiet batch, read without removing anything. A queue that cannot be read is said on
 * stderr and heads no relay: their stretches still print, and a mark still records only their bytes — the relays are
 * named on the board and by `talk log` whether or not this read sees them.
 *
 * @param home the Slopweaver home
 * @returns the held relays, oldest first
 */
function heldForChair({ home }: { home: string }): readonly HeldRelay[] {
  const held = heldRelays({ home });
  if (held.isErr()) {
    logger.error({ msg: `talk unread: the relays held for the chair could not be read — ${held.error.message}` });
    return [];
  }
  // Read only, so nothing is pruned here; the next batch pass takes each out of the queue and says so again.
  for (const dropped of held.value.dropped) {
    logger.error({ msg: `talk unread: courier request ${dropped.turnId} is no held relay — ${dropped.detail}` });
  }
  return held.value.held;
}

/**
 * Print the report's lines that come before any mark is written.
 *
 * @param output the report as built
 */
function printBefore({ output }: { output: { readonly before: readonly string[] } }): void {
  for (const line of output.before) {
    logger.out({ line });
  }
}

/**
 * Run the `talk unread` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkUnread(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_UNREAD_USAGE });
    return EXIT_OK;
  }
  const parsed = parseUnreadArgs({ rest });
  if (parsed.isErr()) {
    logger.error({ msg: parsed.error.message });
    logger.error({ msg: TALK_UNREAD_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = talkHomeOf({ home: args.home });
  const nowIso = new Date(args.now === undefined ? Date.now() : Date.parse(args.now)).toISOString();
  const read = readUnread({ all: args.all, home, name: args.cursor, nowIso });
  if (read.isErr()) {
    logger.error({ msg: `talk unread: ${read.error.message}` });
    return EXIT_ERROR;
  }
  const path = markPath({ args, home });
  if (path.isErr()) {
    logger.error({ msg: `talk unread: ${path.error.message}` });
    return EXIT_ERROR;
  }
  // What each stretch answered, read once over everything unread and beside the cursor, never through it: the batch
  // sizes on the printed text, so its lines count, and a mark still records only the bytes the read passed.
  const answers = readUnreadAnswerContexts({ home, words: selectUnreadWords({ read: read.value }).words });
  const resolved = resolveBatch({
    answers,
    args,
    nowIso,
    read: read.value,
    relays: heldForChair({ home }),
    written: path.value,
  });
  return printAndMark({ args, home, nowIso, path: path.value, resolved });
}

/**
 * Print one read's report and, when asked, record its mark — the report first, so one that cannot be built or printed
 * records nothing.
 *
 * @param args the parsed invocation
 * @param home the state home
 * @param nowIso the instant the read was judged at
 * @param path where the mark is written, or `undefined` for a read that writes none
 * @param resolved the batch this read prints
 * @returns the process exit code
 */
function printAndMark({
  args,
  home,
  nowIso,
  path,
  resolved,
}: {
  args: UnreadArgs;
  home: string;
  nowIso: string;
  path: string | undefined;
  resolved: ResolvedRead;
}): number {
  const output = unreadOutput({ args, nowIso, resolved, written: path });
  // The batch is sized to fit, but what frames it — the cursor, the home path — is not the batch's to size, so a
  // mark is refused outright when the exact output would still not print whole.
  if (args.mark && !fitsHost({ output })) {
    logger.error({ msg: `talk unread: ${OVERSIZE_REFUSAL}` });
    return EXIT_ERROR;
  }
  // Printed BEFORE the mark is written, in both shapes: a report that cannot be built or printed throws here and
  // records nothing: serialising first keeps `--json` from writing before it can print. A refused mark's report
  // is printed as text, since it shows what the refusal is about; as JSON it would name a mark never written.
  if (!args.json) {
    printBefore({ output });
  }
  if (markRefused({ args, resolved })) {
    return EXIT_ERROR;
  }
  if (args.json) {
    printBefore({ output });
  }
  if (!recordMark({ args, home, nowIso, path, resolved })) {
    return EXIT_ERROR;
  }
  if (output.after !== undefined) {
    logger.out({ line: output.after });
  }
  return EXIT_OK;
}

export const talkUnreadCommand = defineCommand({ run: runTalkUnread });
