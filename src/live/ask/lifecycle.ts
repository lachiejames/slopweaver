/**
 * The ASK LIFECYCLE — one append-only event stream per addressed message, keyed by `(channel, messageTs)`,
 * so recovery can answer "what actually happened to this ask" exactly rather than guessing from "did the
 * bot's user id ever post in this thread" (`../listen/recover.ts`'s old test, and wrong in the dangerous
 * direction: two asks sharing a thread become indistinguishable the moment either is judged by thread
 * membership alone).
 *
 * ## Append-only, folded on read — the same shape `../../admit/queue.ts` already proved
 *
 * One `captured` event opens an entry; every later event for the SAME `(channel, messageTs)` key updates its
 * folded state. Rewriting an entry in place would mean a crash mid-write could lose the fact that an ask was
 * ever captured at all; appending cannot. An event naming a key that was never captured is IGNORED rather
 * than inventing an entry with no capture behind it — the fold's whole value is that an entry can be acted
 * on, and a resolution alone, with no capture, carries nothing to act on.
 *
 */
import { isRecord } from "../../lib/parsers.js";
import type { StartedChecklist } from "./checklist.js";
import type { AskIdentity } from "./identity.js";
import { decodeAskLifecycleEvent } from "./lifecycleDecode.js";
import {
  type AskLifecycleEvent,
  type BlockedOnHumanEvent,
  type CapturedEvent,
  type DispatchedEvent,
  type FirstAnsweredEvent,
  type RedispatchedEvent,
  type TerminalAskLifecycleEvent,
  terminalAskLifecycleEvent,
} from "./lifecycleEvents.js";

export * from "./lifecycleEvents.js";

/** Every state an ask's fold may report — every event kind updates it, including `checklist-posted`. */
export type AskLifecycleState = AskLifecycleEvent["kind"];

