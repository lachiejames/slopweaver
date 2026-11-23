/**
 * The effectful half of `slopweaver talk wake-chair` and the chair's courier: read what the chair has not and the
 * relays held for it (`./relayCourier.ts`), decide (`./chairWake.ts`), and type the one quiet batch. The last wake is
 * kept at `$SLOPWEAVER_HOME/talk/chair-wake.json`, read and written under its own lock so two typists deciding together
 * decide off one record and type once; the relays a batch carries are recorded under the same lock, before the wake's
 * own outcome, so a held relay is never on two lines being typed at once.
 *
 * The lock is not held across the typing: a cmux reach can take seconds, and a batch landing then must not wait on it.
 * `attempting` is written before the line is typed, naming this process, so that batch reads a wake in flight and is
 * coalesced into it — only while this process runs; the outcome replaces it after, but only while the record is still
 * that wake's.
 *
 * A last wake that cannot be read never holds a wake back — the cost of a missing record is one wake too many, and the
 * cost of trusting a broken one is a stretch that wakes nobody — but the run says why it could not read it.
 *
 * The residue is the lock's, shared with the call store (`./callLock.ts`): a holder that died inside the
 * milliseconds the lock is held, with no start stamp read, whose pid a new process then took, keeps the lock, and
 * every later wake answers `CHAIR_WAKE_LOCKED` until it is removed. That lock never takes over from a writer that
 * might still be alive, by design, and the stretch is still caught at the chair's next pass, where `tick-record`
 * refuses until it is read.
 */
import { err, ok, type Result } from "../lib/result.js";

import { CALL_LOCK_WAIT_MS, holdCallLock } from "./callLock.js";
import {
  type ChairWakeDecision,
  type ChairWakeDeliveryKind,
  type ChairWakeRecord,
  decideChairWake,
  type HolderState,
} from "./chairWake.js";
import {
  type ChairWakeError,
  ChairWakeErrors,
  chairWakePath,
  readLastChairWake,
  writeChairWake,
} from "./chairWakeStore.js";
import type { Delivery } from "./deliveryOutcome.js";
import { type CourierOutcome, heldRelays, pruneDropped, settleHeldRelay } from "./relayCourier.js";
import type { LeaseHolder, StartOf } from "./relayLease.js";
import { SUPERVISOR_UNREAD_CURSOR } from "./unreadCursorStore.js";
import { readUnread } from "./unreadRead.js";
import { selectUnreadWords } from "./unreadWords.js";

/** What one run did. */
export type ChairWakeOutcome =
  | { readonly kind: "nothing-unread" }
  | { readonly kind: "holding"; readonly lastWordIso: string; readonly untilIso: string }
  | { readonly kind: "coalesced"; readonly pending: ChairWakeRecord }
  | { readonly kind: "would-wake"; readonly callId: string | undefined; readonly line: string }
  | {
      readonly kind: "woke";
      readonly callId: string | undefined;
      readonly line: string;
      readonly delivery: Delivery;
      /** Why its outcome could not be recorded over `attempting`, or `undefined` when it was. */
      readonly unrecorded: string | undefined;
      /** Every held relay the line carried into the chat, its delivery now recorded and its request gone. */
      readonly carried: readonly CourierOutcome[];
      /** Why a relay the line reached the chat with could not be recorded so; it stays held and rides the next batch. */
      readonly unsettled: readonly string[];
    };

/** One run: what it did, and every courier request it read that was no held relay. */
export interface ChairWakeReport {
  readonly outcome: ChairWakeOutcome;
  /** Requests naming a turn that is no held relay — said, and taken out of the queue unless the run was dry. */
  readonly dropped: readonly CourierOutcome[];
  /** Why the last wake's record could not be read, so the run decided as if there were none; `undefined` when it read. */
  readonly unreadable: string | undefined;
}

/**
 * Whether the process that wrote an `attempting` wake is provably still the one running — its pid alive with a start
 * stamp read both then and now, and the same — provably gone, its pid dead or started at another instant, or
 * untellable, a stamp missing then or now. The decision reads `unknown` each way it can afford: no wake held back on
 * it, and no relay it may be typing named again.
 */
function holderStateOf({ holder, startOf }: { holder: LeaseHolder; startOf: StartOf }): HolderState {
  const now = startOf(holder.pid);
  if (!now.running) {
    return "gone";
  }
  if (now.start === undefined || holder.start === undefined) {
    return "unknown";
  }
  if (now.start === holder.start) {
    return "running";
  }
  return "gone";
}

/**
 * Run `body` holding the store's lock.
 *
 * @param path the store, whose `.lock` sibling is taken
 * @param lock this process and how a holder is judged running
 * @param body what runs under it
 * @returns what `body` returned, or that the lock could not be taken
 */
