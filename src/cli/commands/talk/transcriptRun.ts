/**
 * `slopweaver talk transcript` — append a batch of a console-voice call's lines to that call's file under the home.
 * The console's `/api/talk/transcript` route runs it as the call goes, so a dropped call or a reloaded page still
 * leaves their words on disk. What a line may say is `src/talk/callRecord.ts`; where it lands, `src/talk/callStore.ts`.
 * The route pipes the batch on stdin (`--entries-file -`) and the verb masks every secret in it before the append
 * (`./transcriptBatch.ts`, `src/talk/callSanitise.ts`), so no credential a tool answer carried reaches the file.
 *
 * ## Then it lands every finished utterance on the card it was said over
 *
 * Every word the owner says while a card is open lands on that card — a card THEY opened: words
 * over one the voice's `open_card` put in front of them are not landed. Narrowed: only words a relay recorded the voice judging an answer to that card, never on
 * a hand step, never greeting or filler alone (`transcriptCardUtterances`). After the append the verb re-reads the whole call, cuts out every utterance that
 * is finished (`src/talk/cardUtterance.ts`) and lands each one (`./cardLandApply.ts`). Every batch re-derives every utterance, and a landing is idempotent
 * on its utterance and card, so a batch that failed to land is finished by the next one. A landing that fails is
 * reported and never fails the append: their words are on disk either way, which is what this verb is for.
 *
 * ## A call's open line finishes every call before it that did not land
 *
 * A call the page lost writes no close line, so its last utterance never proves itself finished, and a call that
 * closed while a relay was still sending holds that utterance for the relay's row. And a call whose last batch
 * failed to land — the ledger lock held past its wait, a board write refused — has no next batch to finish it.
 * So when a batch carries a call's open line, every other call on disk with a finished utterance
 * the ledger does not already hold (`repeatLanding`) is landed — as ended when `unfinishedBefore` reads it as
 * unfinished (`src/talk/cardUtterance.ts` § A call that dropped) — however long ago it happened. Every call, not a
 * recent window: a window leaves a drop before a longer gap unlanded for good, and the whole directory is small — 21
 * files, 2.1M (`ls ~/.slopweaver/talk/calls | wc -l; du -sh ~/.slopweaver/talk/calls`) — read
 * once per call, at its open line, against one read of the ledger; only a call with something to land takes the
 * ledger's lock. A sweep that fails — the board refusing across the open line too — marks one owed, and every later
 * batch sweeps again until one lands everything (`src/talk/sweepOwed.ts`). The residue, stated: an
 * utterance whose card can never take it — an ask deleted outright — is retried, and reported, at every open line
 * and, while that leaves a sweep owed, at every batch.
 *
 * The sweep reads what is on disk when the open line lands, so a dropped call's last batch still in flight then
 * lands AFTER it. So a batch for a call is landed as ended whenever a call the index records after it
 * (`src/talk/callStore.ts`'s `callIndexPath`) opened after its last line. The index is in ARRIVAL order, so a
 * dropped call whose only batch arrived after the next call's first one is indexed after it; the call
 * indexed most recently before it is read too, being the one that would have opened next. So a batch of the call
 * they are on reads the index and the call before it, and nothing else.
 */
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { CallOrigin } from "../../../talk/callOrigin.js";
import { type CallEntry, callActivity } from "../../../talk/callRecord.js";
import type { SanitisedCallBatch } from "../../../talk/callSanitise.js";
import type { CallSanitiseError } from "../../../talk/callSanitiseErrors.js";
import { allCallIds, appendCallEntries, callWrittenSince, readCallEntries } from "../../../talk/callStore.js";
import { repeatLanding } from "../../../talk/cardLanding.js";
import { readCardLandings } from "../../../talk/cardLandingStore.js";
import { transcriptCardUtterances, unfinishedBefore } from "../../../talk/cardUtterance.js";
import type { TalkError } from "../../../talk/errors.js";
import { clearSweepOwed, markSweepOwed, sweepOwedMarks } from "../../../talk/sweepOwed.js";
import type { UnreadError } from "../../../talk/unreadErrors.js";
import { indexedCalls } from "../../../talk/unreadRead.js";
import { announceTranscriptRun } from "../../../talk/writerRunIntent.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHandoverDir } from "../handover/commandSupport.js";
import { talkHomeOf } from "./args.js";
import { parseTranscriptArgs, type TranscriptArgs } from "./callArgs.js";
import { movesOwed } from "./cardMoveApply.js";
import { transcriptConsoleGate } from "./consoleOrigin.js";
import { maskedBatch } from "./transcriptBatch.js";
import { type Landings, landCall } from "./transcriptLand.js";
import { TALK_TRANSCRIPT_USAGE } from "./usage.js";

