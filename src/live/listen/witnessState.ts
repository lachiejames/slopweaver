/**
 * Which threads are being witnessed, and how much of today's budget each has spent. Pure — the snapshot's
 * I/O is `./witnessStateStore.ts`.
 *
 * Two watches share one record. A PEER watch starts the first time a message tags a witnessed bot (Helpbot);
 * an OWN watch starts the first time a person tags THIS bot in the thread, so the bot can help there unprompted
 * later (nobody has to tag the bot directly, especially in a thread where it has already been tagged
 * earlier). A thread holding either is witnessed; one can hold both.
 *
 * A thread becomes witnessed the first time a message in it tags a witnessed bot or this one, and stays witnessed for
 * {@link WITNESS_RETENTION_DAYS} after its LAST observed message, so a thread that goes quiet and wakes a
 * week later is still read. Both numbers are MEASURED over the local corpus (5,057 Helpbot-tagged
 * threads over 268 days in 79 channels; repro: `yarn tsx <script> <corpus compact.jsonl> <helpbot user id>`,
 * the script kept in this feature's handover run):
 *
 * - the longest quiet gap inside one thread is p50 0 days, p90 0.53, p99 27 — fourteen days covers well past
 *   p90 and is the window the bot's own threads are re-read over (`OWN_THREAD_LOOKBACK_DAYS`);
 * - messages per thread per UTC day are p50 1, p90 12, p99 41, max 158 — forty lets ~p99 of thread-days
 *   through whole, and past it the thread is not handed off again that UTC day (a log line, never Slack).
 *
 * Time comes from the MESSAGE'S own Slack `ts` for both the budget's day and the retention's last-seen
 * instant, so the same events always reach the same decision; only pruning needs the clock.
 */
import { slackTsToEpochMs, slackTsToIso } from "#lib/slackTs.js";

/** How long after its last observed message a thread stays witnessed. */
export const WITNESS_RETENTION_DAYS = 14;

/** How many lines one thread may hand off per UTC day. */
export const WITNESS_DAILY_LINE_CAP = 40;

const DAY_MS = 86_400_000;

/** One witnessed thread. */
interface WitnessThread {
  readonly channel: string;
  readonly threadTs: string;
  /** The witnessed PEER bot whose tag activated the thread; absent on a thread only this bot was tagged in. */
  readonly witnessUserId?: string | undefined;
  /** The `ts` of the first message observed tagging THIS bot there — the own watch; absent when none has. */
  readonly ownTaggedTs?: string | undefined;
  /** The `ts` of the newest message observed in it — the retention clock. */
  readonly lastObservedTs: string;
  /**
   * Lines handed off per UTC day (`YYYY-MM-DD`) of the message's own `ts`, every day inside retention kept —
   * so a late delivery from yesterday is charged to yesterday, never to a fresh count.
   */
  readonly dayCounts: Readonly<Record<string, number>>;
}

/** The whole snapshot, keyed by {@link witnessThreadKey}. */
export interface WitnessState {
  readonly version: 1;
  readonly threads: Readonly<Record<string, WitnessThread>>;
}

/** One message, as the state judges it. */
export interface WitnessObservation {
  readonly channel: string;
  readonly threadTs: string;
  readonly messageTs: string;
  /** The witnessed bot this message tags, which (re)activates the thread; `undefined` when it tags none. */
  readonly activatesFor: string | undefined;
  /** Whether this message tags THIS bot, which starts the thread's own watch. */
  readonly tagsSelf: boolean;
}

/**
 * What one observation did.
 *
 * `inactive` — not a witnessed thread and no tag to start one; `recorded` — remembered (activated, or its
 * last-seen moved) but deliberately not handed off; `admitted` — hand it off; `over-budget` — the thread
 * spent today's lines, remembered but not handed off.
 */
export type WitnessVerdict =
  | { readonly kind: "inactive" }
  | { readonly kind: "recorded"; readonly thread: WitnessThread }
  | { readonly kind: "admitted"; readonly thread: WitnessThread }
  | { readonly kind: "over-budget"; readonly thread: WitnessThread };

/**
 * The snapshot a fresh install starts from.
 *
 * @returns a snapshot witnessing nothing
 */
export function emptyWitnessState(): WitnessState {
  return { threads: {}, version: 1 };
}

/**
 * The one key a thread is stored under.
 *
 * @returns `<channel>:<threadTs>`
 */
export function witnessThreadKey({ channel, threadTs }: { channel: string; threadTs: string }): string {
  return `${channel}:${threadTs}`;
}

/** Whether a thread last seen at `lastObservedTs` is still inside the retention window at `nowMs`. */
function retained({ lastObservedTs, nowMs }: { lastObservedTs: string; nowMs: number }): boolean {
  const seenMs = slackTsToEpochMs({ ts: lastObservedTs });
  return seenMs !== undefined && nowMs - seenMs <= WITNESS_RETENTION_DAYS * DAY_MS;
}

/**
 * Drop every thread past retention.
 *
 * @param state the snapshot
 * @param nowMs the current instant, epoch ms
 * @returns the snapshot holding only threads still witnessed
 */