function underLock<T>({
  path,
  lock,
  body,
}: {
  path: string;
  lock: { pid: number; startOf: StartOf };
  body: () => Result<T, ChairWakeError>;
}): Result<T, ChairWakeError> {
  let release: () => void;
  try {
    release = holdCallLock({ path, pid: lock.pid, startOf: lock.startOf, waitMs: CALL_LOCK_WAIT_MS });
  } catch (cause) {
    return err(ChairWakeErrors.locked({ cause }));
  }
  try {
    return body();
  } finally {
    release();
  }
}

/** What the locked decision left to do: an outcome to report, or a staged wake to type. */
interface Decided {
  readonly outcome: ChairWakeOutcome;
  readonly dropped: readonly CourierOutcome[];
  /** The `attempting` record written for the wake about to be typed, or `undefined` when nothing is typed. */
  readonly record: ChairWakeRecord | undefined;
  /** Why the last wake's record could not be read. */
  readonly unreadable: string | undefined;
}

/**
 * Decide under the lock whether to type a batch, and stage an `attempting` record naming this process and the relays
 * its line carries when it will.
 *
 * @param home the Slopweaver home
 * @param path the store
 * @param nowIso the clock
 * @param dryRun decide and say, but stage nothing and take no request out of the queue
 * @param lock this process and how a holder is judged running
 * @returns the decision, with the staged record when a batch is to be typed
 */
function decideAndStage({
  home,
  path,
  nowIso,
  dryRun,
  lock,
}: {
  home: string;
  path: string;
  nowIso: () => string;
  dryRun: boolean;
  lock: { pid: number; startOf: StartOf };
}): Result<Decided, ChairWakeError> {
  return underLock({
    body: (): Result<Decided, ChairWakeError> => {
      const atIso = nowIso();
      const read = readUnread({ home, name: SUPERVISOR_UNREAD_CURSOR, nowIso: atIso });
      if (read.isErr()) {
        return err(ChairWakeErrors.unreadFailed({ why: read.error.message }));
      }
      const held = heldRelays({ home });
      if (held.isErr()) {
        return err(ChairWakeErrors.unreadFailed({ why: held.error.message }));
      }
      const last = readLastChairWake({ path });
      const { unreadable } = last;
      const reported = (): readonly CourierOutcome[] => reportDropped({ dropped: held.value.dropped, dryRun, home });
      const decision = decideChairWake({
        holderState: ({ holder }) => holderStateOf({ holder, startOf: lock.startOf }),
        last: last.record,
        nowIso: atIso,
        read: read.value,
        relays: held.value.held,
        words: selectUnreadWords({ read: read.value }).words,
      });
      if (decision.kind !== "wake") {
        return ok({ dropped: reported(), outcome: decision, record: undefined, unreadable });
      }
      const outcome: ChairWakeOutcome = { callId: decision.callId, kind: "would-wake", line: decision.line };
      if (dryRun) {
        return ok({ dropped: reported(), outcome, record: undefined, unreadable });
      }
      const record = attemptingRecord({ atIso, decision, lock });
      const staged = writeChairWake({ path, record });
      if (staged.isErr()) {
        return err(staged.error);
      }
      return ok({ dropped: reported(), outcome, record, unreadable });
    },
    lock,
    path,
  });
}

/** The `attempting` record a wake is staged as before its line is typed: this process holds it, and names its relays. */
function attemptingRecord({
  atIso,
  decision,
  lock,
}: {
  atIso: string;
  decision: Extract<ChairWakeDecision, { kind: "wake" }>;
  lock: { pid: number; startOf: StartOf };
}): ChairWakeRecord {
  return {
    atIso,
    callId: decision.callId,
    delivery: "attempting",
    detail: "typing the quiet batch into the supervisor's chat",
    holder: { pid: lock.pid, start: lock.startOf(lock.pid).start },
    notified: decision.notified,
    relayTurnIds: decision.relays.map((relay) => relay.turnId),
  };
}

/**
 * The requests a read dropped, taken out of the queue unless the run is dry. They leave only once nothing after can
 * fail, so every one removed is one this run reports; one that would not leave is said so, and is read and
 * reported again next pass.
 */
function reportDropped({
  dropped,
  dryRun,
  home,
}: {
  dropped: readonly CourierOutcome[];
  dryRun: boolean;
  home: string;
}): readonly CourierOutcome[] {
  if (dryRun) {
    return dropped;
  }
  const pruned = pruneDropped({ dropped, home });
  if (pruned.isOk()) {
    return dropped;
  }
  return dropped.map((outcome) => ({
    ...outcome,
    detail: `${outcome.detail} (still queued: ${pruned.error.message})`,
  }));
}

