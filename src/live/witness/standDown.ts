/**
 * Standing down: somebody in a thread the bot is in tells it it is in the way, or to stop, and the bot's whole
 * answer is a reaction — never a reply — after which the thread is witnessed no further.
 *
 * The owner's rulings: the bot witnesses every thread it is tagged in and helps when helpful, but being told
 * to stop is answered with a reaction and never a sorry-I'll-stop reply; a later explicit tag that is a
 * QUESTION is still answered, a steer gets `:ack:`; and after that tag the rest of the thread stays
 * unwitnessed. So the row is THREAD-wide in effect: {@link threadStandDown} is what the
 * listener's tap, `witness help` and `turn brief` each ask.
 *
 * ORDER is the contract, and it is the reverse of `./help.ts`'s. A reaction is idempotent (`already_reacted`
 * is success), so it goes FIRST and the row after it: a crash between the two leaves a verb that is safe to run
 * again, never a row claiming a stand-down the thread cannot see. Nothing is ever posted.
 *
 * The WHOLE-THREAD form ({@link standDownThread}) reacts on nothing and writes a `thread-stood-down` row tied to
 * no message. It exists because the message form has no path once that message has ended: every message in a thread
 * that meant "stop" could already be settled `nothing-checkable`, with the bot's own reply deleted, so the
 * owner's steer to stop witnessing the thread had no verb. A reaction hours later,
 * on a message the bot already judged, would be fresh noise in the very thread that asked for less. The thread
 * root cannot carry the row instead: a peer-tag root is itself a witness line, and may be settled or live.
 *
 * Who may stand the bot down, and whether the listener's snapshot holds a watch on the thread, are deliberately
 * NOT checked. A stand-down only narrows what the bot does: a person telling it to go away is owed that whether
 * or not the bot would answer them, and the explicit-tag path it leaves open is the one every responder already
 * has. A watch is not required because a "please stop" that arrives as a TAG, found by the recovery sweep
 * rather than seen live, leaves no watch in the snapshot — and the row is still what keeps a watch a later tag
 * opens from handing the thread back. Requiring one was considered and declined on that case.
 */
import { err, ok, type Result } from "#lib/result.js";
import type { WitnessJournalError } from "./errors.js";
import { foldWitnessJournal } from "./journal.js";
import { type WitnessStandDownError, WitnessStandDownErrors } from "./standDownErrors.js";
import {
  STOOD_DOWN_OUTCOME,
  threadStandDownIdOf,
  type WitnessCurrent,
  type WitnessJournalEvent,
  type WitnessKey,
  type WitnessSettledEvent,
  type WitnessThreadStoodDownEvent,
  witnessIdOf,
} from "./types.js";

/** The message that told the bot to stand down, and what it said in a phrase. */
export interface WitnessStandDownRequest {
  readonly key: WitnessKey;
  /** What was said, in the operator's words — required, so a later reader knows why the thread went quiet. */
  readonly why: string;
}

/** A whole thread to stand down, tied to no message, and what was said in a phrase. */
export interface WitnessThreadStandDownRequest {
  readonly channel: string;
  readonly threadTs: string;
  /** What was said, in the operator's words — required, so a later reader knows why the thread went quiet. */
  readonly why: string;
}

/** A row that stands a thread down: a message-scope `stood-down` terminal, or a whole-thread row. */
export type ThreadStandDownRow = WitnessSettledEvent | WitnessThreadStoodDownEvent;

/**
 * The id a stand-down row is recorded under — the witness id of a message-scope row, the stand-down id of a
 * whole-thread one.
 *
 * @param row the stand-down row
 * @returns its id
 */
function standDownRowId({ row }: { row: ThreadStandDownRow }): string {
  return row.kind === "thread-stood-down" ? row.standDownId : row.witnessId;
}

/**
 * Where a stand-down row landed, in a phrase a refusal can carry: the message it reacted on, or the whole
 * thread and when — a whole-thread row has no message to name.
 *
 * @param row the stand-down row
 * @returns `message <ts>`, or `the whole thread at <instant>`
 */
export function standDownWhere({ row }: { row: ThreadStandDownRow }): string {
  return row.kind === "thread-stood-down" ? `the whole thread at ${row.tsIso}` : `message ${row.messageTs}`;
}

/**
 * The thread's FIRST stand-down, of either form, or `undefined` while it has none. Every reader of "is this
 * thread stood down" asks this one function, so the tap, `witness help` and the brief cannot disagree about a thread.
 *
 * @param events every witness journal event
 * @param channel the thread's channel
 * @param threadTs the thread's root `ts`
 * @returns the earliest `stood-down` or `thread-stood-down` row in that thread, or `undefined`
 */