/** One ask, folded to its current state. */
export interface AskLifecycle extends AskIdentity {
  readonly state: AskLifecycleState;
  /** When this ask was first captured — stable across every later event. */
  readonly capturedIso: string;
  /**
   * Who asked it — read off the opening `captured` event and, like `capturedIso`, preserved across every
   * later event rather than overwritten: only `CapturedEvent` itself carries `userId`, so without this a
   * fold advanced past capture would lose the one fact burst-queueing (`../ask/burst.ts`) needs to know
   * whose later tag this is.
   */
  readonly userId: string;
  /**
   * Which surface addressed the bot — read off the opening `captured` event and preserved across every later
   * event for exactly the reason `userId` is: only `CapturedEvent` carries it, and a reader rebuilding this
   * ask's mention long afterwards (`../listen/stranded.ts`) would otherwise have to infer it from the channel
   * id or re-read Slack to learn something the listener already decided and wrote down.
   */
  readonly surface: "channel" | "dm";
  /**
   * What was asked — read off {@link CapturedEvent.text} and preserved across every later event, for the
   * same reason `userId` and `surface` are.
   *
   * Absent on an ask captured before the field existed, and that absence is the one thing a reader must
   * branch on: `../../cli/commands/turn/dispatchSweep.ts` prints a re-route command that omits `--text`
   * when the ledger has it and spells `--text` out as still required when it does not.
   */
  readonly text?: string | undefined;
  /** The most recent event, carrying whichever kind-specific fields `state` implies. */
  readonly lastEvent: AskLifecycleEvent;
  /**
   * The capture-time checklist's `{turnId, workingTs}`, once a `checklist-posted` event has been folded in —
   * and preserved across every LATER event, unlike `lastEvent`, which a `dispatched`/`answered` event
   * overwrites. This is what lets a `turn brief` call recover the ref long after posting it.
   */
  readonly started?: StartedChecklist | undefined;
  /**
   * The `dispatched` event that is still UNSUPERSEDED — a worker holds this ask right now, and the dispatch
   * sweep (`../../cli/commands/turn/dispatchSweep.ts`) is the thing that owes it supervision.
   *
   * Kept apart from `state`/`lastEvent` because those two answer "what happened MOST RECENTLY", and that is
   * a different question from "is a worker still holding this ask". Measured live: a scheduled
   * recovery pass re-captured a live ask (message `1787720846.032529`) while its worker was alive, appending a
   * `checklist-posted` event over the `dispatched` one. The fold's `state` moved to `checklist-posted`, so
   * `state === "dispatched" && lastEvent.kind === "dispatched"` — the predicate BOTH the sweep and
   * `../turn/dispatchStore.ts#currentDispatchedEvent` were written as — went false, and that worker's
   * terminal, its lease expiry and its death all became unobservable to the loop. Nothing was wrong with
   * either caller's intent; the fold simply could not express it.
   *
   * See {@link supersedesDispatch} for which kinds clear it and which deliberately do not.
   */
  readonly activeDispatch?: DispatchedEvent | undefined;
  /**
   * The {@link RedispatchedEvent} this ask has already spent, once one has been folded in — preserved across
   * every LATER event exactly as `started` is, and for the same reason: the re-capture, dispatch and
   * terminal that FOLLOW a re-dispatch would each overwrite `lastEvent`, and the one fact the stranded lane
   * must never lose is that this ask has had its turn.
   *
   * Absent means "never re-dispatched", which is the only reading `../listen/stranded.ts` acts on.
   */
  readonly redispatched?: RedispatchedEvent | undefined;
  /**
   * The {@link BlockedOnHumanEvent} this ask is waiting on RIGHT NOW — set when one is folded in, and
   * CLEARED by the {@link UnblockedEvent} that lifts it. The one field on this fold that is neither
   * `lastEvent`-shaped nor permanently preserved, and the asymmetry is the point: `state` answers "what
   * happened most recently", which stops being "blocked" the moment the resumed turn writes its next stage,
   * while a reader still has to be able to ask "is anything of the owner's outstanding on this ask".
   *
   * That reader is the fleet briefing (`../../briefing/blockedAsks.ts`), whose whole job is to refuse a page
   * that does not surface an outstanding block — so a field that went stale the instant the turn resumed
   * would card the owner for a sign-in already done, and one that never cleared would card them forever.
   */
  readonly blockedOnHuman?: BlockedOnHumanEvent | undefined;
  /**
   * The {@link FirstAnsweredEvent} this ask's running turn has already posted — the plan stands in the thread
   * and the same dispatch still owes what it named.
   *
   * Set by `first-answered`, carried through every NON-terminal event (a re-capture, a `failed`, a
   * `lease-expired`, a `redispatched` and the re-dispatch's own `dispatched` included, so the stranded worker
   * is told the plan is already up), and CLEARED by any terminal event: the owing ends when the turn ends, and
   * a later follow-up generation must never inherit a stale "already posted".
   */
  readonly firstAnswer?: FirstAnsweredEvent | undefined;
}

/**
 * Whether one event ENDS the dispatch an ask was holding — the single rule {@link AskLifecycle.activeDispatch}
 * is folded with.
 *
 * Six kinds do not, and they are the whole reason this predicate exists rather than "anything after a
 * `dispatched` event":
 *
 *  - **`captured`** — a redelivered frame, or a recovery pass finding the same message again. It says the
 *    ask was seen, never that the worker stopped.
 *  - **`checklist-posted`** — a capture-time card was posted. Same: an observation, not an outcome.
 *  - **`dispatched`** — a RE-dispatch, which supersedes the previous dispatch by replacing it; the fold
 *    handles that by overwriting rather than clearing, so this predicate never sees it as an ending.
 *  - **`dispatch-unwitnessed`** — the pickup was sent and nothing SAW it arrive. An observation about the
 *    evidence, not about the worker, and reading it as an ending is precisely the measured orphaning
 *    {@link DispatchUnwitnessedEvent} documents.
 *  - **`dispatch-witnessed`** — that doubt later settled in the worker's favour. Even more plainly not an
 *    ending.
 *  - **`first-answered`** — the worker posted its plan and is still building; ending the dispatch here is
 *    exactly the self-reap {@link FirstAnsweredEvent} was added to stop. The dispatch's `leaseExpiresAt` is
 *    left untouched, because it is the generation token the dispatch record and the turn marker bind on.
 *
 * Everything else names an outcome for the dispatch itself: the terminals, the turn's own `failed`
 * and `answer-lost`, `dispatch-failed`, `lease-expired`, `redispatched` (which is only ever appended over an
 * ask holding no dispatch at all, so it clears nothing in practice and is grouped here rather than carved
 * out), and the two cleanup intents `triage-cleanup-intended` and `handover-cleanup-intended` (the supervisor
 * has ruled the bot posts nothing — no reply owed, or one owed by a person — so a worker's answer is no longer
 * wanted; the only non-terminal kinds that still end a dispatch).
 *
 * @param event the event folded in after a dispatch
 * @returns whether it ends the dispatch
 */
