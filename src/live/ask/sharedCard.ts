/**
 * Whether a progress card is still carried by ANOTHER open ask — the one question every path that deletes or
 * finalises a card has to ask once two asks can share one.
 *
 * Two asks share a card when a sub-ask RIDES its parent's (`../../cli/commands/turn/ensureCard.ts`): the owner's
 * one tag that adds people to the allow-list and asks for one of their questions to be answered is one card in
 * the thread, not two (a double progress post in one bot thread reads as a defect).
 * Sharing makes deletion a question of order. The parent's acknowledgement usually lands while the dispatched
 * sub-answer is still being worked, and the answer path REPLACES the card by deleting it — so without this, the
 * first ask to finish takes the card out from under the one still running. The rule is last one out deletes:
 * a settle over a card another open ask still holds leaves the card alone, and the holder's own settle, later,
 * is the one that removes it.
 *
 * Sharing makes ADVANCING a question of order too: the parent's next tick would repaint
 * the card with its own checklist over the sub-answer's progress, and nothing would have been deleted. So one
 * holder writes at a time — the open ask that attached LAST ({@link cardWriter}) — and when it ends, the pen
 * passes back to the one before it.
 *
 * An ask RELEASES the card when it has ever reached a terminal event, read off the raw history through
 * `terminalAskEventsByKey` rather than the fold's `state` — the same monotonic rule scheduled recovery uses,
 * and for the same reason: a redelivered `captured` appended after an answer must not make a finished ask
 * look open again and strand a card forever. It releases it too while its LATEST event is a failed attempt
 *: a sub-ask whose worker never started, or died, is not terminal — recovery may
 * still pick it up — but nothing is writing for it, so keeping the pen would freeze the parent's progress and
 * block its cleanup. A later `dispatched` or `redispatched` takes the pen back. Recovery reads none of this.
 */
import { readJsonlLines } from "../../corpus/corpusStore.js";
import { logger } from "../../lib/logger.js";
import type { StartedChecklist } from "./checklist.js";
import type { AskIdentity } from "./identity.js";
import {
  type AskLifecycleEvent,
  askLifecycleKey,
  foldAskLifecycle,
  parseAskLifecycleLog,
  terminalAskEventsByKey,
} from "./lifecycle.js";
import { askLifecyclePath } from "./store.js";

/** The event kinds that end one ATTEMPT without ending the ask — nobody is writing for it while one is latest. */
const RELEASING_ATTEMPT_KINDS: ReadonlySet<AskLifecycleEvent["kind"]> = new Set([
  "answer-lost",
  "dispatch-failed",
  "failed",
  "lease-expired",
]);

/**
 * Every ask that holds no card any more: ended ever, or with a failed attempt as its latest event. Pure.
 *
 * @param events the lifecycle log, in file order
 * @returns the lifecycle keys of every ask that has let its card go
 */
export function releasedCardKeys({ events }: { events: readonly AskLifecycleEvent[] }): ReadonlySet<string> {
  const latest = new Map<string, AskLifecycleEvent["kind"]>();
  events.forEach((event) => latest.set(askLifecycleKey({ askIdentity: event }), event.kind));
  const released = new Set(terminalAskEventsByKey({ events }).keys());
  latest.forEach((kind, key) => {
    if (RELEASING_ATTEMPT_KINDS.has(kind)) {
      released.add(key);
    }
  });
  return released;
}

/**
 * Every OTHER ask in the same channel whose card is this one and which has not released it. Pure.
 *
 * @param events the lifecycle log, in file order
 * @param askIdentity the ask settling the card — never counted as its own holder
 * @param workingTs the card's own ts
 * @returns the open asks still holding the card, in fold order; empty when this ask holds it alone
 */
export function otherOpenCardHolders({
  events,
  askIdentity,
  workingTs,
}: {
  events: readonly AskLifecycleEvent[];
  askIdentity: AskIdentity;
  workingTs: string;
}): readonly AskIdentity[] {
  const own = askLifecycleKey({ askIdentity });
  const ended = releasedCardKeys({ events });
  const holders: AskIdentity[] = [];
  foldAskLifecycle({ events }).forEach((lifecycle, key) => {
    if (
      key !== own &&
      lifecycle.channel === askIdentity.channel &&
      lifecycle.started?.workingTs === workingTs &&
      !ended.has(key)
    ) {
      holders.push({ channel: lifecycle.channel, messageTs: lifecycle.messageTs, threadTs: lifecycle.threadTs });
    }
  });
  return holders;
}

