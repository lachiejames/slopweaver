/**
 * What a thread's turn notice does to the typed box (`useTypedTalk.ts`): which turn is running, whether a send still
 * out has been answered, and when an owed send of unknown fate is finally shown as the owner's. Split from the hook,
 * which owns the cells this reads and writes.
 */
import type { PlanCallEvent } from "../../lib/planCallContract";
import type { TypedLookCell } from "../../lib/typedLookGate";
import { type OwedSend, owedTakenBy } from "./typedTalkClient";
import type { HeldTyped, TypedPhase } from "./useTypedTalkSeat";

/** One mutable cell the hook holds across renders. */
interface Cell<T> {
  current: T;
}

/** The typed box's turn state, held by the hook and moved here by each notice. */
export interface TypedTurnCells {
  /** The turns the thread has announced: still running, and ended. */
  readonly turns: Cell<{ completed: Set<string>; running: Set<string> }>;
  /** Whether the thread has announced a turn since the last send went out. */
  readonly turnHeard: Cell<boolean>;
  /** Every turn announced while the last send was out. */
  readonly heardDuring: Cell<Set<string>>;
  /** Whether a send's answer is still out, so `deliver` places the box once it is back. */
  readonly awaiting: Cell<boolean>;
  /** Until when a send of unknown fate still counts as answered (`TYPED_UNSURE_HOLD_MS`). */
  readonly unsureUntilMs: Cell<number | undefined>;
  /** A send of unknown fate, heard once the thread announces a turn it did not hear while it was out. */
  readonly owed: Cell<OwedSend | undefined>;
}

/**
 * The typed conversation's event follower: every event goes to the call's own handler first, then a turn notice moves
 * the box's turn state.
 *
 * @param cells the hook's turn state
 * @param current whether this conversation still holds the seat
 * @param heard records the owner's words as heard on the seat
 * @param onEvent the call's own event handler, which every event reaches first
 * @param setFailure clears the box's failure once an owed send is shown
 * @param setPhase moves the box as a turn starts and the last one running ends
 * @param show writes a line onto the conversation's transcript
 * @param typedLook the look the owner's latest message asked for, moved to replying or dropped with its turn
 * @returns the follower `followPlanCall` hands each event to
 */
export function typedTurnFollower({
  cells,
  current,
  heard,
  onEvent,
  setFailure,
  setPhase,
  show,
  typedLook,
}: {
  cells: TypedTurnCells;
  current: () => boolean;
  heard: (input: { text: string }) => void;
  onEvent: (event: PlanCallEvent) => void;
  setFailure: (failure: string | undefined) => void;
  setPhase: (phase: TypedPhase) => void;
  show: HeldTyped["show"];
  typedLook: TypedLookCell;
}): (event: PlanCallEvent) => void {
  const { awaiting, heardDuring, owed, turnHeard, turns, unsureUntilMs } = cells;
  return (event) => {
    onEvent(event);
    // A notice of a turn already ended, late or replayed, says nothing about the send out now.
    const stale = event.kind === "codex-turn" && turns.current.completed.has(event.turnId);
    if (event.kind !== "codex-turn" || event.phase === "progress" || stale || !current()) {
      return;
    }
    turnHeard.current = true;
    heardDuring.current.add(event.turnId);
    const taken = owed.current;
    if (taken !== undefined && owedTakenBy({ owed: taken, turnId: event.turnId })) {
      // The thread has said where the owed send's turn is, so its guess gives way to its word.
      unsureUntilMs.current = undefined;
      owed.current = undefined;
      show({ final: true, speech: { id: `typed-owner-${taken.messageId}`, text: taken.text, who: "owner" } });
      heard({ text: taken.text });
      setFailure(undefined);
    }
    if (event.phase === "started") {
      const replayed = turns.current.running.has(event.turnId);
      turns.current.running.add(event.turnId);
      setPhase("replying");
      // The turn the owner's message started is the one its look belongs to; a tool call before this is the turn
      // before's, and a notice repeated for a turn already running started nothing new.
      const held = typedLook.get();
      if (held !== undefined && !replayed) {
        typedLook.set({ ...held, phase: "replying" });
      }
      return;
    }
    // A turn ending is the thread done answering the owner, whether it wrote, failed or was stopped.
    turns.current.running.delete(event.turnId);
    turns.current.completed.add(event.turnId);
    // While a send's answer is still out, `deliver` places the box once it is back.
    if (!awaiting.current && turns.current.running.size === 0) {
      setPhase("open");
      if (typedLook.get()?.phase === "replying") {
        typedLook.set(undefined);
      }
    }
  };
}
