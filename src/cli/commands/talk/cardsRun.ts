/**
 * `slopweaver talk land`, `talk cards` and `talk restore` — the card-landing ledger's three verbs.
 *
 * - **`talk land`** is how a SESSION closes a second card. When a steer on one thing also
 *   answers another thing, both close. The transcript lands their words on the card they had open; a session that
 *   finds the same words answer another card lands them there too, under the SAME anchor, words and instant, so
 *   both cards point at one utterance and, for every non-ask card, one work row.
 * - **`talk cards`** prints the landings still holding a card off their queue, the Queue walk's moves holding one off
 *   (`src/talk/cardMoveLedger.ts`), and every ledger line that would not read. The console reads its `--json` to stop drawing those cards (`site/lib/cardLandings.ts`).
 * - **`talk restore`** puts a card back: a general remark said with a card open pulled it, which is the trade
 *   accepted: every word said with a card open lands on it.
 *
 * `talk relay` lands through `./relayCardLand.ts`, which reads first whether their words belong on the card at all. The
 * writes are `./cardLandApply.ts`; the ledger, `src/talk/cardLandingStore.ts`.
 */
import { logger } from "../../../lib/logger.js";
import { callTouchedByTestInstance } from "../../../talk/callOrigin.js";
import { readCallEntries } from "../../../talk/callStore.js";
import { carries } from "../../../talk/cardLanding.js";
import { announceCardLanding, readCardLandings } from "../../../talk/cardLandingStore.js";
import { activeCardMoves } from "../../../talk/cardMoveLedger.js";
import { readCardMoves } from "../../../talk/cardMoveStore.js";
import { closedCardUtterances } from "../../../talk/cardUtterance.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_DEFERRED, EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { talkHomeOf } from "./args.js";
import { type LandArgs, parseCardsArgs, parseLandArgs, parseRestoreArgs } from "./cardArgs.js";
import { type LandCardOutcome, landCard } from "./cardLandApply.js";
import { type AskRestore, restoreCard } from "./cardRestoreApply.js";
import { landingsWithIntake } from "./cardsIntakeRead.js";
import { cardsTextLines } from "./cardsText.js";
import { TALK_CARDS_USAGE, TALK_LAND_USAGE, TALK_RESTORE_USAGE } from "./usage.js";

/** How many argv entries precede a verb's own flags: `[node, bin, "talk", <verb>, ...]`. */
const VERB_ARG_OFFSET = 4;

/** Print a parse's usage problems and the usage line. */
function refuseUsage({ problems, usage }: { problems: readonly string[]; usage: string }): number {
  problems.forEach((message) => {
    logger.error({ msg: message });
  });
  logger.error({ msg: usage });
  return EXIT_USAGE;
}

/** Say a failed write, on stderr and — under `--json` — as the one stdout line. */
function refuseWrite({
  verb,
  code,
  message,
  json,
}: {
  verb: string;
  code: string;
  message: string;
  json: boolean;
}): number {
  logger.error({ msg: `talk ${verb}: ${message}` });
  if (json) {
    logger.out({ line: JSON.stringify({ code, ok: false, why: message }) });
  }
  return EXIT_ERROR;
}