function supersedesDispatch({ event }: { event: AskLifecycleEvent }): boolean {
  return !DISPATCH_PRESERVING_KINDS.has(event.kind);
}

/** The event kinds {@link supersedesDispatch} leaves an ask's `activeDispatch` standing through. */
const DISPATCH_PRESERVING_KINDS: ReadonlySet<AskLifecycleEvent["kind"]> = new Set([
  "captured",
  "checklist-posted",
  "dispatched",
  "dispatch-unwitnessed",
  "dispatch-witnessed",
  "first-answered",
]);

/** The current ask-lifecycle schema version — bumped if the event shapes ever change incompatibly. */
const ASK_LIFECYCLE_SCHEMA_VERSION = 1;

/**
 * The fold's key for one ask — `(channel, messageTs)`, never the thread root, so two asks sharing a thread
 * never collide. A JSON-encoded pair rather than a delimited string: a plain `${channel}:${messageTs}` join
 * is not injective (`channel: "C:A", messageTs: "1"` and `channel: "C", messageTs: "A:1"` would collide),
 * and `JSON.stringify`'s own string escaping is what makes the two fields unambiguous again.
 *
 * @param askIdentity the identity to key on; only `channel`/`messageTs` matter
 * @returns the fold key
 */
export function askLifecycleKey({ askIdentity }: { askIdentity: AskIdentity }): string {
  return JSON.stringify([askIdentity.channel, askIdentity.messageTs]);
}

/**
 * Encode one event as a JSONL line.
 *
 * `schemaVersion` is spread LAST, deliberately: every caller builds its event by spreading a caller-supplied
 * `AskIdentity` value, and TypeScript's structural typing does not stop a WIDER-typed value (one assignable
 * to `AskIdentity` but carrying more fields, e.g. a decoded `AskLifecycleEvent` mistakenly passed where an
 * identity was expected) from smuggling its OWN `schemaVersion` through that spread. Writing this version
 * last means it always wins over anything the event itself happens to carry, so a stray field can never
 * downgrade the line to a version `parseAskLifecycleLog` then rejects — corrupting not just this event but
 * silently re-opening every idempotency check keyed on "was this ever captured".
 *
 * @param event the event to encode
 * @returns the JSON line (no trailing newline)
 */
export function askLifecycleEventLine({ event }: { event: AskLifecycleEvent }): string {
  return JSON.stringify({ ...event, schemaVersion: ASK_LIFECYCLE_SCHEMA_VERSION });
}

/**
 * Parse the ask-lifecycle log's text into events, in file order.
 *
 * Tolerant of a blank or malformed line, the same as `../../admit/queue.ts`'s own log reader: a corrupt line
 * must not make the whole log unreadable. Every unreadable line is reported by its 1-indexed line number
 * rather than silently dropped, because a skipped event is a lost fact about what happened to a real ask.
 *
 * @param text the raw log contents
 * @returns the parsed events and the 1-indexed line numbers that could not be read
 */
export function parseAskLifecycleLog({ text }: { text: string }): {
  readonly events: readonly AskLifecycleEvent[];
  readonly unreadable: readonly number[];
} {
  const events: AskLifecycleEvent[] = [];
  const unreadable: number[] = [];
  text.split("\n").forEach((line, index) => {
    if (line.trim().length === 0) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      unreadable.push(index + 1);
      return;
    }
    if (!isRecord(parsed) || parsed["schemaVersion"] !== ASK_LIFECYCLE_SCHEMA_VERSION) {
      unreadable.push(index + 1);
      return;
    }
    const event = decodeAskLifecycleEvent({ value: parsed });
    if (event === undefined) {
      unreadable.push(index + 1);
      return;
    }
    events.push(event);
  });
  return { events, unreadable };
}