/**
 * The ask that may write this card now: of the open asks holding it, the one whose `checklist-posted` for it
 * came LAST in the log. Pure.
 *
 * Attachment order rather than Slack message order, because the parent of a ride is usually the NEWER message
 * (the owner's instruction arrives after the question it authorises answering), while the sub-ask is always
 * the one that attached to its card second.
 *
 * @param events the lifecycle log, in file order
 * @param channel the card's channel
 * @param workingTs the card's own ts
 * @returns the writer's lifecycle key, or `undefined` when no open ask records this card at all
 */
export function cardWriter({
  events,
  channel,
  workingTs,
}: {
  events: readonly AskLifecycleEvent[];
  channel: string;
  workingTs: string;
}): string | undefined {
  const ended = releasedCardKeys({ events });
  // Each ask's CURRENT card, in attachment order — an ask that moved to a card of its own
  // holds its old one no longer, so the pen passes back exactly as if it had ended.
  const current = new Map<string, string>();
  events.forEach((event) => {
    if (event.kind === "checklist-posted" && event.channel === channel) {
      const key = askLifecycleKey({ askIdentity: event });
      current.delete(key);
      current.set(key, event.workingTs);
    }
  });
  let writer: string | undefined;
  current.forEach((ts, key) => {
    if (ts === workingTs && !ended.has(key)) {
      writer = key;
    }
  });
  return writer;
}

/**
 * Whether this ask may write the card — true when it is the {@link cardWriter}, or when no open ask records
 * the card at all (every unshared card, and every card whose ask recorded no `checklist-posted`). Pure.
 *
 * @param events the lifecycle log, in file order
 * @param askIdentity the ask about to write, whose channel is the card's
 * @param workingTs the card's own ts
 * @returns whether the write may go ahead
 */
export function mayWriteCard({
  events,
  askIdentity,
  workingTs,
}: {
  events: readonly AskLifecycleEvent[];
  askIdentity: AskIdentity;
  workingTs: string;
}): boolean {
  const writer = cardWriter({ channel: askIdentity.channel, events, workingTs });
  return writer === undefined || writer === askLifecycleKey({ askIdentity });
}

/**
 * {@link mayWriteCard} over the lifecycle log on disk, logging a skip. It FAILS CLOSED on a log it cannot read
 *: `readAskLifecycleText` (`./store.ts`) reads any read error as an empty log, which here would mean
 * "no holders" and let an older holder repaint a card the last-attached one is writing. An absent log is still
 * empty — a home that never captured an ask has no holders — but any other error skips this tick's write.
 *
 * @param home the state home holding the log
 * @param askIdentity the ask about to write, whose channel is the card's
 * @param workingTs the card's own ts
 * @returns whether the write may go ahead; a refusal is logged, since it is a skip and never a failed write
 */
export function mayWriteCardOnDisk({
  home,
  askIdentity,
  workingTs,
}: {
  home: string;
  askIdentity: AskIdentity;
  workingTs: string;
}): boolean {
  const events = lifecycleEventsOrUnreadable({ home });
  if (events === undefined) {
    logger.warn({ msg: `the ask lifecycle log is unreadable, so this tick leaves card ${workingTs} alone` });
    return false;
  }
  if (mayWriteCard({ askIdentity, events, workingTs })) {
    return true;
  }
  logger.info({ msg: `card ${workingTs} is being written by the ask that rode it, so this tick leaves it alone` });
  return false;
}

/**
 * The lifecycle log's events for a guard that must fail closed, streamed a line at a time.
 *
 * @param home the state home holding the log
 * @returns the log's events, none when there is no log yet, or `undefined` when it exists and cannot be read
 */
function lifecycleEventsOrUnreadable({ home }: { home: string }): readonly AskLifecycleEvent[] | undefined {
  const events: AskLifecycleEvent[] = [];
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        events.push(...parseAskLifecycleLog({ text: line }).events);
      },
      path: askLifecyclePath({ home }),
    });
    return events;
  } catch (error: unknown) {
    const absent = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (absent) {
      return [];
    }
    return undefined;
  }
}

/**
 * {@link otherOpenCardHolders} over the lifecycle log on disk.
 *
 * @param home the state home holding the log
 * @param askIdentity the ask settling the card
 * @param workingTs the card's own ts
 * @returns the open asks still holding the card; empty when this ask holds it alone, `undefined` when the log
 *   exists and cannot be read
 */
function cardHoldersOnDisk({
  home,
  askIdentity,
  workingTs,
}: {
  home: string;
  askIdentity: AskIdentity;
  workingTs: string;
}): readonly AskIdentity[] | undefined {
  const events = lifecycleEventsOrUnreadable({ home });
  if (events === undefined) {
    return undefined;
  }
  return otherOpenCardHolders({ askIdentity, events, workingTs });
}