export function threadStandDown({
  channel,
  events,
  threadTs,
}: {
  channel: string;
  events: readonly WitnessJournalEvent[];
  threadTs: string;
}): ThreadStandDownRow | undefined {
  for (const event of events) {
    const standsDown =
      event.kind === "thread-stood-down" || (event.kind === "settled" && event.outcome === STOOD_DOWN_OUTCOME);
    if (standsDown && event.channel === channel && event.threadTs === threadTs) {
      return event;
    }
  }
  return undefined;
}

/**
 * What a stand-down on one message comes to: react and record it, or it is already recorded.
 *
 * `already` is the re-run after a finished stand-down — the reaction went on before the row, so there is nothing
 * left to do, and saying so is an answer rather than a refusal.
 */
export type WitnessStandDownPlan =
  | { readonly kind: "record"; readonly row: WitnessSettledEvent }
  | { readonly kind: "already"; readonly witnessId: string };

/**
 * Plan the stand-down row, or refuse.
 *
 * Refused on a blank `why` (the reader refuses such a row, so writing one would poison the whole journal), when
 * the message already ended another way in the witness journal (helped, checked, posted on), and when a witness
 * worker is live on it — a `settled` row there would end that worker's record under it. Either refusal names
 * the whole-thread form as the way through.
 *
 * @param current the folded witness journal
 * @param request the message and why
 * @param nowIso the instant the row is stamped with
 * @returns the row to append after the reaction, `already` when it is recorded, or the refusal
 */
export function planWitnessStandDown({
  current,
  nowIso,
  request,
}: {
  current: ReadonlyMap<string, WitnessCurrent>;
  nowIso: string;
  request: WitnessStandDownRequest;
}): Result<WitnessStandDownPlan, WitnessStandDownError> {
  const { key } = request;
  const why = request.why.trim();
  if (why.length === 0) {
    return err(WitnessStandDownErrors.whyBlank());
  }
  const witnessId = witnessIdOf({ key });
  const record = current.get(witnessId);
  if (record?.settled?.outcome === STOOD_DOWN_OUTCOME) {
    return ok({ kind: "already", witnessId });
  }
  if (record?.settled !== undefined) {
    return err(WitnessStandDownErrors.alreadySettled({ outcome: record.settled.outcome, witnessId }));
  }
  if (record?.dispatched !== undefined) {
    return err(WitnessStandDownErrors.alreadyDispatched({ witnessId }));
  }
  return ok({
    kind: "record",
    row: {
      channel: key.channel,
      kind: "settled",
      messageTs: key.messageTs,
      outcome: STOOD_DOWN_OUTCOME,
      schemaVersion: 1,
      threadTs: key.threadTs,
      tsIso: nowIso,
      why,
      witnessId,
    },
  });
}

/** What a whole-thread stand-down comes to: record it, or the thread already stands down. */
export type WitnessThreadStandDownPlan =
  | { readonly kind: "record"; readonly row: WitnessThreadStoodDownEvent }
  | { readonly kind: "already"; readonly row: ThreadStandDownRow };

/**
 * Plan the whole-thread row, or refuse a blank `why`. A thread already stood down, in either form and on any
 * message, is `already`: that is the whole effect this asks for. No witness state is consulted, because the row
 * touches no witness — a live worker in the thread may still finish, as one does after a message-scope row.
 *
 * @param events every witness journal event
 * @param request the thread and why
 * @param nowIso the instant the row is stamped with
 * @returns the row to append, `already` with the standing row, or the refusal
 */
export function planThreadStandDown({
  events,
  nowIso,
  request,
}: {
  events: readonly WitnessJournalEvent[];
  nowIso: string;
  request: WitnessThreadStandDownRequest;
}): Result<WitnessThreadStandDownPlan, WitnessStandDownError> {
  const { channel, threadTs } = request;
  const why = request.why.trim();
  if (why.length === 0) {
    return err(WitnessStandDownErrors.whyBlank());
  }
  const standing = threadStandDown({ channel, events, threadTs });
  if (standing !== undefined) {
    return ok({ kind: "already", row: standing });
  }
  return ok({
    kind: "record",
    row: {
      channel,
      kind: "thread-stood-down",
      schemaVersion: 1,
      standDownId: threadStandDownIdOf({ channel, threadTs }),
      threadTs,
      tsIso: nowIso,
      why,
    },
  });
}

/** The journal seams both stand-down forms run over. */
export interface WitnessStandDownJournalDeps {
  readonly readJournal: () => Result<readonly WitnessJournalEvent[], WitnessJournalError>;
  readonly append: (args: { event: WitnessJournalEvent }) => Result<void, WitnessJournalError>;
  readonly nowIso: () => string;
  /** The home's one witness lock — the same one `witness dispatch`, `settle` and `help` take. */
  readonly lock: () => Result<{ readonly release: () => void }, string>;
}