/** How many argv entries precede the verb's own flags: `[node, bin, "talk", "transcript", ...]`. */
const VERB_ARG_OFFSET = 4;

// How far ahead of this machine's clock the sink can stamp a line: it stamps each a millisecond after the last, so a
// burst runs ahead by one millisecond a line. A minute is far past any burst the page queues (2000 lines at most).
// Residue, stated: a wall clock set back by more than this between a dropped call and the next leaves a
// file written before that correction reading as older than the dropped call's lines, so its late batch is not seen
// overtaken, and its last words land at the following call's open line, which sweeps every call file by its lines.
const STAMP_SLACK_MS = 60_000;

/**
 * Run the `talk transcript` verb.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runTalkTranscript(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: TALK_TRANSCRIPT_USAGE });
    return EXIT_OK;
  }
  const parsed = parseTranscriptArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((message) => {
      logger.error({ msg: message });
    });
    logger.error({ msg: TALK_TRANSCRIPT_USAGE });
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const home = talkHomeOf({ home: args.home });
  const handoverDir = resolveHandoverDir({ dir: args.dir, home });
  const gate = transcriptConsoleGate({ consoleOrigin: args.consoleOrigin, handoverDir, home });
  if (gate.isErr()) {
    logger.error({ msg: gate.error });
    return EXIT_USAGE;
  }
  // Announced before the batch is even read and withdrawn after its last landing, so a fence binding the owner's words waits
  // for this whole run rather than only its wait for a lock (`src/talk/writerRunIntent.ts`).
  const announced = announceTranscriptRun({ callId: args.call, handoff: args.handoff, home });
  if (announced.isErr()) {
    const exit = announced.error.code === "CALL_INVALID" ? EXIT_USAGE : EXIT_ERROR;
    return appendRefused({ error: announced.error, exit, json: args.json });
  }
  try {
    return await transcribe({ args, handoverDir, home, origin: gate.value });
  } finally {
    announced.value();
  }
}

/**
 * Mask, append and land one batch, its run already announced.
 *
 * @param args the parsed flags
 * @param handoverDir the handover directory a landing writes
 * @param home the home the batch lands in
 * @param origin the console the batch came from, `undefined` on a hand run
 * @returns the process exit code
 */
async function transcribe({
  args,
  handoverDir,
  home,
  origin,
}: {
  args: TranscriptArgs;
  handoverDir: string;
  home: string;
  origin: CallOrigin | undefined;
}): Promise<number> {
  const sanitised = await maskedBatch({ entriesFile: args.entriesFile, home, origin });
  if (sanitised.isErr()) {
    return appendRefused({ error: sanitised.error.error, exit: sanitised.error.exit, json: args.json });
  }
  const { entries, denylist } = sanitised.value;
  // The origin rides into the append, which judges where a foreign console's lines would sit under the call's lock; the
  // denylist too, so the store judges the batch once more as stamped, a field it adds included.
  const appended = appendCallEntries({
    callId: args.call,
    entries,
    home,
    secretGuard: { denylist },
    ...(origin === undefined ? {} : { origin }),
  });
  if (appended.isErr()) {
    // A call id that names no call, a call whose loss is quarantined, or a batch refused for where it would sit, is
    // refused for good; only a failed append is worth posting again.
    const refusedForGood = ["CALL_INVALID", "CALL_ORIGIN_UNOPENED", "CALL_QUARANTINED"].includes(appended.error.code);
    return appendRefused({ error: appended.error, exit: refusedForGood ? EXIT_USAGE : EXIT_ERROR, json: args.json });
  }
  // The desktop test instance's speech is a walk's own, never theirs: it lands on no card and sweeps none of their calls.
  let landings: Landings = { failed: [], landed: 0 };
  if (origin?.instance !== "e2e") {
    landings = await landAfterAppend({ batch: entries, callId: args.call, handoverDir, home });
  }
  reportAppended({ appended: appended.value, json: args.json, landings, sanitised: sanitised.value });
  return EXIT_OK;
}

