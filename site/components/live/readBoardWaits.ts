/**
 * What a board row is waiting on and how its ask ended — the two closed vocabularies `./read.ts`'s
 * `readBoardRow` refuses an unknown word of. A sibling of `./read.ts`, under every rule its module doc states.
 */
import { type Bag } from "../../lib/bag";

/**
 * The kind of the one verdict a surface may render as needing the owner. The console's copy of
 * `src/handover/ownerWait.ts`'s `OWNER_WAIT_KIND`, beside the closed list it governs;
 * `site/__tests__/unit/ownerVocabularyMirror.test.ts` binds the two, since a console knowing another value would
 * refuse a whole board the CLI published.
 */
export const OWNER_WAIT_KIND = "owner" as const;

/**
 * What a board row is really waiting on, as `handover list --json` publishes it.
 *
 * Spelled here rather than imported because `site/` imports nothing from `src/`; the producer is
 * `src/handover/ownerWait.ts`, which carries the measurement that made it necessary — 42 rows on this
 * board held an open recorded question and 21 of them were not waiting on the owner at all.
 */
export type OwnerWait = "not-waiting" | "settled" | "already-ruled" | "not-runnable" | typeof OWNER_WAIT_KIND;

/** Every verdict the verb may print, so an unrecognised one refuses the reading rather than passing through. */
const OWNER_WAITS: readonly OwnerWait[] = ["not-waiting", "settled", "already-ruled", "not-runnable", OWNER_WAIT_KIND];

/**
 * One verdict, or nothing when the field is absent or is a word this build does not know.
 *
 * Unknown refuses, per this module's own rule: a verdict nobody can read is the verb's shape having moved,
 * and the safe rendering of that is a tile saying so — never a row quietly rejoining the list of things the owner
 * owes an answer to.
 *
 * @param value the raw field
 * @returns the verdict, or `undefined`
 */
export function ownerWaitOf({ value }: { value: string | undefined }): OwnerWait | undefined {
  return OWNER_WAITS.find((candidate) => candidate === value);
}

/**
 * Whether a row's verdict is the owner's — the one test every console reader of a row's `ownerWait` takes.
 *
 * @param ownerWait the verdict as the row carries it
 * @returns true when the row waits on the owner's word
 */
export function waitsOnOwner({ ownerWait }: { ownerWait: string }): boolean {
  return ownerWait === OWNER_WAIT_KIND;
}

/** How an ask ended, as `src/handover/rowKind.ts` names the three settlements. */
export type AskSettlement = "filed" | "answered" | "declined";

/** Every settlement the verb may publish, so an unrecognised one refuses the reading. */
const SETTLEMENTS: readonly AskSettlement[] = ["filed", "answered", "declined"];

/**
 * A row's published settlement: absent on an open row, and a word this build does not know refuses the board — read
 * as absent, a settled ask would read as an open one, which is the defect `listJson.ts`'s `status` once was.
 *
 * @param row the published board row
 * @returns the settlement, `undefined` when absent, or `"unread"` when present and unknown
 */
export function settlementOf({ row }: { row: Bag }): AskSettlement | undefined | "unread" {
  const value = row["settlement"];
  if (value === undefined) {
    return undefined;
  }
  const known = SETTLEMENTS.find((candidate) => candidate === value);
  if (known === undefined) {
    return "unread";
  }
  return known;
}
