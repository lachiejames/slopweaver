/**
 * Which items each of a plan call's Codex turns has in flight, and how long it waits on the model with none, measured
 * on the call's own clock so a long wait leaves one `model-wait` line in the call file (`PlanModelWaitEvent`,
 * `./talkPlanCodexEvents.ts`). On the server rather than the page, so a page that reconnects and replays events never
 * writes a wait twice, and so the page is told a turn is awaiting the model only once its LAST item in flight ends.
 *
 * A wait opens when the turn first starts and when its last item in flight completes, and closes when the next item
 * starts or the turn ends. Items overlap: a turn can run two tools at once, and the first one ending leaves the turn
 * on the other, never on the model. Codex re-sending a dropped request keeps the wait open: what the owner sat through
 * is the time no item ran, and the `codex-retry` line says a re-send happened inside it.
 */
import { AWAITING_MODEL, type WorkStep } from "./responsesStep";
import type { PlanModelWaitEvent } from "./talkPlanCodexEvents";
import { turnActivityOf } from "./talkPlanProtocolTurns";
import { STALL_MS } from "./voiceActivityState";

/** One running turn's items in flight, by item id with the step each named, the ids already ended, and its open wait. */
export interface TurnItems {
  /** When the turn's wait on the model opened on the call's clock, `undefined` while an item runs. */
  openedMs: number | undefined;
  readonly inFlight: Map<string, WorkStep>;
  /** Every item id the turn has seen complete, so a start of one replayed after its end never splits a wait. */
  readonly ended: Set<string>;
}

/** Every running turn's items, by turn id. */
export type CallTurnItems = Map<string, TurnItems>;

/**
 * What moves one turn's items: the turn starting or ending, or one of its items starting or completing. An item with
 * no id cannot be told from another, so it closes a wait as it starts and is never counted in flight.
 */
export type TurnItemInput =
  | { readonly kind: "turn-started"; readonly turnId: string }
  | {
      readonly kind: "item-started";
      readonly turnId: string;
      readonly itemId: string | undefined;
      readonly step: WorkStep;
    }
  | { readonly kind: "item-completed"; readonly turnId: string; readonly itemId: string | undefined }
  | { readonly kind: "turn-ended"; readonly turnId: string };

/** What one input moved: the step the page should show, `null` to keep its own, and the line a closed wait is owed. */
export interface TurnItemMove {
  readonly turnId: string;
  readonly step: WorkStep | null;
  readonly wait: PlanModelWaitEvent | undefined;
}

/**
 * Close a turn's open wait, returning its line when it reached the orb's stall horizon, {@link STALL_MS}: a shorter
 * one never drew the orb's quiet state, so it says nothing the call file needs.
 */
function closedWaitOf({
  items,
  turnId,
  nowMs,
}: {
  items: TurnItems;
  turnId: string;
  nowMs: number;
}): PlanModelWaitEvent | undefined {
  const { openedMs } = items;
  items.openedMs = undefined;
  if (openedMs === undefined || nowMs - openedMs < STALL_MS) {
    return undefined;
  }
  return { kind: "model-wait", turnId, waitMs: nowMs - openedMs };
}

/**
 * Fold one input into the call's turns. A start keeps a wait already open, a start of an item already ended moves
 * nothing (Codex review r2: a replayed start and end of one item split a single wait into two lines), a completion of
 * an item not in flight removes nothing, and a close of no wait closes nothing, so a replayed notice changes nothing.
 *
 * @param turns every running turn's items, updated here
 * @param input what just happened to the turn
 * @param nowMs the call's clock now
 * @returns the step to show — the item's own on a start, the newest item still in flight or awaiting the model on a
 *   completion — and the `model-wait` line a long wait that just closed is owed
 */
export function turnItemMoveOf({
  turns,
  input,
  nowMs,
}: {
  turns: CallTurnItems;
  input: TurnItemInput;
  nowMs: number;
}): TurnItemMove {
  const { turnId } = input;
  let items = turns.get(turnId);
  if (input.kind === "turn-ended") {
    turns.delete(turnId);
    const wait = items === undefined ? undefined : closedWaitOf({ items, nowMs, turnId });
    return { step: null, turnId, wait };
  }
  if (items === undefined) {
    items = { ended: new Set(), inFlight: new Map(), openedMs: undefined };
    turns.set(turnId, items);
  }
  if (input.kind === "item-started") {
    if (input.itemId !== undefined && items.ended.has(input.itemId)) {
      return { step: null, turnId, wait: undefined };
    }
    if (input.itemId !== undefined) items.inFlight.set(input.itemId, input.step);
    return { step: input.step, turnId, wait: closedWaitOf({ items, nowMs, turnId }) };
  }
  if (input.kind === "item-completed" && input.itemId !== undefined) {
    items.inFlight.delete(input.itemId);
    items.ended.add(input.itemId);
  }
  const newest = [...items.inFlight.values()].at(-1);
  if (newest !== undefined) {
    return { step: input.kind === "item-completed" ? newest : null, turnId, wait: undefined };
  }
  items.openedMs ??= nowMs;
  return { step: input.kind === "item-completed" ? AWAITING_MODEL : null, turnId, wait: undefined };
}

/**
 * What one item notification moves, for an item of a running turn of the call's own thread: its start closes the
 * turn's wait and names its step, its completion leaves the turn on its newest item still in flight or, with none,
 * opens the next wait. A delta or the owner's own words' item moves nothing and names no step, so a message half
 * written keeps saying it is writing.
 *
 * @param method the notification's method
 * @param params the notification's params
 * @param threadId the call's own thread
 * @param running the call's Codex turns running now
 * @param turns every running turn's items, updated here
 * @param nowMs the call's clock now
 * @returns what it moved, or `undefined` for another thread's item, one of a turn not running, or no item notification
 */
export function itemMoveOf({
  method,
  params,
  threadId,
  running,
  turns,
  nowMs,
}: {
  method: string;
  params: unknown;
  threadId: string | undefined;
  running: ReadonlySet<string>;
  turns: CallTurnItems;
  nowMs: number;
}): TurnItemMove | undefined {
  const activity = turnActivityOf({ method, params });
  if (activity === undefined || activity.threadId !== threadId || !running.has(activity.turnId)) {
    return undefined;
  }
  const { turnId } = activity;
  if (activity.phase === "started") {
    const input = { itemId: activity.itemId, kind: "item-started", step: activity.step, turnId } as const;
    return turnItemMoveOf({ input, nowMs, turns });
  }
  if (activity.phase === "completed") {
    return turnItemMoveOf({ input: { itemId: activity.itemId, kind: "item-completed", turnId }, nowMs, turns });
  }
  return { step: null, turnId, wait: undefined };
}