/**
 * Say what an appended batch did: each landing that failed, then the count, as JSON or a line.
 *
 * @param appended the file written and how many lines went in
 * @param landings how many utterances landed, and each that failed
 * @param sanitised what masking did to the batch: secrets masked per label, tool answers the masks grew past the cap
 * @param json whether to print JSON
 */
function reportAppended({
  appended,
  landings,
  sanitised,
  json,
}: {
  appended: { readonly path: string; readonly appended: number };
  landings: Landings;
  sanitised: SanitisedCallBatch;
  json: boolean;
}): void {
  for (const failure of landings.failed) {
    logger.error({ msg: `talk transcript: their words are on disk, but did not land on ${failure}` });
  }
  const { redactions, toolAnswersDropped } = sanitised;
  if (json) {
    const line = JSON.stringify({
      appended: appended.appended,
      landed: landings.landed,
      landingFailed: landings.failed,
      ok: true,
      redactions,
      toolAnswersDropped,
    });
    logger.out({ line });
    return;
  }
  const masked = redactions.map(({ label, count }) => `${label} ×${String(count)}`).join(", ");
  logger.out({
    line:
      `talk transcript: ${String(appended.appended)} line(s) → ${appended.path}; ` +
      `${String(landings.landed)} utterance(s) landed on a card` +
      (masked === "" ? "" : `; masked ${masked}`) +
      (toolAnswersDropped === 0 ? "" : `; ${String(toolAnswersDropped)} tool answer(s) kept none, masked past the cap`),
  });
}

/**
 * Say a batch that did not go in, and exit with how the route should read it.
 *
 * @param error why it did not go in
 * @param exit `EXIT_USAGE` for a batch refused as malformed, `EXIT_ERROR` for an append that failed
 * @param json whether to print the refusal as JSON too
 * @returns the exit code it was given
 */
function appendRefused({
  error,
  exit,
  json,
}: {
  error: TalkError | CallSanitiseError;
  exit: number;
  json: boolean;
}): number {
  logger.error({ msg: `talk transcript: ${error.message}` });
  if (json) {
    logger.out({ line: JSON.stringify({ code: error.code, ok: false, why: error.message }) });
  }
  return exit;
}

/**
 * Land what one appended batch finished: this call's utterances — as ended when a later call overtook it — and,
 * when the batch opens a call or an earlier landing left a sweep owed (`src/talk/sweepOwed.ts`), every other call
 * with words still to land. Any failure marks a sweep owed; a sweep that lands everything clears the marks it read.
 * A batch of reconnect steps alone says how a reconnect went and nothing about their words, so it lands nothing — not
 * even a landing an earlier batch of the call's own left owed.
 *
 * @param batch the lines just appended
 * @param callId the call they were appended to
 * @returns how many landed just now, and each that failed
 */
async function landAfterAppend({
  batch,
  callId,
  handoverDir,
  home,
}: {
  batch: readonly CallEntry[];
  callId: string;
  handoverDir: string;
  home: string;
}): Promise<Landings> {
  if (callActivity({ entries: batch }).length === 0) {
    return { failed: [], landed: 0 };
  }
  const overtaken = overtakenCall({ callId, home });
  const current = await landCall({ callId, ended: overtaken.unwrapOr(false), handoverDir, home });
  // An unreadable marks directory still owes a sweep; it clears nothing, since it cannot say which marks it saw.
  const marks = sweepOwedMarks({ home });
  const owed = marks.isErr() || marks.value.length > 0;
  const openedIso = sweepFrom({ batch, callId, home, owed });
  let dropped: Landings = { failed: [], landed: 0 };
  if (openedIso !== undefined) {
    dropped = await landEarlierCalls({ callId, handoverDir, home, openedIso });
  }
  const failed = [
    ...overtaken.match(
      () => [],
      (error) => [`whether a later call overtook this one: ${error.message}`],
    ),
    ...current.failed,
    ...dropped.failed,
  ];
  let settled: Result<void, string> = ok(undefined);
  if (failed.length > 0) {
    settled = markSweepOwed({ home });
  } else if (marks.isOk() && marks.value.length > 0 && openedIso !== undefined) {
    settled = clearSweepOwed({ home, marks: marks.value });
  }
  if (settled.isErr()) {
    failed.push(`the sweep a failed landing owes: ${settled.error}`);
  }
  return { failed, landed: current.landed + dropped.landed };
}

/**
 * The open instant the other calls are swept against: this batch's open line, or — while a sweep is owed — this
 * call's own, once it is on disk.
 *
 * @param owed whether a failed landing left a sweep owed
 * @returns the instant, or `undefined` when nothing is swept on this batch
 */
