/**
 * What a spawn does about its composer once pickup delivery has ended — the pure half of
 * `./pickupComposerConfirm.ts`'s `confirmPickupLeftComposer`, kept apart so the Enter budget is a table a test
 * can read whole.
 *
 * MEASURED: workspace:327, 328 and 330 returned from `cmux spawn` with their pickup still typed in
 * the composer and sat about seventy minutes running nothing. The rule this encodes: a seat never sits with its pickup typed and unsubmitted: press Enter while the box still
 * holds the line, and refuse with the workspace named if it stays there.
 *
 * ## Why the budget is more than one Enter
 *
 * It was one, on `./reach.ts`'s ARGUED reason — a box that ignored one Enter is held by something a second
 * keystroke does not move. On a freshly booted seat the record says the opposite. One hand
 * `slopweaver cmux submit`, a bare Enter seventy minutes late, started all three seats above within
 * seconds. In another case workspace:588 and 590 had already
 * had the spawn's blind resubmit and still read `composer: TYPED, unsubmitted`, and the chair's later
 * `cmux send` of a bare `go` — the same Enter, behind two more characters — started both. So an Enter a booting
 * session ignores is one pressed too EARLY, and the chair kept being the one to press the later one.
 *
 * A further Enter costs nothing it could damage: it is pressed only on a box POSITIVELY read `typed` (a dialog or
 * menu that replaces the composer reads `unreadable` and is accepted), and `submitComposer` types nothing, so the
 * only line it can ever submit is the pickup already sitting there.
 *
 * ## Why the box is read while the witness chain is still watching
 *
 * MEASURED on cmux 0.65.2 with Claude Code 2.1.310: the Enter `sendLine` presses one second after its
 * paste did not submit on 4 seats out of 4 — the box read `typed` on every tick, no `latest_submitted_message`,
 * no `UserPromptSubmit` — while a bare Enter pressed 2.2 s, 6 s or 31 s after it submitted every time, the box
 * reading `empty` and the footer `esc to interrupt` on the very next read. Eight seats sat idle that day. Waiting
 * out a whole witness window before the first rescue wasted thirty seconds of a box positively seen holding the
 * line, so {@link decidePickupPoll} presses inside it. Reproduce on a seat booted seconds ago:
 * `slopweaver cmux send --workspace <ref> "<a long line>"` reports `resubmitted` when the paste's own Enter did
 * not take, and `slopweaver knowledge list --domain cmux` carries the row with the probe.
 */
import type { ComposerReading } from "./composer.js";

/**
 * How many Enters a spawn's pickup may have in total, counting EVERY one: `sendLine`'s own, the chain's blind
 * resubmit when it presses one, the early Enters {@link decidePickupPoll} presses, and the composer gate's.
 *
 * A BOUND, not a measurement: nothing has timed how late a booting session starts taking a submit, only that a
 * later Enter took in every incident. Four keeps the total the gate had when `sendLine`'s Enter went uncounted.
 */
export const MAX_PICKUP_ENTERS = 4;

/**
 * The ticks to let a box positively read `typed` sit after the FIRST Enter before pressing another, growing by
 * this much for each Enter already spent, so a later press gives a slower boot longer.
 *
 * Measured (this module's header): a bare Enter 2.2 s after `sendLine`'s took, so two one-second
 * ticks is the first early Enter; the growth is a bound, spreading {@link MAX_PICKUP_ENTERS} across about twenty
 * seconds rather than spending them all in the first six.
 */
const PICKUP_ENTER_SPACING_TICKS = 2;

/** Where one pickup's Enters stand while the witness chain is still watching. */
export interface PickupSubmitState {
  /** Every Enter pressed so far, `sendLine`'s included. */
  readonly entersSpent: number;
  /** The ticks read since the last Enter, this one included. */
  readonly ticksSinceEnter: number;
  /** Whether any Enter so far was pressed on a box positively read `typed` — only then does an emptied box say it took. */
  readonly pressedOnTyped: boolean;
}

/** What the witness window does on one tick the chain answered nothing on. */
export type PickupPollDecision =
  /** Nothing to press yet: the box is not holding the line, cannot be read, or its last Enter is still settling. */
  | { readonly kind: "wait" }
  /** The box has held the line past its spacing and an Enter is still unspent: press one bare Enter. */
  | { readonly kind: "submit"; readonly text: string }
  /** A box this window pressed on now reads empty: the Enter took, and the emptied box is the witness. */
  | { readonly kind: "left-composer" }
  /** The box still holds the line after every Enter and its spacing: stop watching, the gate refuses. */
  | { readonly kind: "budget-spent"; readonly text: string };