/** The seams {@link standDownWitness} runs over: the journal's, plus the one reaction. */
export interface WitnessStandDownDeps extends WitnessStandDownJournalDeps {
  /** The stand-down emoji, resolved from the profile. */
  readonly emoji: string;
  /** Put the reaction on the message; whether it is on it (an existing one counts). */
  readonly react: (args: { key: WitnessKey; emoji: string }) => Promise<boolean>;
}

/** What a stand-down reports. */
export interface WitnessStoodDown {
  readonly witnessId: string;
  readonly emoji: string;
  /** Whether this run found it already recorded and did nothing. */
  readonly already: boolean;
}

/** What a whole-thread stand-down reports. */
export interface WitnessThreadStoodDown {
  /** The id of the row the thread stands down under — this run's, or the one already standing. */
  readonly id: string;
  /** Whether this run found the thread already stood down and did nothing. */
  readonly already: boolean;
}

/** Run `body` under the home's witness lock, refusing when it is held. */
async function underLock<T>({
  body,
  deps,
}: {
  body: () => Promise<Result<T, WitnessStandDownError>>;
  deps: WitnessStandDownJournalDeps;
}): Promise<Result<T, WitnessStandDownError>> {
  const held = deps.lock();
  if (held.isErr()) {
    return err(WitnessStandDownErrors.locked({ reason: held.error }));
  }
  try {
    return await body();
  } finally {
    held.value.release();
  }
}

/** The plan, the reaction and the row, with the lock already held. */
async function standDownHeld({
  deps,
  request,
}: {
  deps: WitnessStandDownDeps;
  request: WitnessStandDownRequest;
}): Promise<Result<WitnessStoodDown, WitnessStandDownError>> {
  const events = deps.readJournal();
  if (events.isErr()) {
    return err(WitnessStandDownErrors.journal({ cause: events.error }));
  }
  const planned = planWitnessStandDown({
    current: foldWitnessJournal({ events: events.value }),
    nowIso: deps.nowIso(),
    request,
  });
  if (planned.isErr()) {
    return err(planned.error);
  }
  const plan = planned.value;
  if (plan.kind === "already") {
    return ok({ already: true, emoji: deps.emoji, witnessId: plan.witnessId });
  }
  let reacted: boolean;
  try {
    reacted = await deps.react({ emoji: deps.emoji, key: request.key });
  } catch (cause) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return err(WitnessStandDownErrors.reactionFailed({ emoji: deps.emoji, why }));
  }
  if (!reacted) {
    return err(WitnessStandDownErrors.reactionFailed({ emoji: deps.emoji, why: "Slack declined the reaction" }));
  }
  const appended = deps.append({ event: plan.row });
  if (appended.isErr()) {
    return err(WitnessStandDownErrors.journal({ cause: appended.error }));
  }
  return ok({ already: false, emoji: deps.emoji, witnessId: plan.row.witnessId });
}

/**
 * Stand down on one message: take the lock, check, react, then journal `stood-down` — never a reply.
 *
 * @param deps the journal, lock and reaction seams
 * @param request the message that told the bot to stop, and why
 * @returns the recorded stand-down, or the refusal — no reaction on any refusal
 */
export async function standDownWitness({
  deps,
  request,
}: {
  deps: WitnessStandDownDeps;
  request: WitnessStandDownRequest;
}): Promise<Result<WitnessStoodDown, WitnessStandDownError>> {
  return underLock({ body: async () => standDownHeld({ deps, request }), deps });
}

/**
 * Stand a whole thread down: take the lock, check, journal `thread-stood-down` — no reaction, never a reply.
 *
 * @param deps the journal and lock seams; there is no Slack seam, because this form makes no Slack call
 * @param request the thread, and why
 * @returns the recorded or standing stand-down, or the refusal
 */
export async function standDownThread({
  deps,
  request,
}: {
  deps: WitnessStandDownJournalDeps;
  request: WitnessThreadStandDownRequest;
}): Promise<Result<WitnessThreadStoodDown, WitnessStandDownError>> {
  return underLock({
    body: async () => {
      const events = deps.readJournal();
      if (events.isErr()) {
        return err(WitnessStandDownErrors.journal({ cause: events.error }));
      }
      const planned = planThreadStandDown({ events: events.value, nowIso: deps.nowIso(), request });
      if (planned.isErr()) {
        return err(planned.error);
      }
      const plan = planned.value;
      if (plan.kind === "already") {
        return ok({ already: true, id: standDownRowId({ row: plan.row }) });
      }
      const appended = deps.append({ event: plan.row });
      if (appended.isErr()) {
        return err(WitnessStandDownErrors.journal({ cause: appended.error }));
      }
      return ok({ already: false, id: plan.row.standDownId });
    },
    deps,
  });
}