/** A call segment anchor: the call id, then the segment. */
const CALL_ANCHOR = /^call:([^#]+)#/u;

/** What the call file holds for a call anchor's utterance. */
interface CallSaid {
  readonly words: string;
  readonly decidedIso: string;
  /** A stretch of it the call never finished, or one it capped (`../../../talk/cardUtterance.ts`). */
  readonly wordsCut: boolean;
}

/**
 * What the call file knows of the utterance a call anchor names: the anchors its later segments carry and the relays
 * that carried it. A session landing a second card then finds the row a transcript landing already wrote under a
 * later segment, rather than registering a second one for the same words. A call anchor naming no
 * utterance on file is PENDING, never an empty list: its segment has not reached the file yet — a keepalive can land a
 * later one first — and landing it blind would register a row beside the one that later segment's landing wrote.
 * The anchor may be any of the utterance's segments, since a landing made before its first segment
 * arrived carries a later one.
 *
 * @param anchor the anchor `talk land` was given, a call segment or anything else
 * @param home the Slopweaver home
 * @returns the other anchors, the relays and what they said, empty for an anchor that is not a call's, or why a call's is
 * not on file, or why it is refused as a test-instance call
 */
function utteranceOnFile({ anchor, home }: { anchor: string; home: string }):
  | {
      readonly kind: "found";
      readonly laterAnchors: readonly string[];
      readonly relayTurns: readonly string[];
      /**
       * What they said, when they began and whether the call cut the words short, for a call anchor: the call file, not the
       * session, is their authority.
       */
      readonly said: CallSaid | undefined;
    }
  | { readonly kind: "pending"; readonly why: string }
  | { readonly kind: "refused"; readonly why: string } {
  const callId = CALL_ANCHOR.exec(anchor)?.[1];
  if (callId === undefined) {
    return { kind: "found", laterAnchors: [], relayTurns: [], said: undefined };
  }
  const entries = readCallEntries({ callId, home });
  if (entries.isErr()) {
    return { kind: "pending", why: `call ${callId} could not be read: ${entries.error.message}` };
  }
  // A test-instance call is never their words, so no card lands from it, by hand or from a transcript.
  if (callTouchedByTestInstance({ entries: entries.value })) {
    return { kind: "refused", why: `call ${callId} was placed by the desktop test instance — its words are not their` };
  }
  const found = closedCardUtterances({ callId, ended: true, entries: entries.value }).find(
    (utterance) => utterance.anchor === anchor || utterance.laterAnchors.includes(anchor),
  );
  if (found === undefined) {
    return {
      kind: "pending",
      why: `call ${callId} holds no utterance with ${anchor} yet — run this again once it does`,
    };
  }
  const anchors = [found.anchor, ...found.laterAnchors].filter((one) => one !== anchor);
  const said = { decidedIso: found.decidedIso, words: found.words, wordsCut: found.wordsCut };
  return { kind: "found", laterAnchors: anchors, relayTurns: found.relayTurns, said };
}

/**
 * The words and instant a session's landing writes. For a call anchor they are what the call file holds — the whole
 * utterance and when they began it — and words that are not a whole-word run of it are refused: a ruling or a dispatch
 * row carries what they said, never what a session wrote under their anchor. Any other anchor is the
 * session's own, and so are its words.
 *
 * @param said what the call file holds for the anchor, when it is a call's
 * @returns the words and instant to land, with whether the call cut them (unknown for a session's own anchor), or why
 *   the session's words are not theirs
 */
function landedSaying({ decidedIso, said, words }: { decidedIso: string; said: CallSaid | undefined; words: string }):
  | {
      readonly kind: "land";
      readonly words: string;
      readonly decidedIso: string;
      readonly wordsCut: boolean | undefined;
    }
  | { readonly kind: "refused"; readonly why: string } {
  if (said === undefined) {
    return { decidedIso, kind: "land", words, wordsCut: undefined };
  }
  if (!carries({ landed: said.words, words })) {
    return {
      kind: "refused",
      why: `they said "${said.words}" there, which does not hold "${words}" — pass the words they said`,
    };
  }
  return { decidedIso: said.decidedIso, kind: "land", words: said.words, wordsCut: said.wordsCut };
}

/**
 * Run the `talk land` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTalkLand(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_LAND_USAGE });
    return EXIT_OK;
  }
  const parsed = parseLandArgs({ rest });
  if (parsed.isErr()) {
    return refuseUsage({ problems: parsed.error, usage: TALK_LAND_USAGE });
  }
  const args = parsed.value;
  const home = talkHomeOf({ home: args.home });
  // Announced before the call is read and withdrawn after the landing, so a fence binding the owner's words waits for
  // this whole read-resolve-write, not only its wait for the ledger's lock (`src/talk/writerRunIntent.ts`).
  const announced = announceCardLanding({ home });
  if (announced.isErr()) {
    return refuseWrite({ code: announced.error.code, json: args.json, message: announced.error.message, verb: "land" });
  }
  try {
    return await landOnFile({ args, home });
  } finally {
    announced.value();
  }
}

/**
 * Read the anchor's words off the call, when it is a call's, and land them, the run already announced.
 *
 * @param args the parsed flags
 * @param home the home the landing writes
 * @returns the process exit code
 */
async function landOnFile({ args, home }: { args: LandArgs; home: string }): Promise<number> {
  const onFile = utteranceOnFile({ anchor: args.anchor, home });
  if (onFile.kind === "pending") {
    refuseWrite({ code: "UTTERANCE_PENDING", json: args.json, message: onFile.why, verb: "land" });
    return EXIT_DEFERRED;
  }
  if (onFile.kind === "refused") {
    return refuseWrite({ code: "TEST_INSTANCE_CALL", json: args.json, message: onFile.why, verb: "land" });
  }
  const saying = landedSaying({ decidedIso: args.decidedIso, said: onFile.said, words: args.words });
  if (saying.kind === "refused") {
    return refuseWrite({ code: "UTTERANCE_MISMATCH", json: args.json, message: saying.why, verb: "land" });
  }
  const landed = await landCard({
    input: {
      anchor: args.anchor,
      cardKey: args.card,
      decidedIso: saying.decidedIso,
      handoverDir: resolveHandoverDir({ dir: args.dir, home }),
      home,
      nowIso: new Date().toISOString(),
      laterAnchors: onFile.laterAnchors,
      relayTurns: onFile.relayTurns,
      source: "session",
      words: saying.words,
      wordsCut: saying.wordsCut,
      // No page placement here: its dispatch row prints the `handover set-workspace` line to run.
      workspace: undefined,
    },
  });
  if (landed.isErr()) {
    return refuseWrite({ code: landed.error.code, json: args.json, message: landed.error.message, verb: "land" });
  }
  return reportLanded({ json: args.json, landed: landed.value });
}

/**
 * Print what `talk land` landed, and exit non-zero when a steer or quote did not reach the card.
 *
 * @param landed what `landCard` reports
 * @param json whether the report is one JSON line
 * @returns the process exit code
 */
function reportLanded({ landed, json }: { landed: LandCardOutcome; json: boolean }): number {
  const { landing, outcome, unquoted } = landed;
  // The ruling stands, but a steer or quote that did not reach the card is reported and exits non-zero: landing the
  // same words again relates it.
  unquoted.forEach((problem) => {
    logger.error({ msg: `talk land: ${problem}` });
  });
  const exit = unquoted.length === 0 ? EXIT_OK : EXIT_ERROR;
  // `handover register` prints its own lines, so under `--json` the report is the LAST stdout line.
  if (json) {
    logger.out({ line: JSON.stringify({ landing, ok: unquoted.length === 0, outcome, unquoted }) });
    return exit;
  }
  logger.out({
    line:
      outcome === "landed"
        ? `talk land: ${landing.cardKey} is off their queue — the work is ${landing.workSlug}`
        : `talk land: ${landing.anchor} was already landed on ${landing.cardKey} (work ${landing.workSlug})`,
  });
  return exit;
}

/**
 * Run the `talk cards` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkCards(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_CARDS_USAGE });
    return EXIT_OK;
  }
  const parsed = parseCardsArgs({ rest });
  if (parsed.isErr()) {
    return refuseUsage({ problems: parsed.error, usage: TALK_CARDS_USAGE });
  }
  const args = parsed.value;
  const home = talkHomeOf({ home: args.home });
  const read = readCardLandings({ home });
  if (read.isErr()) {
    return refuseWrite({ code: read.error.code, json: args.json, message: read.error.message, verb: "cards" });
  }
  const holding = landingsWithIntake({ home, ledgerRows: read.value.rows });
  if (holding.isErr()) {
    return refuseWrite({ code: holding.error.code, json: args.json, message: holding.error.message, verb: "cards" });
  }
  const walked = readCardMoves({ home });
  if (walked.isErr()) {
    return refuseWrite({ code: walked.error.code, json: args.json, message: walked.error.message, verb: "cards" });
  }
  const { intakeGaps, landings, triageUnreadable } = holding.value;
  const { unreadable, unreadableLines } = read.value;
  // The Queue walk's moves hold a card off too, in their own list: a move carries no work row.
  const moves = activeCardMoves({ landings: read.value.rows, moves: walked.value.rows });
  if (args.json) {
    // Each refused line with the card key and instant it recorded, so a surface reading one card judges the gap for
    // that card alone (`site/lib/cardLandings.ts` `spokenGap`).
    const payload = {
      intakeGaps,
      landings,
      moves,
      movesUnreadable: walked.value.unreadable,
      movesUnreadableLines: walked.value.unreadableLines,
      observedAtIso: new Date().toISOString(),
      ok: true,
      triageUnreadable,
      unreadable,
      unreadableLines,
    };
    logger.out({ line: JSON.stringify(payload) });
    return EXIT_OK;
  }
  cardsTextLines({
    intakeGaps,
    landings,
    ledgers: [
      { lines: unreadableLines, path: read.value.path },
      { lines: walked.value.unreadableLines, path: walked.value.path },
    ],
    moves,
    triageUnreadable,
  }).forEach((line) => {
    logger.out({ line });
  });
  return EXIT_OK;
}

/**
 * Run the `talk restore` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runTalkRestore(argv: readonly string[]): number {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_RESTORE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseRestoreArgs({ rest });
  if (parsed.isErr()) {
    return refuseUsage({ problems: parsed.error, usage: TALK_RESTORE_USAGE });
  }
  const args = parsed.value;
  const restored = restoreCard({
    input: {
      anchor: args.anchor,
      cardKey: args.card,
      home: talkHomeOf({ home: args.home }),
      nowIso: new Date().toISOString(),
      why: args.why,
    },
  });
  if (restored.isErr()) {
    return refuseWrite({
      code: restored.error.code,
      json: args.json,
      message: restored.error.message,
      verb: "restore",
    });
  }
  const { ask, lifted, movesLifted } = restored.value;
  if (args.json) {
    logger.out({ line: JSON.stringify({ lifted, movesLifted, ok: true, ...(ask === undefined ? {} : { ask }) }) });
    return EXIT_OK;
  }
  logger.out({ line: restoreLine({ ask, card: args.card, lifted, movesLifted }) });
  return EXIT_OK;
}

/**
 * What `talk restore` says it did, and only that: the landing no longer holds the card off their queue. Whether the
 * card is still there is its own register's to say — a hand step settled since is gone either way — so only an
 * ask, whose question this verb itself reads, is said to be waiting on them.
 *
 * @param ask what became of an ask's question, `undefined` for any other card
 * @param lifted how many landings were lifted
 * @param movesLifted how many Queue-walk moves were lifted with them
 * @returns the line
 */
function restoreLine({
  ask,
  card,
  lifted,
  movesLifted,
}: {
  ask: AskRestore | undefined;
  card: string;
  lifted: number;
  movesLifted: number;
}): string {
  const moved = movesLifted === 0 ? "" : ` and ${String(movesLifted)} Queue-walk move(s)`;
  const head = `talk restore: ${String(lifted)} landing(s)${moved} on ${card} lifted`;
  if (ask === undefined) {
    return `${head}; their words no longer hold it off their queue`;
  }
  if (ask.kind === "still-asked") {
    return `${head}; its question waits on them`;
  }
  if (ask.kind === "re-asked") {
    return `${head}; its question is asked again and waits on them`;
  }
  if (ask.kind === "ruled-elsewhere") {
    return `${head}, but it stays answered: its newest ruling is ${ask.anchor}, not these words`;
  }
  return `${head}, but it stays off their queue: the row is ${ask.disposition}`;
}

export const talkLandCommand = defineCommand({ run: runTalkLand });
export const talkCardsCommand = defineCommand({ run: runTalkCards });
export const talkRestoreCommand = defineCommand({ run: runTalkRestore });
