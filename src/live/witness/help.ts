/**
 * Unprompted help: in a thread a person already tagged this bot in, the loop takes a later, untagged message
 * up AS IF it had been tagged — 👀, the progress card, then the answer — through the very capture chain a real
 * tag takes. The owner's ruling is that nobody should have to tag the bot directly in a thread where it was already
 * tagged earlier: it does the same thing as if it had been tagged (the eyes reaction, the progress tracker, then
 * the final message), bounded by judgement so that it never gets annoying.
 *
 * The judgement (is a need clear, would help be welcome, was a named person asked to do this) is the visible
 * loop's, read off a `{"kind":"witness","ownThread":true}` line. What lives here is everything that must not
 * rest on judgement: the thread really is the bot's own — the snapshot's watch, then Slack's own read of the
 * thread (`./helpThread.ts`), never the caller's flags — the asker is a responder the bot would answer on a
 * tag, nothing already answers the message or the thread, and the thread is inside its daily budget.
 *
 * ORDER is the contract. The `helped` row is appended BEFORE any Slack effect, under the home's one witness
 * lock, and the lock is held through the capture: the reaction and the card are not idempotent, so a re-run,
 * a second loop or a crash mid-capture must find the row and stop. A capture that drops the message after
 * the row is written is reported, never retried. Residual, named rather than discovered: a real tag landing
 * on the thread after the active-ask check and before the card goes up can still race it.
 *
 * Pure planning plus one effectful orchestrator over plain seams; `../../cli/commands/witness/help.ts` wires
 * the real ones.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { EmittedMention } from "../listen/handoff.js";
import type { Mention } from "../listen/mention.js";
import type { WitnessJournalError } from "./errors.js";
import { type WitnessHelpError, WitnessHelpErrors } from "./helpErrors.js";
import { foldWitnessJournal } from "./journal.js";
import { standDownWhere, threadStandDown } from "./standDown.js";
import {
  HELP_OUTCOME,
  type WitnessCurrent,
  type WitnessJournalEvent,
  type WitnessKey,
  type WitnessSettledEvent,
  witnessIdOf,
} from "./types.js";

/**
 * How many messages one thread may be helped on unprompted per UTC day. CHOSEN, not measured: the bot had
 * never helped unprompted before this, so there is no distribution to read; two lets a thread get a second
 * useful answer the same day while keeping the bot from becoming the thread's loudest voice.
 */
export const UNPROMPTED_HELP_DAILY_CAP = 2;

/** The message the loop judged worth helping on, and who wrote it. */
export interface WitnessHelpRequest {
  readonly key: WitnessKey;
  readonly userId: string;
  /** The message text, tags normalised — what the card's first frame and the worker read. */
  readonly text: string;
}

/** Everything outside the witness journal a help is judged against, read fresh under the lock. */
export interface WitnessHelpFacts {
  /** Whether the snapshot holds a retained own watch on this thread. */
  readonly ownThread: boolean;
  /** The responder whitelist's verdict on the asker — the same gate a tag crosses. */
  readonly responder: { readonly admitted: true } | { readonly admitted: false; readonly why: string };
  /** Which ignore registry suppresses the message, when one does. */
  readonly ignored: "ask" | "conversation" | undefined;
  /** Whether the message is already in the ask lifecycle — tagged, captured, or helped before. */
  readonly alreadyAnAsk: boolean;
  /** The `messageTs` of a live ask in the same thread, when there is one. */
  readonly threadActiveAsk: string | undefined;
}

/** The UTC day (`YYYY-MM-DD`) of an ISO instant. */
function utcDayOf({ iso }: { iso: string }): string {
  return iso.slice(0, 10);
}

/** How many messages in this thread were helped on the given UTC day. */
function helpsOnDay({
  current,
  day,
  key,
}: {
  current: ReadonlyMap<string, WitnessCurrent>;
  day: string;
  key: WitnessKey;
}): number {
  return [...current.values()].filter(
    (record) =>
      record.key.channel === key.channel &&
      record.key.threadTs === key.threadTs &&
      record.settled?.outcome === HELP_OUTCOME &&
      utcDayOf({ iso: record.settled.tsIso }) === day,
  ).length;
}

