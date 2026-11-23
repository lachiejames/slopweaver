/**
 * EVERY CARD AN ASK PUBLISHED BEFORE ITS ANSWER — what a posted answer reaps.
 *
 * Standing owner rule: once a turn succeeds, everything else it published is deleted, and it is structurally
 * impossible to get that wrong. The test is a reader's: looking at the thread, is anything from the bot
 * irrelevant. MEASURED on `C0SYN000015` ask
 * `1788757965.613679`: a turn the door refused left its checklist (`1788771372.738209`) and its failure card
 * (`1788771383.199079`) standing directly above the answer a later turn posted (`1788772938.886249`) for 22
 * hours, until both were deleted by hand. The later turn only ever knew about its OWN working message.
 *
 * So the question "what did this ask publish" is answered from the two durable records that already hold every
 * such message, never from the turn that happens to be running:
 *
 * - **the completion ledger** (`./completionStore.ts`) — every earlier turn's working checklist, and the notice
 *   a withheld, failed or answer-lost turn posted in place of an answer;
 * - **the ask lifecycle log** (`../ask/store.ts`) — the capture-time checklist, and the in-thread tag a
 *   `turn block` posted while the ask waited on a human.
 *
 * A REAL ANSWER is never a card. Every `answerTs` either record names is excluded outright, so an ask the owner
 * asked to be answered again keeps the earlier answer standing — that is content, not noise.
 *
 * **An answer comes down by SUPERSESSION and by nothing else** (`./supersession/run.ts`, an owner ruling). That path is keyed on the THREAD rather than the ask, needs a `supersedes` the composer declared AND
 * a warrant the reviewer wrote, and is journalled. Nothing about it belongs here: this module's whole
 * criterion is "furniture this ask left behind", and widening it to answers would delete content on the
 * strength of one declaration. `runTurn` runs them in order — reaps first, the supersession last, because the
 * supersession is the only irreversible one.
 *
 * {@link earlierCardsOf} is pure — records in, message refs out; {@link earlierCardsForAsk} is its one reader, and
 * {@link reapEarlierCards} its one effect, through the poster seam.
 */
import type { AskIdentity } from "../ask/identity.js";
import type { AskLifecycleEvent } from "../ask/lifecycle.js";
import { parseAskLifecycleLog } from "../ask/lifecycle.js";
import { readAskLifecycleText } from "../ask/store.js";
import { parseTurnCompletionLog } from "./completionLog.js";
import { readTurnCompletionText } from "./completionStore.js";
import type { TurnCompletion } from "./envelope.js";
import type { PostedRef, TurnPoster } from "./runContract.js";

/** Whether a record belongs to this ask — `(channel, messageTs)`, the key every ask record is folded by. */
function sameAsk({ askIdentity, other }: { askIdentity: AskIdentity; other: AskIdentity }): boolean {
  return other.channel === askIdentity.channel && other.messageTs === askIdentity.messageTs;
}

/** The card timestamps one completion names — its checklist, and any notice — and the answer it protects. */
function completionTsOf({ completion }: { completion: TurnCompletion }): {
  readonly cards: readonly string[];
  readonly answers: readonly string[];
} {
  const primary = completion.primary;
  // A FIRST answer is a real answer too: the plan the worker posted before building stays standing when the
  // final answer reaps, and only its working checklist is furniture.
  if (primary.kind === "answered" || primary.kind === "first-answered") {
    return { answers: [primary.answerTs], cards: [completion.workingTs] };
  }
  if (primary.noticeTs === undefined) {
    return { answers: [], cards: [completion.workingTs] };
  }
  return { answers: [], cards: [completion.workingTs, primary.noticeTs] };
}

