/**
 * The `queue-search` call scenario's witness: the thread really ran `talk find-card` in this conversation, and its
 * answer to the typed question is one word saying what the search returned. Pure; the call store read is
 * `src/cli/commands/desktop/e2eCallEvidenceRead.ts`.
 *
 * The scenario exists because of a TYPED conversation in the orb messenger (`surface: typed`, no voice), where the
 * thread told the owner "The Queue search timed out" after `talk find-card` took 19.7s against the gateway's 16s. So
 * the scenario types into the box with no call up, as the owner does. A tool entry alone cannot prove
 * the search answered — the console records the call, not its result — so the thread is asked to say one word, and a
 * timed-out search can only say FAILED. One that answers without searching leaves no tool entry: measured on the real
 * app, the realtime voice said FOUND a second after a question typed into a CALL, with no search at all. Both halves are positive witnesses: FOUND and NONE both pass, so the board's contents never decide it.
 */
import type { CallRecord } from "../talk/callRecord.js";
import { type E2eRow, turnAndAnswer } from "./e2eCallRows.js";

/** The one word the scenario's question asks the voice to answer with. */
export type E2eQueueSearchAnswer = "FOUND" | "NONE" | "FAILED";

/** What the scenario observed of its search. */
export interface E2eQueueSearchObserved {
  /** The voice's one-word answer after the typed question, `undefined` when it gave none. */
  readonly answer: E2eQueueSearchAnswer | undefined;
  /** The transcript calls of this test instance whose record holds a successful `talk find-card` run. */
  readonly toolCallIds: readonly string[];
}

/**
 * The detail the console writes on the `verb` tool entry of a find-card run, whole
 * (`site/components/voice/talkToolCalls.ts`'s `verbToolDetail`, which leaves the verb's arguments out). Compared
 * whole, so another verb whose name merely starts the same way never stands in for it.
 */
const FIND_CARD_DETAIL = "read slopweaver talk find-card";

/** The words a one-word answer may be. */
const ANSWER_WORDS: readonly E2eQueueSearchAnswer[] = ["FOUND", "NONE", "FAILED"];

/**
 * A voice row's one-word answer: the row is exactly one word, any case, punctuation aside, and that word is one of
 * the three. A sentence never counts, however it reads — "It found some matches" is not FOUND (measured on a real
 * call where the voice had searched the code instead). Only whitespace and punctuation are set aside, so
 * a digit or symbol stays part of its word and `FOUND123` is no answer.
 *
 * @param text the row's words
 * @returns the word, `undefined` for anything but one of the three alone
 */
export function queueSearchAnswerWord({ text }: { text: string }): E2eQueueSearchAnswer | undefined {
  const words = text
    .toUpperCase()
    .split(/[\s\p{P}]+/u)
    .filter((word) => word !== "");
  const [only] = words;
  if (words.length !== 1 || only === undefined) {
    return undefined;
  }
  return ANSWER_WORDS.find((word) => word === only);
}

/**
 * The voice's one-word answer to the typed question: the last row, when it is the voice's and follows the owner's
 * turn that carries the question. An earlier voice row is a preamble ("let me check") and never ends the wait.
 *
 * @param rows the live call's final rows
 * @param ownerText what the question's turn contains: the run's nonce
 * @returns the word, `undefined` while the last row is not one
 */
export function queueSearchAnswerOf({
  rows,
  ownerText,
}: {
  rows: readonly E2eRow[];
  ownerText: string;
}): E2eQueueSearchAnswer | undefined {
  const last = rows.at(-1);
  if (last?.who !== "voice" || !turnAndAnswer({ ownerText, rows }).voiceAnswer) {
    return undefined;
  }
  return queueSearchAnswerWord({ text: last.text });
}

/**
 * How recently an unended typed conversation must have been written to count as the owner's and open. A typed conversation
 * holds no lease and ends only when replaced, when a call starts, or when its page has gone 30s; one whose page
 * vanished with its server can stay unended on disk for good, so recency bounds the wait. A judgement, not a
 * measurement: half an hour idle is a box the owner has walked away from.
 */
export const TYPED_ACTIVE_MS = 30 * 60_000;

/**
 * The typed conversations that look open: unended, among calls already chosen as written within
 * {@link TYPED_ACTIVE_MS}. `queue-search` opens a typed conversation, and a newer one REPLACES an older
 * (`site/lib/talkArbiter.ts`), so it waits until the owner's is not among these rather than end the owner's thread. Recency is the
 * caller's, judged by when each file was WRITTEN, the same clock the read after the send selects by: a line's own
 * stamp can lag its write, and judging the two reads by two clocks lets a record slip between them.
 *
 * @param calls the folded calls written within the window
 * @returns their ids
 */
export function openTypedConversationIds({
  calls,
}: {
  calls: readonly Pick<CallRecord, "callId" | "surface" | "ended">[];
}): readonly string[] {
  return calls.filter((call) => call.surface === "typed" && call.ended === undefined).map((call) => call.callId);
}

/**
 * The calls whose record skipped a line it could not parse. A skipped open line folds a typed conversation as a voice
 * call, so neither the clear read nor the replacement check could see it; both treat one as unreadable instead.
 *
 * @param calls the folded calls read
 * @returns their ids
 */
export function tornCallIds({
  calls,
}: {
  calls: readonly Pick<CallRecord, "callId" | "skipped">[];
}): readonly string[] {
  return calls.filter((call) => call.skipped > 0).map((call) => call.callId);
}

/**
 * The typed conversations beside the test's own, among calls already chosen as written at or after the last read
 * that found none of the owner's open: every typed record, bar the one whose typed turn carries the run's nonce.
 * Nothing makes that read and the press of send one act, so a conversation the owner opens between them is ended by
 * the test's; this names it rather than leave it unseen. It never waits on how that conversation ENDED, because the
 * close line is the owner's page's to write and may never land: being written to since the read is enough, judged by
 * when each file was WRITTEN, never by a line's own stamp, which can lag its write. No instant is taken for
 * the press itself, because the press is an awaited act a stamp could only precede. So a run that
 * disturbed the owner fails as surely as one the owner disturbed, and so does one whose own typed turn never reached
 * the store.
 *
 * @param calls the folded calls written since the read
 * @param ownerText what the test's typed turn contains: the run's nonce
 * @returns their ids
 */
export function typedBesideSinceRead({
  calls,
  ownerText,
}: {
  calls: readonly Pick<CallRecord, "callId" | "surface" | "segments">[];
  ownerText: string;
}): readonly string[] {
  return calls
    .filter(
      (call) =>
        call.surface === "typed" &&
        !call.segments.some((segment) => segment.who === "owner" && segment.text.includes(ownerText)),
    )
    .map((call) => call.callId);
}

/**
 * Whether a folded call record holds a `verb` tool entry that ran `talk find-card` and was not refused.
 *
 * @param call the record, `undefined` when the store holds none for that call
 * @returns whether the search ran
 */
export function queueSearchToolUsed({ call }: { call: Pick<CallRecord, "notes"> | undefined }): boolean {
  if (call === undefined) {
    return false;
  }
  return call.notes.some(
    (note) => note.kind === "tool" && note.name === "verb" && !note.refused && note.detail === FIND_CARD_DETAIL,
  );
}