/** The journal's own refusals: a message is helped once, and never one a witness worker already owns. */
function journalRefusal({
  current,
  witnessId,
}: {
  current: ReadonlyMap<string, WitnessCurrent>;
  witnessId: string;
}): WitnessHelpError | undefined {
  const record = current.get(witnessId);
  if (record?.settled !== undefined) {
    return WitnessHelpErrors.alreadySettled({ outcome: record.settled.outcome, witnessId });
  }
  if (record?.dispatched !== undefined) {
    return WitnessHelpErrors.alreadyDispatched({ witnessId });
  }
  return undefined;
}

/** The facts' refusals, in the order a reader would ask them. */
function factRefusal({
  facts,
  request,
}: {
  facts: WitnessHelpFacts;
  request: WitnessHelpRequest;
}): WitnessHelpError | undefined {
  const { key } = request;
  if (!facts.ownThread) {
    return WitnessHelpErrors.notOwnThread({ key });
  }
  if (!facts.responder.admitted) {
    return WitnessHelpErrors.responderRefused({ userId: request.userId, why: facts.responder.why });
  }
  if (facts.ignored !== undefined) {
    return WitnessHelpErrors.ignored({ key, registry: facts.ignored });
  }
  if (facts.alreadyAnAsk) {
    return WitnessHelpErrors.alreadyAnAsk({ key });
  }
  if (facts.threadActiveAsk !== undefined) {
    return WitnessHelpErrors.threadAskActive({ activeMessageTs: facts.threadActiveAsk, key });
  }
  return undefined;
}

/**
 * Plan the `helped` row, or refuse.
 *
 * The checks, in order: the message is not already settled or dispatched in the witness journal; nobody in the
 * thread has stood the bot down (`./standDown.ts`); the thread is the bot's own; the asker is an admitted
 * responder; no ignore registry suppresses it; it is not already an ask; no ask is live in the thread; and the thread has not spent {@link UNPROMPTED_HELP_DAILY_CAP} helps on
 * this UTC day. Helps never count against the one-live-witness-worker cap: a help is an ask, not a witness.
 *
 * The stand-down check reads the RAW events, never the fold: the fold keeps one terminal per message, so a
 * `stood-down` row after another terminal on the same message would vanish from it while the listener's tap,
 * which scans the raw events, still saw it.
 *
 * @param events every witness journal event
 * @param facts the non-journal state, read under the lock
 * @param request the message being helped
 * @param nowIso the instant the row is stamped with, and whose UTC day the budget is charged to
 * @returns the row to append, or the first check that refused it
 */
export function planWitnessHelp({
  events,
  facts,
  nowIso,
  request,
}: {
  events: readonly WitnessJournalEvent[];
  facts: WitnessHelpFacts;
  nowIso: string;
  request: WitnessHelpRequest;
}): Result<WitnessSettledEvent, WitnessHelpError> {
  const { key } = request;
  const witnessId = witnessIdOf({ key });
  const current = foldWitnessJournal({ events });
  const journalRefused = journalRefusal({ current, witnessId });
  if (journalRefused !== undefined) {
    return err(journalRefused);
  }
  const stoodDown = threadStandDown({ channel: key.channel, events, threadTs: key.threadTs });
  if (stoodDown !== undefined) {
    return err(WitnessHelpErrors.threadStoodDown({ key, stoodDownAt: standDownWhere({ row: stoodDown }) }));
  }
  const factRefused = factRefusal({ facts, request });
  if (factRefused !== undefined) {
    return err(factRefused);
  }
  const day = utcDayOf({ iso: nowIso });
  if (helpsOnDay({ current, day, key }) >= UNPROMPTED_HELP_DAILY_CAP) {
    return err(WitnessHelpErrors.budgetSpent({ cap: UNPROMPTED_HELP_DAILY_CAP, day, key }));
  }
  return ok({
    channel: key.channel,
    kind: "settled",
    messageTs: key.messageTs,
    outcome: HELP_OUTCOME,
    schemaVersion: 1,
    threadTs: key.threadTs,
    tsIso: nowIso,
    witnessId,
  });
}

/**
 * Whether a message became an ask through `witness help` rather than a tag — what `turn brief` reads so the
 * worker opens on what it looked into instead of answering a question nobody asked it.
 *
 * @param events every witness journal event
 * @param channel the ask's channel
 * @param messageTs the ask's own message ts
 * @returns whether a `helped` row names that message
 */