function sweepFrom({
  batch,
  callId,
  home,
  owed,
}: {
  batch: readonly CallEntry[];
  callId: string;
  home: string;
  owed: boolean;
}): string | undefined {
  const opened = batch.find((entry) => entry.kind === "open");
  if (opened !== undefined) {
    return opened.atIso;
  }
  if (!owed) {
    return undefined;
  }
  return readCallEntries({ callId, home })
    .map((lines) => lines.find((line) => line.kind === "open")?.atIso)
    .unwrapOr(undefined);
}

/**
 * Whether another call opened after this call's last line, so this call dropped and a batch of it arriving now is
 * its last. The index is in ARRIVAL order, and batches of several dropped calls can arrive in any order after the
 * next call's, so an earlier-indexed call is a candidate too — but only one whose file was written
 * after this call's last line, which every call that opened after it was ({@link callWrittenSince}); the rest are
 * never read.
 *
 * @param callId the call this batch was appended to
 * @returns whether it was overtaken, or the index or call read that failed
 */
function overtakenCall({ callId, home }: { callId: string; home: string }): Result<boolean, UnreadError | TalkError> {
  const ids = indexedCalls({ home });
  if (ids.isErr()) {
    return err(ids.error);
  }
  const at = ids.value.indexOf(callId);
  if (at === -1) {
    return ok(false);
  }
  const entries = readCallEntries({ callId, home });
  if (entries.isErr()) {
    return err(entries.error);
  }
  // Its last line is its own: a reconnect step written later would move the floor past the call that overtook it.
  const own = callActivity({ entries: entries.value });
  if (own.length === 0) {
    return ok(false);
  }
  const lastMs = Math.max(...own.map((entry) => Date.parse(entry.atIso)));
  const later = ids.value.slice(at + 1).filter((id) => id !== callId);
  const before = ids.value
    .slice(0, at)
    .filter((id) => id !== callId && callWrittenSince({ callId: id, home, sinceMs: lastMs, slackMs: STAMP_SLACK_MS }));
  const candidates = [...new Set([...later, ...before])];
  for (const other of candidates) {
    const opened = readCallEntries({ callId: other, home }).map((lines) => lines.find((line) => line.kind === "open"));
    if (opened.isErr()) {
      return err(opened.error);
    }
    if (opened.value !== undefined && unfinishedBefore({ entries: entries.value, openedIso: opened.value.atIso })) {
      return ok(true);
    }
  }
  return ok(false);
}

/**
 * Land every other call with a finished utterance the ledger does not hold yet: one left unfinished before this one
 * opened — dropped, or closed with a relay still sending — as ended, and one whose landing failed as it stands.
 *
 * @param callId the call now opening, which is not swept
 * @param openedIso its open line's instant
 * @returns how many landed just now across those calls, and each that failed
 */
async function landEarlierCalls({
  callId,
  handoverDir,
  home,
  openedIso,
}: {
  callId: string;
  handoverDir: string;
  home: string;
  openedIso: string;
}): Promise<Landings> {
  const others = allCallIds({ home });
  if (others.isErr()) {
    return { failed: [`a dropped call: ${others.error.message}`], landed: 0 };
  }
  const ledger = readCardLandings({ home });
  if (ledger.isErr()) {
    return { failed: [`a dropped call: ${ledger.error.message}`], landed: 0 };
  }
  const rows = ledger.value.rows;
  let landed = 0;
  const failed: string[] = [];
  for (const other of others.value.filter((id) => id !== callId)) {
    const entries = readCallEntries({ callId: other, home });
    if (entries.isErr()) {
      failed.push(`call ${other}: ${entries.error.message}`);
      continue;
    }
    const ended = unfinishedBefore({ entries: entries.value, openedIso });
    // A move a failed write left owed is pending too, though every word of that call landed.
    const pending =
      transcriptCardUtterances({ callId: other, ended, entries: entries.value }).some(
        (utterance) => repeatLanding({ ...utterance, rows }) === undefined,
      ) || movesOwed({ callId: other, entries: entries.value, home });
    if (!pending) {
      continue;
    }
    const swept = await landCall({ callId: other, ended, handoverDir, home });
    landed += swept.landed;
    failed.push(...swept.failed);
  }
  return { failed, landed };
}

export const talkTranscriptCommand = defineCommand({ run: runTalkTranscript });