/** What a sub-ask's card gate should do about the parent it names — ride its card, or post its own, and why. */
export type ParentCard =
  { readonly kind: "ride"; readonly started: StartedChecklist } | { readonly kind: "post"; readonly reason: string };

/**
 * Whether a sub-ask may ride the card of the parent its brief names. Pure.
 *
 * It rides the parent's card whatever state the parent's ask is in, and never judges from the log whether that
 * card still stands: an answered parent may have deleted it, finalised it, or failed to clean it up, and a
 * failed launch deletes nothing (two cards were left standing each time the log was trusted). Slack
 * is the one that knows, so the card gate asks it (`../../cli/commands/turn/ensureCard.ts`) and posts a
 * fresh card only when the ridden one is really gone. Every other case posts the sub-ask's own card and SAYS why, so a second card is never silent. The parent is found
 * by channel and ts and then its thread is compared, because a channel/ts key alone does not prove the two
 * share a thread. The parent's ts is never required to be older: in the observed incident it was the newer one.
 *
 * @param events the lifecycle log, in file order
 * @param askIdentity the sub-ask whose card gate is running
 * @param parentMessageTs the brief's `ridesOn`
 * @returns ride with the parent's card, or post with the reason riding was not possible
 */
export function parentCardFor({
  events,
  askIdentity,
  parentMessageTs,
}: {
  events: readonly AskLifecycleEvent[];
  askIdentity: AskIdentity;
  parentMessageTs: string;
}): ParentCard {
  const parentIdentity = { channel: askIdentity.channel, messageTs: parentMessageTs, threadTs: askIdentity.threadTs };
  const where = `${askIdentity.channel}/${parentMessageTs}`;
  if (parentMessageTs === askIdentity.messageTs) {
    return { kind: "post", reason: `the brief names its own ask ${where} as the one it rides` };
  }
  const parent = foldAskLifecycle({ events }).get(askLifecycleKey({ askIdentity: parentIdentity }));
  if (parent === undefined) {
    return { kind: "post", reason: `the ask it rides, ${where}, was never captured` };
  }
  if (parent.threadTs !== askIdentity.threadTs) {
    return { kind: "post", reason: `the ask it rides, ${where}, is in a different thread` };
  }
  if (parent.started === undefined) {
    return { kind: "post", reason: `the ask it rides, ${where}, has no progress card` };
  }
  return { kind: "ride", started: parent.started };
}

/**
 * {@link parentCardFor} over the lifecycle log on disk.
 *
 * @param home the state home holding the log
 * @param askIdentity the sub-ask whose card gate is running
 * @param parentMessageTs the brief's `ridesOn`
 * @returns ride with the parent's card, or post with the reason riding was not possible
 */
export function parentCardOnDisk({
  home,
  askIdentity,
  parentMessageTs,
}: {
  home: string;
  askIdentity: AskIdentity;
  parentMessageTs: string;
}): ParentCard {
  const events = lifecycleEventsOrUnreadable({ home });
  if (events === undefined) {
    return { kind: "post", reason: "the ask lifecycle log could not be read" };
  }
  return parentCardFor({ askIdentity, events, parentMessageTs });
}

/**
 * Whether ANOTHER open ask still carries this card, in which case this ask's settle must leave it standing —
 * the holder's own settle, later, is the one that removes it. Only a sub-ask that rode its parent's card ever
 * makes this true.
 *
 * Said out loud rather than silently skipped, because a card left standing after its ask answered is exactly
 * what an operator would otherwise go looking for as a stuck-card failure. A log that exists and cannot be read
 * leaves the card standing too: finalising or deleting it then could take it out from
 * under a holder the log would have named, and a card left standing is the recoverable one of the two.
 *
 * @param home the state home holding the log
 * @param askIdentity the ask settling the card
 * @param workingTs the card's own ts
 * @param what which settle is standing down, for the log line
 * @returns true when the card must be left for another holder
 */
export function cardStaysForAnotherAsk({
  home,
  askIdentity,
  workingTs,
  what,
}: {
  home: string;
  askIdentity: AskIdentity;
  workingTs: string;
  what: string;
}): boolean {
  const holders = cardHoldersOnDisk({ askIdentity, home, workingTs });
  if (holders === undefined) {
    logger.warn({
      msg: `the ask lifecycle log is unreadable, so this ask's ${what} leaves card ${workingTs} standing`,
    });
    return true;
  }
  if (holders.length === 0) {
    return false;
  }
  const names = holders.map((holder) => `${holder.channel}/${holder.messageTs}`).join(", ");
  logger.info({ msg: `card ${workingTs} is still carried by ${names}, so this ask's ${what} leaves it standing` });
  return true;
}