/**
 * What a typed line's delivery records on the wake. A typist never answers `held` — only a relay waiting for a batch
 * carries it — so one that did typed nothing, and is recorded `skipped`, which holds no later wake back.
 */
function wakeDeliveryKind({ delivery }: { delivery: Delivery }): ChairWakeDeliveryKind {
  if (delivery.kind === "held") {
    return "skipped";
  }
  return delivery.kind;
}

/**
 * Under the lock, record what became of a typed batch: on every relay its line carried, then on the wake record —
 * unless a later wake replaced it while it was typed (one decided past the ceiling), which is never undone.
 *
 * @param home the Slopweaver home
 * @param path the store
 * @param record the `attempting` wake that was typed
 * @param delivery what became of its line
 * @param lock this process and how a holder is judged running
 * @returns the relays carried, the ones that could not be recorded, and why the wake's own outcome was not, if not
 */
function settleBatch({
  home,
  path,
  record,
  delivery,
  lock,
}: {
  home: string;
  path: string;
  record: ChairWakeRecord;
  delivery: Delivery;
  lock: { pid: number; startOf: StartOf };
}): { carried: readonly CourierOutcome[]; unsettled: readonly string[]; unrecorded: string | undefined } {
  const carried: CourierOutcome[] = [];
  const unsettled: string[] = [];
  const recorded = underLock({
    body: (): Result<void, ChairWakeError> => {
      // Relays first: while the record still reads `attempting` under a live holder, no other batch carries them.
      for (const turnId of record.relayTurnIds) {
        const settled = settleHeldRelay({ batchAtIso: record.atIso, delivery, home, turnId });
        if (settled.isErr()) {
          unsettled.push(settled.error.message);
        } else if (settled.value !== undefined) {
          carried.push(settled.value);
        }
      }
      const current = readLastChairWake({ path });
      if (current.unreadable !== undefined) {
        return err(ChairWakeErrors.storeFailed({ cause: current.unreadable, path }));
      }
      if (current.record?.atIso !== record.atIso || current.record.delivery !== "attempting") {
        return ok(undefined);
      }
      return writeChairWake({
        path,
        record: { ...record, delivery: wakeDeliveryKind({ delivery }), detail: delivery.detail, holder: undefined },
      });
    },
    lock,
    path,
  });
  if (recorded.isErr() && recorded.error.code === "CHAIR_WAKE_LOCKED") {
    // The lock was never taken — the body never answers this code — so no relay the line carried was settled: each is
    // said so, never only the wake.
    unsettled.push(...record.relayTurnIds.map((turnId) => `${turnId}: ${recorded.error.message}`));
  }
  return { carried, unrecorded: recorded.isErr() ? recorded.error.message : undefined, unsettled };
}

/**
 * Type one quiet batch into the pinned chair once the owner has been quiet two minutes, naming every stretch it has not read
 * and every relay held for it — unless a wake still pending already points at all of it.
 *
 * @param home the Slopweaver home
 * @param nowIso the clock
 * @param dryRun decide and say, but type, record and remove nothing
 * @param lock this process and how a lock holder is judged running
 * @param deliver types one line into the pinned chair — `deliverLineToSupervisor` over a live cmux client; never
 *   throws
 * @returns what it did, or why it could not decide
 */
export async function wakeChair({
  home,
  nowIso,
  dryRun,
  lock,
  deliver,
}: {
  home: string;
  nowIso: () => string;
  dryRun: boolean;
  lock: { pid: number; startOf: StartOf };
  deliver: (options: { line: string }) => Promise<Delivery>;
}): Promise<Result<ChairWakeReport, ChairWakeError>> {
  const path = chairWakePath({ home });
  const decided = decideAndStage({ dryRun, home, lock, nowIso, path });
  if (decided.isErr()) {
    return err(decided.error);
  }
  const { dropped, outcome, record, unreadable } = decided.value;
  if (record === undefined || outcome.kind !== "would-wake") {
    return ok({ dropped, outcome, unreadable });
  }
  // A typist killed between this paste and the settle below leaves its relays held under a holder now gone, so the
  // next batch names them again: at least once, by choice (`./relayCourier.ts`), never a relay the owner said and the chair
  // never heard of. At most once as well would need the paste and the settle to be one act, which cmux cannot give.
  const delivery = await deliver({ line: outcome.line });
  // The line is typed whatever the store says after; a record left `attempting` holds the next wake only while this
  // process runs, so the run still reports the wake it made.
  const { carried, unrecorded, unsettled } = settleBatch({ delivery, home, lock, path, record });
  return ok({
    dropped,
    outcome: { callId: outcome.callId, carried, delivery, kind: "woke", line: outcome.line, unrecorded, unsettled },
    unreadable,
  });
}
