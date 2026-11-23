/**
 * Whether one in-thread progress card is GENUINELY ORPHANED — posted for an ask that has since ended, and
 * owned by no writer left on this machine — and so safe to retire by hand.
 *
 * ## How a card is orphaned
 *
 * An ask can carry two `checklist-posted` events: a recovery pass re-captures a live ask and posts a second
 * card while the first still stands. The fold (`./lifecycle.ts`'s `advancedEntry`) keeps only the LATER one as
 * `started`, so `./store.ts`'s `startedRefForAsk` answers the later card, and every writer — the dispatch
 * sweep, `turn status`, `turn watch`, the terminal finaliser — touches that card and only that card. The
 * earlier one is advanced by nothing and finalised by nothing. An `answered` or `satisfied-elsewhere` ending
 * reaps it, because `../turn/earlierCards.ts` names every `checklist-posted` ts; every other ending
 * (`triaged-no-response`, `left-for-a-human`, `withheld`), and an answer whose reap failed, leaves it
 * standing mid-checklist with nothing behind it. Nothing took an explicit card ts to retire one.
 *
 * ## Why the caller names the card, and why the verdict reads raw events
 *
 * `startedRefForAsk` is exactly the wrong input: it names the card that is NOT orphaned. So the card ts is the
 * caller's, and {@link orphanedCardVerdict} decides over the raw event stream — the one record that still
 * remembers every card an ask posted, which the fold has already forgotten.
 *
 * ## Structurally unable to touch a live card
 *
 * Every refusal below names one way a card could still be somebody's, and each is checked against the log
 * rather than trusted from the caller:
 *
 * - the card must be one THIS ask posted (`NOT_THIS_ASKS_CARD`) — never an answer, another ask's card, or any
 *   other message in the workspace;
 * - it must not be the ask's CURRENT card (`CARD_IS_CURRENT`), by the fold's reading or as the last card the raw
 *   log shows it posting — that one belongs to the ask's own terminal path, which already settled it;
 * - the ask must have ENDED (`ASK_NOT_TERMINAL`) — a `failed`, `lease-expired` or `blocked-on-human` ask is not
 *   over, and a re-dispatch may yet pick its card up; nor is a `withheld` one, which the Queue may still release
 *   and `turn watch` keeps ticking over;
 * - nothing may have reopened it since (`ASK_REOPENED`) — no event at all may follow the ending, since even a
 *   redelivered `captured` reopens the fold's entry;
 * - no other open ask may hold the card (`CARD_HELD_BY_OPEN_ASK`) — a sub-ask that RODE it
 *   (`./sharedCard.ts`) is still writing it.
 *
 * **What "this ask" means.** An ask is `(channel, messageTs)`, {@link askLifecycleKey}, the key the fold and
 * every other lifecycle reader use: one Slack message has one thread. A log giving one message two thread
 * timestamps is outside that model, and it is read here as one ask exactly as the fold reads it.
 *
 * Pure: events in, a verdict out. The effect is `../../cli/commands/turn/retireCard.ts`.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { AskIdentity } from "./identity.js";
import { type AskLifecycleEvent, askLifecycleKey, foldAskLifecycle, terminalAskLifecycleEvent } from "./lifecycle.js";

/** The ask was never captured, so the bot posted no card for it. */
export interface AskNotCapturedError {
  readonly code: "ASK_NOT_CAPTURED";
  readonly message: string;
}

/** No `checklist-posted` event of this ask names the card. */
export interface NotThisAsksCardError {
  readonly code: "NOT_THIS_ASKS_CARD";
  readonly message: string;
}

/** The card is the ask's current one, owned by its own terminal path. */
export interface CardIsCurrentError {
  readonly code: "CARD_IS_CURRENT";
  readonly message: string;
}

/** The ask has never reached a terminal event. */
export interface AskNotTerminalError {
  readonly code: "ASK_NOT_TERMINAL";
  readonly message: string;
}

/** An event followed the ask's last ending. */
export interface AskReopenedError {
  readonly code: "ASK_REOPENED";
  readonly message: string;
  /** The event kind that reopened it. */
  readonly reopenedBy: AskLifecycleEvent["kind"];
}

/** Another open ask still holds the card. */
export interface CardHeldByOpenAskError {
  readonly code: "CARD_HELD_BY_OPEN_ASK";
  readonly message: string;
  /** Each holder's `channel/messageTs`. */
  readonly holders: readonly string[];
}