/**
 * Fold events into one entry per ask, most recently captured first.
 *
 * An event naming a key that was never `captured` is IGNORED rather than inventing an entry with no capture
 * behind it — the same rule `../../admit/queue.ts`'s `foldQueue` holds to, for the same reason: the fold's
 * whole value is that an entry can be acted on, and an event alone carries nothing to act on.
 *
 * Three fields advance on DIFFERENT rules, and the difference is the point: `state`/`lastEvent` always take
 * the newest event, `started` survives every event after the `checklist-posted` that set it, and
 * `activeDispatch` survives only the events that say nothing about the dispatch — see
 * {@link supersedesDispatch}.
 *
 * @param events the parsed events, in file order
 * @returns one item per captured ask, keyed by {@link askLifecycleKey}
 */
export function foldAskLifecycle({
  events,
}: {
  events: readonly AskLifecycleEvent[];
}): ReadonlyMap<string, AskLifecycle> {
  const items = new Map<string, AskLifecycle>();
  for (const event of events) {
    const key = askLifecycleKey({ askIdentity: event });
    if (event.kind === "captured") {
      items.set(key, openedEntry({ event, previous: items.get(key) }));
      continue;
    }
    const existing = items.get(key);
    if (existing !== undefined) {
      items.set(key, advancedEntry({ event, existing }));
    }
  }
  return items;
}

/**
 * Which of the two rows' questions an opened entry keeps.
 *
 * A re-`captured` event written by an older build — or by `./store.ts`'s idempotent
 * `ensureCapturedAskLifecycle` path, which does not always have the text — carries none, and it must not
 * ERASE what the opening row recorded: both rows describe the same Slack message, so the one that knows the
 * question wins. Its own function rather than a coalesce because `no-silent-fallback` is the house rule and
 * this substitution is the entire behaviour.
 */
function preservedText({
  event,
  previous,
}: {
  event: CapturedEvent;
  previous: AskLifecycle | undefined;
}): string | undefined {
  if (event.text !== undefined) {
    return event.text;
  }
  return previous?.text;
}

/**
 * The entry a `captured` event opens — or RE-opens, when one already exists for this key.
 *
 * A duplicate `captured` for the SAME ask (a redelivered Slack event, a retried capture, a recovery pass) must
 * not erase what the entry already knows. `started` is what `startedRefForAsk` and `handleNoResponse`'s
 * checklist-delete target both depend on, and losing it silently would re-open exactly the false-terminal risk
 * the delete-target fix closed. `activeDispatch` is the same idea and the half that was measured
 * breaking — see {@link AskLifecycle.activeDispatch}.
 *
 * @param event the `captured` event being folded in
 * @param previous this key's entry before it, when the log already carried one
 * @returns the entry to store
 */
function openedEntry({ event, previous }: { event: CapturedEvent; previous: AskLifecycle | undefined }): AskLifecycle {
  const text = preservedText({ event, previous });
  return {
    capturedIso: event.tsIso,
    channel: event.channel,
    lastEvent: event,
    messageTs: event.messageTs,
    state: "captured",
    surface: event.surface,
    threadTs: event.threadTs,
    userId: event.userId,
    ...(text === undefined ? {} : { text }),
    ...(previous?.activeDispatch === undefined ? {} : { activeDispatch: previous.activeDispatch }),
    ...(previous?.blockedOnHuman === undefined ? {} : { blockedOnHuman: previous.blockedOnHuman }),
    ...(previous?.firstAnswer === undefined ? {} : { firstAnswer: previous.firstAnswer }),
    ...(previous?.redispatched === undefined ? {} : { redispatched: previous.redispatched }),
    ...(previous?.started === undefined ? {} : { started: previous.started }),
  };
}

/**
 * One existing entry, advanced by a later event for the same key.
 *
 * `started` is preserved across every later event, deliberately NOT part of `lastEvent`'s overwrite — a
 * `dispatched`/`answered` event folded in afterwards must not erase the checklist ref a `turn brief` recovery
 * lookup depends on. `activeDispatch` follows {@link supersedesDispatch} instead, which is a narrower rule.
 *
 * @param event the event being folded in — never `captured`, which opens rather than advances
 * @param existing this key's entry before it
 * @returns the entry to store
 */