export function pruneWitnessState({ state, nowMs }: { state: WitnessState; nowMs: number }): WitnessState {
  const kept = Object.entries(state.threads).filter(([, thread]) =>
    retained({ lastObservedTs: thread.lastObservedTs, nowMs }),
  );
  return { threads: Object.fromEntries(kept), version: 1 };
}

/**
 * Whether this bot was tagged in a thread the snapshot still witnesses — what `witness help` checks before it
 * acts unprompted there.
 *
 * @param state the snapshot
 * @param channel the thread's channel
 * @param threadTs the thread's root `ts`
 * @param nowMs the current instant, epoch ms — a thread past retention no longer counts
 * @returns whether the thread carries a retained own watch
 */
export function isOwnWatchedThread({
  channel,
  nowMs,
  state,
  threadTs,
}: {
  channel: string;
  nowMs: number;
  state: WitnessState;
  threadTs: string;
}): boolean {
  const thread = state.threads[witnessThreadKey({ channel, threadTs })];
  return thread?.ownTaggedTs !== undefined && retained({ lastObservedTs: thread.lastObservedTs, nowMs });
}

/** Who watches a thread after one message: the peer bot it names, and the own watch's FIRST tag. */
function watchAfter({
  existing,
  observation,
}: {
  existing: WitnessThread | undefined;
  observation: WitnessObservation;
}): { readonly witnessUserId: string | undefined; readonly ownTaggedTs: string | undefined } {
  // A fresh tag names the bot; otherwise a retained watch does, and with neither the thread is not watched.
  let witnessUserId = existing?.witnessUserId;
  if (observation.activatesFor !== undefined) {
    witnessUserId = observation.activatesFor;
  }
  // The own watch keeps its FIRST tag: it records that this bot was asked into the thread, not the latest ask.
  let ownTaggedTs = existing?.ownTaggedTs;
  if (observation.tagsSelf && ownTaggedTs === undefined) {
    ownTaggedTs = observation.messageTs;
  }
  return { ownTaggedTs, witnessUserId };
}

/** The later of two Slack `ts` values (they compare numerically, never as strings of unequal length). */
function laterTs({ a, b }: { a: string; b: string }): string {
  return Number(a) >= Number(b) ? a : b;
}

/** The oldest UTC day whose count is still kept: retention back from the thread's newest message. */
function oldestCountedDay({ newestTs }: { newestTs: string }): string {
  const newestMs = slackTsToEpochMs({ ts: newestTs })!;
  return new Date(newestMs - WITNESS_RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Judge one message against the snapshot: activate, remember, spend budget.
 *
 * `handOff: false` is the address path winning — a message that ALSO addresses this bot is answered as an
 * address, so here it may start or refresh witnessing but never spends a line. An over-budget line still
 * moves the thread's last-seen instant, so a busy thread is never forgotten for being busy.
 *
 * @param state the snapshot
 * @param observation the message
 * @param handOff whether an admitted line would be handed off (spending budget)
 * @param nowMs the current instant, epoch ms — a thread past retention is no longer witnessed
 * @returns the next snapshot and what this message got
 */
export function observeWitnessMessage({
  handOff,
  nowMs,
  observation,
  state,
}: {
  handOff: boolean;
  nowMs: number;
  observation: WitnessObservation;
  state: WitnessState;
}): { readonly state: WitnessState; readonly verdict: WitnessVerdict } {
  const key = witnessThreadKey(observation);
  const stored = state.threads[key];
  const existing =
    stored !== undefined && retained({ lastObservedTs: stored.lastObservedTs, nowMs }) ? stored : undefined;
  const { ownTaggedTs, witnessUserId } = watchAfter({ existing, observation });
  const day = slackTsToIso({ ts: observation.messageTs })?.slice(0, 10);
  const watched = witnessUserId !== undefined || ownTaggedTs !== undefined;
  if (!watched || day === undefined) {
    return { state, verdict: { kind: "inactive" } };
  }
  const counts = existing === undefined ? {} : existing.dayCounts;
  const lastObservedTs =
    existing === undefined ? observation.messageTs : laterTs({ a: existing.lastObservedTs, b: observation.messageTs });
  const floor = oldestCountedDay({ newestTs: lastObservedTs });
  const spentThatDay = Object.hasOwn(counts, day) ? counts[day]! : 0;
  // A message from a day whose count is no longer kept is never handed off: its budget cannot be checked.
  const admitted = handOff && day >= floor && spentThatDay < WITNESS_DAILY_LINE_CAP;
  const charged = { ...counts, [day]: spentThatDay + (admitted ? 1 : 0) };
  const thread: WitnessThread = {
    channel: observation.channel,
    dayCounts: Object.fromEntries(Object.entries(charged).filter(([kept]) => kept >= floor)),
    lastObservedTs,
    threadTs: observation.threadTs,
    ...(witnessUserId === undefined ? {} : { witnessUserId }),
    ...(ownTaggedTs === undefined ? {} : { ownTaggedTs }),
  };
  const next: WitnessState = { threads: { ...state.threads, [key]: thread }, version: 1 };
  if (!handOff) {
    return { state: next, verdict: { kind: "recorded", thread } };
  }
  return { state: next, verdict: { kind: admitted ? "admitted" : "over-budget", thread } };
}
