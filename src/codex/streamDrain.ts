/**
 * The SDK's event stream, drained into one completed turn (`./client.ts`): the turn rebuilt event by event, every
 * observed step relayed to the caller's sink, and the turn's item activity counted honestly. Split from the client so
 * the locked policy and the stream it reads can each be held in one read.
 */
import { isOneOf } from "../lib/parsers.js";
import type { CodexSdkStreamEvent, CodexSdkTurn } from "./client.js";
import {
  type CodexEventSink,
  type CodexItemKind,
  type CodexObservedEvent,
  type CodexObservedItem,
  type ItemActivity,
  KNOWN_CODEX_ITEM_KINDS,
} from "./types.js";

/** The SDK's raw item `type`, narrowed to a known kind or the honest `"unknown"` catch-all. */
function toItemKind({ rawType }: { rawType: string }): CodexItemKind {
  return isOneOf(rawType, KNOWN_CODEX_ITEM_KINDS) ? rawType : "unknown";
}

/**
 * Count items by kind. A measured zero is meaningful: a well-scoped pass makes no tool calls.
 *
 * An item the stream STARTED and never completed was never counted, so the counts would claim less than the model
 * did: a command that began, read a file and never reported back reads as no command at all. That turn's activity is
 * not measured (the Slack draft pass withholds a draft on any tool use).
 *
 * @param turn the drained turn
 * @returns the counts per kind, or not measured when an item never completed
 */
export function toItemActivity({ turn }: { turn: CodexSdkTurn }): ItemActivity {
  if (turn.unfinished > 0) {
    return { kind: "not-measured", reason: "item-unfinished" };
  }
  const items = turn.items;
  const counts: Partial<Record<CodexItemKind, number>> = {};
  for (const item of items) {
    const kind = toItemKind({ rawType: item.type });
    counts[kind] = countOf({ count: counts[kind] }) + 1;
  }
  return { counts, kind: "measured" };
}

/**
 * Narrow one completed SDK item onto the product's observed shape.
 *
 * `text` rides along so the observed stream carries the model's words, not only counters. It is the only copy
 * that survives an abort: `run()` rejects, so the `Turn` holding `finalResponse` is never returned.
 */
function toObservedItem({ item }: { item: NonNullable<CodexSdkStreamEvent["item"]> }): CodexObservedItem {
  return {
    changedPaths: item.changes?.map((change) => change.path),
    command: item.command,
    exitCode: item.exit_code,
    itemKind: toItemKind({ rawType: item.type }),
    query: item.query,
    text: item.text,
  };
}

/**
 * Deliver one observed event, swallowing anything the sink throws.
 *
 * The same rule `src/lib/progressRichEmitter.ts` applies to its sinks, for the same reason: a relay that fails must not
 * be able to kill a pass that is otherwise fine. A pass costs real money and up to an hour.
 */
function notify({ sink, event }: { sink: CodexEventSink | undefined; event: CodexObservedEvent | null }): void {
  if (sink === undefined || event === null) {
    return;
  }
  try {
    sink(event);
  } catch {
    // Deliberately ignored — see the doc comment.
  }
}

/**
 * Drain the SDK's event stream into a completed turn, emitting observed events on the way.
 *
 * This reconstructs what `run()` used to hand back, which is why it must be exact:
 * - `items` accumulate from `item.completed`, so the counts match the blocking call's; an `item.started` with no
 *   completion is tallied as `unfinished`, which leaves the turn's activity not measured.
 * - `usage` arrives once, on `turn.completed`. If the turn never completes it stays null, which the client renders
 *   as NOT MEASURED rather than zero.
 * - `finalResponse` is the LAST `agent_message` text. A turn can emit several; the final one is the answer,
 *   and taking the first would silently return a mid-turn thought as the verdict.
 *
 * @param events the SDK's streamed events for one turn
 * @param sink where each observed step is relayed, when the caller asked
 * @returns the completed turn
 */
export async function drainStream({
  events,
  sink,
}: {
  events: AsyncIterable<CodexSdkStreamEvent>;
  sink: CodexEventSink | undefined;
}): Promise<CodexSdkTurn> {
  let drained = EMPTY_DRAIN;
  try {
    for await (const event of events) {
      drained = foldStreamEvent({ drained, event });
      notify({ event: toObservedEvent({ event }), sink });
      if (drained.failure !== undefined) {
        break;
      }
    }
  } catch (error: unknown) {
    if (!drained.completed) {
      throw error;
    }
    // A THROW AFTER `turn.completed` DOES NOT UNDO THE TURN. The SDK throws when `codex exec` exits non-zero,
    // which it can do while shutting down after the answer was already streamed; treating that as a transport
    // fault recorded a completed answer as FATAL. The late
    // failure is still relayed, so the stream log shows it — it just cannot erase the answer.
    notify({ event: { kind: "turn-failed", message: lateFailureMessage({ error }) }, sink });
  }
  if (drained.failure !== undefined) {
    // A FAILED TURN THROWS, exactly as the SDK's own blocking `run()` does. Draining on past it returned the
    // empty response a failed turn leaves behind, which validated as `invalid-output` — a no-verdict telling
    // the reader to narrow the question, over a transport that had refused the turn outright.
    throw new Error(drained.failure);
  }
  const unfinished = [...drained.open.values()].reduce((sum, open) => sum + open, 0);
  return { finalResponse: drained.finalResponse, items: drained.items, unfinished, usage: drained.usage };
}

