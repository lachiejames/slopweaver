/**
 * The tick gate that makes a steer the owner spoke over a Queue card impossible to leave unpicked while a chair is live: a
 * tick is refused while any steer registered at or before the tick STARTED carries no evidence of action.
 *
 * A "Not picked up" card should only appear when no fleet session has capacity to take the steer. The failure case:
 * seven of the owner's steers in one day had been typed into the chair's
 * chat and sat for hours. The chair's passes ran, marked the owner's CALL words read (`./voiceUnreadGate.ts` judges only the
 * `talk unread` cursor) and recorded their ticks, and nothing read the relay ROWS those words had become:
 * `handover reconcile` names only the relays that never reached the chat (`../talk/relayIntake.ts`
 * `undeliveredRelays` skips a `typed` or `queued` delivery), and the one reader that judges a delivered relay,
 * `../talk/steeredCardsRead.ts` `readSteeredCards`, was called by `talk steers` for the console alone. The duty to
 * mark every card relay lived only as prose in `skills/supervisor/reference/routing.md`. So each pass that came and
 * went turned a steer into "Not picked up" on the owner's Queue, and no gate saw it.
 *
 * ## The deadline is this tick's START, because this tick is what turns a steer into "Not picked up"
 *
 * `../talk/steeredCards.ts` `firstPassAfter` brings a steer back once the first tick that STARTED at or after it
 * registered has finished. A steer registered at or before this tick's `startedIso` with no action is therefore one
 * this record would put back on the owner's Queue; one already back (`missed-pass`, `chair-down`) is a pass that already
 * missed it, and a `landing-missing` one is a steer whose card landing never wrote — still unacted, still the owner's word.
 * Every one of those refuses. A steer registered after the tick started is the next tick's, and is passed. The start
 * is stamped once at capture (`scratchRun.ts` `captureTick`), so a refused `tick close` re-runs against the same
 * deadline: a steer the owner speaks while the chair fixes the refusal never joins the set it must clear.
 *
 * ## The same verdict function the Queue reads
 *
 * The verdicts come from `readSteeredCards`, the reading `talk steers` serves the console. The page judges only the
 * steers it collapsed itself, so the gate reads a superset of what the page can draw, never a different criterion. A
 * `kept` or `restored` card is a decision somebody made on it, and is passed. A steer whose evidence did not read is
 * refused — a check that reports clean on an input it never saw is worse than no check — and one intake mark on its
 * `talk:<turnId>` clears it, because `relayAction` reads the mark before any other source.
 *
 * ## Residue, stated rather than discovered
 *
 * - A steer whose own registration instant does not parse can never be cleared (`steerVerdict` returns `unread` before
 *   it reads any action, and the window never ages it out), so it is PASSED, and named whenever the gate refuses; so
 *   are relay-ledger lines that did not decode. A clean tick prints neither.
 * - Only a relay that named a Queue card is a steer here (`steerReceipts`). A relay spoken with no card open is an
 *   owner turn in the chair's chat and a board row, and this gate does not read it. MEASURED over one week: 972 such
 *   relays registered against 120 that named a card — reproduce with
 *   `jq -r 'select(.state=="registered" and (.about//"")=="" and .registeredAtIso>="<window start>") | .turnId' ~/.slopweaver/talk/relays.jsonl | sort -u | wc -l`.
 * - The read is the Queue's own seven-day window (`STEER_WINDOW_MS`, `src/talk/steeredCardsRead.ts`), so a steer
 *   registered more than a week before the tick is passed unseen. The Queue stops drawing it as Not picked up at the
 *   same instant, which is why the gate shares the window rather than reading further back — but one left unacted
 *   for a week, behind an open hatch or a chair that was down, is dropped by both, not answered.
 * - The manual `tick-record` path takes `startedIso` from `tick-draft --started`, which the chair writes; nothing
 *   refuses one set too early.
 *
 * Pure: the read is the shell's, taken once per tick (`src/cli/commands/supervisor/tickRecordRun.ts`).
 */
import type { SteeredCardsReading } from "../talk/steeredCardsRead.js";

/** One steer as the reading carries it. */
export type JudgedSteer = SteeredCardsReading["steers"][number];

/** What the shell read of the steers: the reading, or why it could not be made. */
export type UnpickedSteerRead =
  | { readonly kind: "read"; readonly steers: readonly JudgedSteer[]; readonly undecodedRelays: number }
  | { readonly kind: "unreadable"; readonly why: string };

/** The gate's verdict on one tick. `undated` is every steer passed because its registration does not parse. */
export type UnpickedSteerVerdict =
  | { readonly kind: "clean"; readonly undated: readonly JudgedSteer[]; readonly undecodedRelays: number }
  | {
      readonly kind: "refused";
      readonly steers: readonly JudgedSteer[];
      readonly undated: readonly JudgedSteer[];
      readonly undecodedRelays: number;
    }
  | { readonly kind: "unreadable"; readonly why: string };

/**
 * Whether one steer carries a decision: action on it, or a restore somebody chose.
 *
 * @param steer the steer, with the Queue's verdict on it
 * @returns true when nothing is owed on it
 */
function decided({ steer }: { steer: JudgedSteer }): boolean {
  const { verdict } = steer;
  return verdict.kind === "settled" || (verdict.kind === "reverted" && ["kept", "restored"].includes(verdict.reason));
}

/**
 * Judge one tick: refused while any steer it is the deadline for has no action, unreadable when the read failed or
 * the tick's own start does not parse.
 *
 * @param read what the shell read
 * @param startedIso when this tick started — a steer registered after it is the next tick's
 * @returns the verdict
 */
export function judgeUnpickedSteers({
  read,
  startedIso,
}: {
  read: UnpickedSteerRead;
  startedIso: string;
}): UnpickedSteerVerdict {
  if (read.kind === "unreadable") {
    return read;
  }
  const deadline = Date.parse(startedIso);
  if (Number.isNaN(deadline)) {
    return { kind: "unreadable", why: `the tick's start ${startedIso} does not parse, so no deadline can be judged` };
  }
  const open = read.steers.filter((steer) => !decided({ steer }));
  const undated = open.filter((steer) => Number.isNaN(Date.parse(steer.registeredAtIso)));
  const owed = open.filter((steer) => Date.parse(steer.registeredAtIso) <= deadline);
  if (owed.length === 0) {
    return { kind: "clean", undated, undecodedRelays: read.undecodedRelays };
  }
  return { kind: "refused", steers: owed, undated, undecodedRelays: read.undecodedRelays };
}