/**
 * How many ticks the box must sit `typed` after the last Enter before the next is pressed.
 *
 * @param entersSpent every Enter pressed so far
 * @returns the spacing in ticks, growing with every Enter spent ({@link PICKUP_ENTER_SPACING_TICKS} apiece)
 */
export function pickupEnterSpacing({ entersSpent }: { entersSpent: number }): number {
  return PICKUP_ENTER_SPACING_TICKS * entersSpent;
}

/**
 * Decide one witness-window tick from the composer, once the chain has answered nothing on it.
 *
 * Only a positively `typed` box is ever pressed on, and only after {@link pickupEnterSpacing} ticks — an Enter
 * pressed onto a submit still taking would be pressed on nothing, and one pressed too early is the incident. A
 * box that reads anything else but `unreadable` after an Enter this window pressed on a typed box is the line
 * LEAVING it, which is what a submit is. A box never seen typed emptying is no such evidence, so it waits.
 *
 * @param reading what the box is known to hold, folded by {@link foldComposerReading}
 * @param state where this pickup's Enters stand, `ticksSinceEnter` counting this tick
 * @returns wait, submit, left-composer, or budget-spent with the stuck text
 */
export function decidePickupPoll({
  reading,
  state,
}: {
  reading: ComposerReading;
  state: PickupSubmitState;
}): PickupPollDecision {
  if (reading.kind !== "typed") {
    const leftIt = state.pressedOnTyped && reading.kind !== "unreadable";
    return leftIt ? { kind: "left-composer" } : { kind: "wait" };
  }
  if (state.ticksSinceEnter < pickupEnterSpacing({ entersSpent: state.entersSpent })) {
    return { kind: "wait" };
  }
  if (state.entersSpent < MAX_PICKUP_ENTERS) {
    return { kind: "submit", text: reading.text };
  }
  return { kind: "budget-spent", text: reading.text };
}

/** What the gate does next. */
export type PickupComposerDecision =
  /** The box is not holding a typed line — or cannot be read — so the delivery stands as reported. */
  | { readonly kind: "accept" }
  /** The box holds the line and an Enter is still unspent: press it. */
  | { readonly kind: "submit"; readonly text: string }
  /** The box holds the line and every Enter is spent: the spawn refuses, carrying what is stuck there. */
  | { readonly kind: "refuse"; readonly text: string };

/**
 * Decide the gate's next act from one composer reading.
 *
 * Only a positively `typed` box ever submits or refuses. `unreadable` accepts because not knowing is not
 * evidence of a strand (`./composer.ts`'s honesty rule) — every Codex seat lands there, its composer chrome
 * never measured. A `suggestion` or `placeholder` is Claude Code's own faint text, never the pickup.
 *
 * @param reading what `readComposer` said about the box
 * @param entersSpent how many Enters this pickup has already had — `sendLine`'s, any the witness window pressed,
 *   and each of this gate's own — counting one cmux refused
 * @returns accept, submit, or refuse with the stuck text
 */
export function decidePickupComposer({
  reading,
  entersSpent,
}: {
  reading: ComposerReading;
  entersSpent: number;
}): PickupComposerDecision {
  if (reading.kind !== "typed") {
    return { kind: "accept" };
  }
  return { kind: entersSpent < MAX_PICKUP_ENTERS ? "submit" : "refuse", text: reading.text };
}

/**
 * Fold one more composer read into what the gate already knows about the box.
 *
 * An `unreadable` read never overwrites a `typed` one: a grid that failed to read once the line was seen in
 * the box is no evidence the line left it, so the last positive observation stands. Review found
 * the gap this closes — a positively typed pickup, one Enter, then a single failed grid read, and the spawn
 * returned `resubmitted` by `composer` without ever seeing the box empty. Every other read replaces the
 * previous one, so a box that never read `typed` still answers `unreadable` at once and a Codex seat pays no
 * extra ticks.
 *
 * @param previous what the box was last known to hold — `unreadable` before the first read
 * @param next the read just taken
 * @returns what the box is now known to hold
 */
export function foldComposerReading({
  previous,
  next,
}: {
  previous: ComposerReading;
  next: ComposerReading;
}): ComposerReading {
  if (previous.kind === "typed" && next.kind === "unreadable") {
    return previous;
  }
  return next;
}