/** What the stream has said so far: the turn being rebuilt, plus whether it completed or failed. */
interface DrainedStream extends Omit<CodexSdkTurn, "unfinished"> {
  readonly completed: boolean;
  /** The failed turn's message, once a `turn.failed` arrives — the drain stops there. */
  readonly failure: string | undefined;
  /** Items started and not yet completed, per raw item type. */
  readonly open: ReadonlyMap<string, number>;
}

/** A stream that has said nothing yet. */
const EMPTY_DRAIN: DrainedStream = {
  completed: false,
  failure: undefined,
  finalResponse: "",
  items: [],
  open: new Map(),
  usage: null,
};

/** The open tally with one item of `type` started (`by` 1) or completed (`by` -1), never below zero. */
function shiftOpen({
  open,
  type,
  by,
}: {
  open: ReadonlyMap<string, number>;
  type: string;
  by: 1 | -1;
}): Map<string, number> {
  const next = new Map(open);
  next.set(type, Math.max(0, countOf({ count: open.get(type) }) + by));
  return next;
}

/** A tally's count: a kind never seen yet has been seen zero times, which is a count, not a missing value. */
function countOf({ count }: { count: number | undefined }): number {
  if (count === undefined) {
    return 0;
  }
  return count;
}

/** Fold one stream event into the turn being rebuilt. Pure. */
function foldStreamEvent({ drained, event }: { drained: DrainedStream; event: CodexSdkStreamEvent }): DrainedStream {
  if (event.type === "item.started" && event.item !== undefined) {
    return { ...drained, open: shiftOpen({ by: 1, open: drained.open, type: event.item.type }) };
  }
  if (event.type === "item.completed" && event.item !== undefined) {
    return completedItem({ drained, item: event.item });
  }
  if (event.type === "turn.completed") {
    // Usage the SDK left off is NOT MEASURED, which the client renders from `null`, never as zero.
    if (event.usage === undefined) {
      return { ...drained, completed: true, usage: null };
    }
    return { ...drained, completed: true, usage: event.usage };
  }
  // A `turn.failed` AFTER `turn.completed` cannot undo the turn either — the same rule as a late throw. It is still relayed by the caller; it just does not become the failure.
  const failsTheTurn = event.type === "turn.failed" && !drained.completed;
  return failsTheTurn ? { ...drained, failure: failureMessage({ event }) } : drained;
}

/** One completed item folded in: counted, closed, and the answer when it is an agent message carrying text. */
function completedItem({
  drained,
  item,
}: {
  drained: DrainedStream;
  item: NonNullable<CodexSdkStreamEvent["item"]>;
}): DrainedStream {
  const items = [...drained.items, { type: item.type }];
  const open = shiftOpen({ by: -1, open: drained.open, type: item.type });
  // Only an agent message carrying text is a newer answer; any other item leaves the last one standing.
  if (item.type !== "agent_message" || item.text === undefined) {
    return { ...drained, items, open };
  }
  return { ...drained, finalResponse: item.text, items, open };
}

/** The words a throw after a completed turn carried, for the relay. */
function lateFailureMessage({ error }: { error: unknown }): string {
  const said = error instanceof Error ? error.message : "";
  return said.trim().length > 0 ? `after the turn completed: ${said}` : `after the turn completed: ${UNSTATED_FAILURE}`;
}

/** The failure text when the transport reports one without saying what it was. */
const UNSTATED_FAILURE = "the stream reported a failure with no message";

/**
 * The words a failure event carries, or {@link UNSTATED_FAILURE}.
 *
 * A BLANK message counts as no message. The nullish fallback this replaced caught an absent field and let `""`
 * through, so an empty report rendered as "the turn failed: " and recorded a cause that said nothing.
 */
function failureMessage({ event }: { event: CodexSdkStreamEvent }): string {
  const candidates = [event.error?.message, event.message];
  const stated = candidates.find((text) => text !== undefined && text.trim().length > 0);
  if (stated === undefined) {
    return UNSTATED_FAILURE;
  }
  return stated;
}

/** Narrow one SDK stream event onto the product's observed shape, or nothing when it carries no signal. */
function toObservedEvent({ event }: { event: CodexSdkStreamEvent }): CodexObservedEvent | null {
  if (event.type === "thread.started" && event.thread_id !== undefined) {
    return { kind: "thread-started", threadId: event.thread_id };
  }
  if (event.type === "item.completed" && event.item !== undefined) {
    return { item: toObservedItem({ item: event.item }), kind: "item" };
  }
  if (event.type === "turn.completed") {
    return { kind: "turn-completed" };
  }
  if (event.type === "turn.failed" || event.type === "error") {
    // An unstated failure is named rather than blanked: an empty message renders as "the turn failed: " and
    // reads like a truncation bug rather than a transport that told us nothing.
    return { kind: "turn-failed", message: failureMessage({ event }) };
  }
  return null;
}