/** Every reason {@link orphanedCardVerdict} refuses to call a card orphaned. */
export type OrphanedCardError =
  | AskNotCapturedError
  | NotThisAsksCardError
  | CardIsCurrentError
  | AskNotTerminalError
  | AskReopenedError
  | CardHeldByOpenAskError;

/** Builds {@link OrphanedCardError} values; `subject` is the ask's `channel/messageTs`, `card` the card's ts. */
export const OrphanedCardErrors = {
  askNotCaptured: ({ subject }: { subject: string }): AskNotCapturedError => ({
    code: "ASK_NOT_CAPTURED",
    message: `${subject} was never captured, so the bot posted no card for it`,
  }),
  askNotTerminal: ({ subject, state }: { subject: string; state: string }): AskNotTerminalError => ({
    code: "ASK_NOT_TERMINAL",
    message:
      `${subject} has not ended (it is at \`${state}\`), so a later turn may still pick its cards up — ` +
      "retire a card only once the ask has a terminal event",
  }),
  askReopened: ({
    reopenedBy,
    subject,
  }: {
    reopenedBy: AskLifecycleEvent["kind"];
    subject: string;
  }): AskReopenedError => ({
    code: "ASK_REOPENED",
    message: `${subject} ended and was then reopened by a \`${reopenedBy}\` event, so it may be live again`,
    reopenedBy,
  }),
  cardHeldByOpenAsk: ({ card, holders }: { card: string; holders: readonly string[] }): CardHeldByOpenAskError => ({
    code: "CARD_HELD_BY_OPEN_ASK",
    holders,
    message: `card ${card} is still held by ${holders.join(", ")}, which has not ended`,
  }),
  cardIsCurrent: ({ card, subject }: { card: string; subject: string }): CardIsCurrentError => ({
    code: "CARD_IS_CURRENT",
    message:
      `card ${card} is ${subject}'s CURRENT card, which its own terminal path settles — ` +
      "this verb retires only an earlier card the fold no longer names",
  }),
  notThisAsksCard: ({ card, subject }: { card: string; subject: string }): NotThisAsksCardError => ({
    code: "NOT_THIS_ASKS_CARD",
    message: `no card ${card} was ever posted for ${subject}, so it is not this ask's to retire`,
  }),
} as const;

/** What a card the verdict found orphaned carries forward to the delete. */
export interface OrphanedCard {
  /** The turn id the orphan was posted under — the door's correlation id for the delete. */
  readonly turnId: string;
  /** The card's own ts. */
  readonly workingTs: string;
}

/**
 * Whether `workingTs` names a genuinely orphaned card of this ask. Pure and total.
 *
 * @param events the whole lifecycle log, in file order — never pre-filtered, since another ask's events decide
 *   `CARD_HELD_BY_OPEN_ASK`
 * @param askIdentity the ask the card was posted for
 * @param workingTs the card the caller wants retired
 * @returns the orphan to delete, or the one reason it is not safe to
 */
export function orphanedCardVerdict({
  events,
  askIdentity,
  workingTs,
}: {
  events: readonly AskLifecycleEvent[];
  askIdentity: AskIdentity;
  workingTs: string;
}): Result<OrphanedCard, OrphanedCardError> {
  const key = askLifecycleKey({ askIdentity });
  const subject = `${askIdentity.channel}/${askIdentity.messageTs}`;
  const entry = foldAskLifecycle({ events }).get(key);
  if (entry === undefined) {
    return err(OrphanedCardErrors.askNotCaptured({ subject }));
  }
  const own = events.filter((event) => askLifecycleKey({ askIdentity: event }) === key);
  const posted = own.find((event) => event.kind === "checklist-posted" && event.workingTs === workingTs);
  if (posted?.kind !== "checklist-posted") {
    return err(OrphanedCardErrors.notThisAsksCard({ card: workingTs, subject }));
  }
  // Current by EITHER reading: the fold's `started`, or the last card the raw log shows this ask posting. The
  // fold skips an event written before the ask's first capture, so its `started` alone would miss a sole card
  // posted out of order and wave the ask's only card through.
  const lastPosted = own.findLast((event) => event.kind === "checklist-posted");
  // Compared by ts, never by event: the same card can be logged twice, and only its latest recording counts.
  const isLastPosted = lastPosted?.kind === "checklist-posted" && lastPosted.workingTs === workingTs;
  if (entry.started?.workingTs === workingTs || isLastPosted) {
    return err(OrphanedCardErrors.cardIsCurrent({ card: workingTs, subject }));
  }
  const closure = askClosure({ own });
  if (closure.kind === "never-ended") {
    return err(OrphanedCardErrors.askNotTerminal({ state: entry.state, subject }));
  }
  if (closure.kind === "reopened") {
    return err(OrphanedCardErrors.askReopened({ reopenedBy: closure.by, subject }));
  }
  // Every terminal clears the fold's dispatch, so this holds only over a history the rule above already
  // refuses — kept anyway, because a worker holding the ask is the one fact that must never be argued away.
  if (entry.activeDispatch !== undefined) {
    return err(OrphanedCardErrors.askReopened({ reopenedBy: "dispatched", subject }));
  }
  const holders = openHoldersOf({ askIdentity, events, workingTs });
  if (holders.length > 0) {
    return err(OrphanedCardErrors.cardHeldByOpenAsk({ card: workingTs, holders }));
  }
  return ok({ turnId: posted.turnId, workingTs });
}