/** The card timestamps one lifecycle event names, and the answer timestamps it protects. */
function lifecycleTsOf({ event }: { event: AskLifecycleEvent }): {
  readonly cards: readonly string[];
  readonly answers: readonly string[];
} {
  if (event.kind === "checklist-posted") {
    return { answers: [], cards: [event.workingTs] };
  }
  if (event.kind === "blocked-on-human" && event.tagTs !== undefined) {
    return { answers: [], cards: [event.tagTs] };
  }
  if (event.kind === "answered" || event.kind === "first-answered") {
    return { answers: [event.answerTs], cards: [] };
  }
  // Every other kind posts no message of its own — a sweep or a dispatch edits the capture-time checklist.
  return { answers: [], cards: [] };
}

/**
 * Every message this ask published into its thread that is not a real answer, oldest first.
 *
 * @param askIdentity the ask whose answer just posted
 * @param completions every durable turn completion — filtered to this ask here, so a caller cannot pass the
 *   wrong slice
 * @param askEvents every ask lifecycle event, filtered the same way
 * @returns the cards to reap, deduplicated, in timestamp order
 */
export function earlierCardsOf({
  askIdentity,
  askEvents,
  completions,
}: {
  askIdentity: AskIdentity;
  askEvents: readonly AskLifecycleEvent[];
  completions: readonly TurnCompletion[];
}): readonly PostedRef[] {
  const named = [
    ...completions
      .filter((completion) => sameAsk({ askIdentity, other: completion.askIdentity }))
      .map((completion) => completionTsOf({ completion })),
    ...askEvents.filter((event) => sameAsk({ askIdentity, other: event })).map((event) => lifecycleTsOf({ event })),
  ];
  const answers = new Set(named.flatMap((entry) => entry.answers));
  const cards = new Set(named.flatMap((entry) => entry.cards));
  return [...cards]
    .filter((ts) => !answers.has(ts))
    .toSorted((left, right) => Number(left) - Number(right))
    .map((ts) => ({ channel: askIdentity.channel, ts }));
}

/**
 * Delete every earlier card once this turn's answer has posted, and name each one still standing.
 *
 * Sequential rather than concurrent: a thread's deletes are few, and one-at-a-time keeps the door ledger in the
 * same order a reader scrolling the thread would see them go. This turn's OWN working message and answer are
 * skipped however the caller built `cards` — the first is already settled by the indicator pass, and deleting
 * the second would be the one catastrophic mistake this function could make.
 *
 * @param answerTs this turn's posted answer, never reaped
 * @param cards what {@link earlierCardsOf} named, read before the turn ran
 * @param poster the seam each delete goes through
 * @param workingTs this turn's own working message, already settled
 * @returns one line per card that would not delete, naming where it is — empty when every one went
 */
export async function reapEarlierCards({
  answerTs,
  cards,
  poster,
  workingTs,
}: {
  answerTs: string;
  cards: readonly PostedRef[];
  poster: Pick<TurnPoster, "reapEarlierCard">;
  workingTs: string;
}): Promise<readonly string[]> {
  const stuck: string[] = [];
  for (const card of cards) {
    if (card.ts === answerTs || card.ts === workingTs) {
      continue;
    }
    if (!(await poster.reapEarlierCard({ posted: card }))) {
      stuck.push(
        `an earlier card on this ask in ${card.channel} (ts ${card.ts}) could not be deleted after the answer ` +
          "posted — it still stands above the answer; delete it by hand",
      );
    }
  }
  return stuck;
}

/**
 * Read both durable records under `home` and name every card this ask published.
 *
 * An unreadable line is skipped rather than failing the read, the posture both parsers already hold: a
 * corrupt ledger line must not stop an answer from cleaning up after itself.
 *
 * @param askIdentity the ask whose answer is posting
 * @param home the state home both records live under
 * @returns the cards to reap, oldest first
 */
export function earlierCardsForAsk({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): readonly PostedRef[] {
  return earlierCardsOf({
    askEvents: parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events,
    askIdentity,
    completions: parseTurnCompletionLog({ text: readTurnCompletionText({ home }) }).events.map(
      (event) => event.completion,
    ),
  });
}