function advancedEntry({
  event,
  existing,
}: {
  event: Exclude<AskLifecycleEvent, CapturedEvent>;
  existing: AskLifecycle;
}): AskLifecycle {
  const started =
    event.kind === "checklist-posted" ? { turnId: event.turnId, workingTs: event.workingTs } : existing.started;
  const redispatched = event.kind === "redispatched" ? event : existing.redispatched;
  const blockedOnHuman = blockedAfter({ event, existing });
  const firstAnswer = firstAnswerAfter({ event, existing });
  let activeDispatch: DispatchedEvent | undefined;
  if (event.kind === "dispatched") {
    activeDispatch = event;
  } else if (supersedesDispatch({ event })) {
    activeDispatch = undefined;
  } else {
    activeDispatch = existing.activeDispatch;
  }
  return {
    ...existing,
    activeDispatch,
    // Set UNCONDITIONALLY, exactly as `activeDispatch` is, because this is the one field an event can CLEAR:
    // spreading `existing` and then conditionally re-adding would make an `unblocked` event silently leave
    // the old block standing, which is a briefing carding the owner for a sign-in already done, forever.
    blockedOnHuman,
    // Unconditional for the same reason: a terminal event CLEARS it.
    firstAnswer,
    lastEvent: event,
    state: event.kind,
    ...(redispatched === undefined ? {} : { redispatched }),
    ...(started === undefined ? {} : { started }),
  };
}

/**
 * The block this ask is waiting on after one more event — set by `blocked-on-human`, cleared by `unblocked`,
 * and otherwise carried forward untouched.
 *
 * A named function rather than a nested ternary in {@link advancedEntry}, because the three arms are three
 * genuinely different claims and the middle one is the one a reader gets wrong: `unblocked` clears the field
 * even though a resumed turn may go on to block AGAIN, which simply appends a fresh `blocked-on-human` and
 * sets it a second time. One row is one block.
 *
 * @param event the event being folded in
 * @param existing this key's entry before it
 * @returns the block still outstanding, or `undefined` when none is
 */
function blockedAfter({
  event,
  existing,
}: {
  event: Exclude<AskLifecycleEvent, CapturedEvent>;
  existing: AskLifecycle;
}): BlockedOnHumanEvent | undefined {
  if (event.kind === "blocked-on-human") {
    return event;
  }
  if (event.kind === "unblocked") {
    return undefined;
  }
  return existing.blockedOnHuman;
}

/**
 * The first answer this ask's turn still owes follow-through on after one more event — set by
 * `first-answered`, cleared by any terminal event, and otherwise carried forward untouched.
 *
 * @param event the event being folded in
 * @param existing this key's entry before it
 * @returns the standing first answer, or `undefined` when none stands
 */
function firstAnswerAfter({
  event,
  existing,
}: {
  event: Exclude<AskLifecycleEvent, CapturedEvent>;
  existing: AskLifecycle;
}): FirstAnsweredEvent | undefined {
  if (event.kind === "first-answered") {
    return event;
  }
  if (terminalAskLifecycleEvent({ event }) !== undefined) {
    return undefined;
  }
  return existing.firstAnswer;
}

/**
 * Every ask that has EVER reached a terminal event, keyed by {@link askLifecycleKey} — from the RAW event
 * history, never {@link foldAskLifecycle}'s own fold.
 *
 * This is deliberately not derived from the fold's `state`: `foldAskLifecycle` advances `state` to whatever
 * the LATEST event for a key is, so a `captured` event appended after a terminal one (a redelivery, a
 * malformed manual entry) would read as "not terminal" if this were built from fold state instead of raw
 * history. The map built here is monotonic — once a key has a terminal event, it stays in this map
 * regardless of what non-terminal events follow it in the log — which is exactly the "any terminal event,
 * ever" suppression rule scheduled recovery needs and the fold cannot promise on its own.
 *
 * @param events the parsed events, in file order
 * @returns one entry per ask that has ever reached a terminal event, the LAST such event when more than one
 *   was recorded for the same key
 */
export function terminalAskEventsByKey({
  events,
}: {
  events: readonly AskLifecycleEvent[];
}): ReadonlyMap<string, TerminalAskLifecycleEvent> {
  const items = new Map<string, TerminalAskLifecycleEvent>();
  for (const event of events) {
    const terminal = terminalAskLifecycleEvent({ event });
    if (terminal !== undefined) {
      items.set(askLifecycleKey({ askIdentity: terminal }), terminal);
    }
  }
  return items;
}