/**
 * Whether one event ends an ask for retirement's purposes: a lifecycle terminal, bar `withheld`. A withheld
 * answer can still be released from the Queue, and `turn watch` keeps ticking over one, so its cards are not
 * yet nobody's.
 */
function isRetirableEnding({ event }: { event: AskLifecycleEvent }): boolean {
  return event.kind !== "withheld" && terminalAskLifecycleEvent({ event }) !== undefined;
}

/** Whether one ask is over: ended, with nothing at all logged for it since. */
type AskClosure =
  | { readonly kind: "closed" }
  | { readonly kind: "never-ended" }
  | { readonly kind: "reopened"; readonly by: AskLifecycleEvent["kind"] };

/**
 * Whether one ask, read off its own events, is over. Pure.
 *
 * Only an ending at or after the ask's FIRST `captured` counts, because that is where the fold starts reading:
 * an ending written before any capture is one the fold never applied, so it cannot close the ask here either.
 * ANY event after the last ending reopens it, a redelivered `captured` included: the fold reopens the entry at
 * `captured` on one, so `turn watch` and every other reader of the fold's state treat the ask as live again.
 *
 * @param own every event of ONE ask, in file order
 * @returns closed, never ended, or reopened by the named kind
 */
function askClosure({ own }: { own: readonly AskLifecycleEvent[] }): AskClosure {
  const firstCapture = own.findIndex((event) => event.kind === "captured");
  if (firstCapture === -1) {
    return { kind: "never-ended" };
  }
  const seen = own.slice(firstCapture);
  const lastEnding = seen.findLastIndex((event) => isRetirableEnding({ event }));
  if (lastEnding === -1) {
    return { kind: "never-ended" };
  }
  const reopening = seen.at(lastEnding + 1);
  return reopening === undefined ? { kind: "closed" } : { by: reopening.kind, kind: "reopened" };
}

/**
 * Every OTHER ask in the card's channel that ever recorded this card and is not over, as `channel/messageTs`.
 *
 * Stricter on purpose than `./sharedCard.ts`, on both of its axes. It reads EVERY card an ask ever recorded,
 * not only its current one, and it counts an ask as done with the card only when {@link askClosure} says it is
 * over — never `releasedCardKeys`'s "latest event is a failed attempt", which is right for passing the pen
 * between two writers and wrong here: a failed sub-ask may be re-dispatched onto the very card this would
 * delete. Leaving an orphan standing costs a stale card; deleting a live one costs the reader the turn.
 */
function openHoldersOf({
  askIdentity,
  events,
  workingTs,
}: {
  askIdentity: AskIdentity;
  events: readonly AskLifecycleEvent[];
  workingTs: string;
}): readonly string[] {
  const own = askLifecycleKey({ askIdentity });
  const recorded = new Map<string, string>();
  for (const event of events) {
    const key = askLifecycleKey({ askIdentity: event });
    if (
      event.kind === "checklist-posted" &&
      event.channel === askIdentity.channel &&
      event.workingTs === workingTs &&
      key !== own
    ) {
      recorded.set(key, `${event.channel}/${event.messageTs}`);
    }
  }
  return [...recorded]
    .filter(
      ([key]) =>
        askClosure({ own: events.filter((event) => askLifecycleKey({ askIdentity: event }) === key) }).kind !==
        "closed",
    )
    .map(([, subject]) => subject);
}