export function unpromptedHelpFor({
  channel,
  events,
  messageTs,
}: {
  channel: string;
  events: readonly WitnessJournalEvent[];
  messageTs: string;
}): boolean {
  return events.some(
    (event) =>
      event.kind === "settled" &&
      event.outcome === HELP_OUTCOME &&
      event.channel === channel &&
      event.messageTs === messageTs,
  );
}

/** The seams {@link helpWitness} runs over. */
export interface WitnessHelpDeps {
  readonly readJournal: () => Result<readonly WitnessJournalEvent[], WitnessJournalError>;
  readonly append: (args: { event: WitnessJournalEvent }) => Result<void, WitnessJournalError>;
  readonly nowIso: () => string;
  /** The home's one witness lock — the same one `witness dispatch` and `witness settle` take. */
  readonly lock: () => Result<{ readonly release: () => void }, string>;
  /** Read the non-journal facts for one request; a `STATE` error when the snapshot cannot be trusted. */
  readonly facts: (args: { request: WitnessHelpRequest; nowIso: string }) => Result<WitnessHelpFacts, WitnessHelpError>;
  /**
   * Re-read the thread from Slack and prove the help against it (`./helpThread.ts`) — the message is a reply
   * there by the claimed asker, and a responder person tagged the bot earlier in it. Asked only once every
   * cheaper check has passed, and before the row, so a refusal here posts and journals nothing.
   */
  readonly thread: (args: { request: WitnessHelpRequest }) => Promise<Result<true, WitnessHelpError>>;
  /**
   * Run the shared capture chain (👀, the card, the lifecycle rows) on the mention — the emitted handoff, or
   * `undefined` when the chain dropped it.
   */
  readonly capture: (args: { mention: Mention }) => Promise<EmittedMention | undefined>;
}

/** What a help reports: the witness it settled and the ask it became, in the shape a tag emits. */
export interface WitnessHelped {
  readonly witnessId: string;
  readonly emitted: EmittedMention;
}

/** The checks, the row and the capture, with the lock already held. */
async function helpHeld({
  deps,
  request,
}: {
  deps: WitnessHelpDeps;
  request: WitnessHelpRequest;
}): Promise<Result<WitnessHelped, WitnessHelpError>> {
  const events = deps.readJournal();
  if (events.isErr()) {
    return err(WitnessHelpErrors.journal({ cause: events.error }));
  }
  const nowIso = deps.nowIso();
  const facts = deps.facts({ nowIso, request });
  if (facts.isErr()) {
    return err(facts.error);
  }
  const planned = planWitnessHelp({
    events: events.value,
    facts: facts.value,
    nowIso,
    request,
  });
  if (planned.isErr()) {
    return err(planned.error);
  }
  const proven = await deps.thread({ request });
  if (proven.isErr()) {
    return err(proven.error);
  }
  const appended = deps.append({ event: planned.value });
  if (appended.isErr()) {
    return err(WitnessHelpErrors.journal({ cause: appended.error }));
  }
  const { key } = request;
  const emitted = await deps.capture({
    mention: { ...key, surface: "channel", text: request.text, userId: request.userId },
  });
  if (emitted === undefined) {
    return err(WitnessHelpErrors.captureDropped({ witnessId: planned.value.witnessId }));
  }
  return ok({ emitted, witnessId: planned.value.witnessId });
}

/**
 * Help on one witnessed message unprompted: take the lock, check, journal `helped`, then capture it as an ask.
 *
 * @param deps the journal, lock, facts and capture seams
 * @param request the message being helped
 * @returns the settled witness and the emitted ask, or the refusal — no Slack effect on any refusal
 */
export async function helpWitness({
  deps,
  request,
}: {
  deps: WitnessHelpDeps;
  request: WitnessHelpRequest;
}): Promise<Result<WitnessHelped, WitnessHelpError>> {
  const held = deps.lock();
  if (held.isErr()) {
    return err(WitnessHelpErrors.locked({ reason: held.error }));
  }
  try {
    return await helpHeld({ deps, request });
  } finally {
    held.value.release();
  }
}
