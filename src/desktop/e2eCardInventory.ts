/**
 * `desktop e2e --call --call-card all`: every open card the console draws, read off the test instance's own Queue and
 * Alignment pages once each fold is opened (`site/components/console/QueueSections.tsx` and `AlignmentAct.tsx` /
 * `AlignmentRulings.tsx` carry `data-card-key`), and the waits a leg of that length needs. Pure; the reading is
 * `src/cli/commands/desktop/e2eCallCardInventory.ts`.
 *
 * Read off the page rather than rebuilt from the registers, so the cards asked about are the ones the owner would see: the
 * Queue's own withholding, deferral and view rules decide, never a second copy of them here.
 */
import { CARD_KEY } from "../talk/cardKey.js";
import type { E2eCallStep } from "./e2eCallPlan.js";
import { isCardStepId } from "./e2eCardReadPlan.js";

/** The open cards, Queue first, and every key drawn that no card tool could be asked about. */
export interface CardInventory {
  readonly keys: readonly string[];
  readonly refused: readonly string[];
}

/**
 * The inventory from what each page drew: each key once, in the order drawn, the Queue's before Alignment's. A key no
 * card scenario takes — malformed, an Automations recipe or a proposed workstream — is named, never asked about.
 *
 * @param queue the keys the Queue drew
 * @param alignment the keys the Alignment page drew
 * @returns the inventory
 */
export function cardInventoryOf({
  queue,
  alignment,
}: {
  queue: readonly string[];
  alignment: readonly string[];
}): CardInventory {
  const drawn = [...new Set([...queue, ...alignment])];
  const takes = ({ key }: { key: string }): boolean =>
    CARD_KEY.test(key) && !key.startsWith("recipe:") && !key.startsWith("candidate:");
  return { keys: drawn.filter((key) => takes({ key })), refused: drawn.filter((key) => !takes({ key })) };
}

/** How many reads in a row must agree before a page's keys count as drawn. */
const STABLE_READS = 3;

/**
 * Whether a page has finished drawing its cards: the last {@link STABLE_READS} reads hold the same keys, no fold is
 * left closed, and the reading has run long enough that an empty page is not one still loading.
 *
 * @param reads every read so far, each the keys in drawn order
 * @param foldsLeft how many fold controls the last read still showed
 * @param elapsedMs how long the page has been read
 * @param minimumMs the least time before a reading may settle
 * @returns whether to stop reading
 */
export function inventorySettled({
  reads,
  foldsLeft,
  elapsedMs,
  minimumMs,
}: {
  reads: readonly (readonly string[])[];
  foldsLeft: number;
  elapsedMs: number;
  minimumMs: number;
}): boolean {
  const last = reads.slice(-STABLE_READS).map((keys) => keys.join("\n"));
  return (
    foldsLeft === 0 && elapsedMs >= minimumMs && last.length === STABLE_READS && last.every((keys) => keys === last[0])
  );
}

/** The longest a call leg's lock was ever held, and the least a lock is now held for before a new leg may take it. */
const LOCK_STALE_FLOOR_MS = 2 * 60 * 60 * 1000;

/** Each scenario's launch, cleanup and preflight beside its cap: a judgement value, generous on purpose. */
const STEP_OVERHEAD_MS = 10 * 60 * 1000;

/** An inventory leg's lock: its length is unknown when the lock is taken, so it is held for half a day. */
const INVENTORY_LOCK_STALE_MS = 12 * 60 * 60 * 1000;

/** How long a leg of the ordinary scenarios waits for a call it did not place to end. */
const FOREIGN_CALL_WAIT_MS = 180_000;

/**
 * How long a leg reading cards waits for one: a sweep across every open card outlasts many calls, and stopping
 * at the first would leave the sweep for the owner to restart. Waiting is never overlapping, so the rail holds either way.
 */
const CARD_LEG_FOREIGN_CALL_WAIT_MS = 30 * 60 * 1000;

/**
 * How old a leg's lock may grow before a new leg takes it over: past the whole planned leg, never under the floor, so
 * a sweep of many cards is not taken over mid-run as a dead one.
 *
 * @param steps the planned scenarios
 * @param inventory whether the cards are read from the console once the leg starts
 * @returns milliseconds
 */
export function legLockStaleMs({ steps, inventory }: { steps: readonly E2eCallStep[]; inventory: boolean }): number {
  if (inventory) {
    return INVENTORY_LOCK_STALE_MS;
  }
  const planned = steps.reduce((sum, step) => sum + step.capMs + step.holdMs + STEP_OVERHEAD_MS, 0);
  return Math.max(LOCK_STALE_FLOOR_MS, planned);
}

/**
 * How long the preflight waits for a call it did not place to end before refusing.
 *
 * @param steps the planned scenarios
 * @param inventory whether the cards are read from the console once the leg starts
 * @returns milliseconds
 */
export function foreignCallWaitMs({ steps, inventory }: { steps: readonly E2eCallStep[]; inventory: boolean }): number {
  return inventory || steps.some((step) => isCardStepId({ id: step.id }))
    ? CARD_LEG_FOREIGN_CALL_WAIT_MS
    : FOREIGN_CALL_WAIT_MS;
}
