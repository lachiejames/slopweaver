/**
 * {@link decidePickupComposer} — the Enter budget a spawn's composer gate spends, as a whole table. The
 * incidents it holds down: seats returned from `cmux spawn` with the pickup still typed, and seats that stayed
 * typed after the blind resubmit and needed the chair's Enter.
 */
import { describe, expect, it } from "vitest";

import type { ComposerReading } from "../../../cmux/composer.js";
import {
  decidePickupComposer,
  decidePickupPoll,
  foldComposerReading,
  MAX_PICKUP_ENTERS,
  type PickupSubmitState,
  pickupEnterSpacing,
} from "../../../cmux/pickupComposerGate.js";

const TYPED: ComposerReading = { kind: "typed", text: "Read /handovers/a-doc.md end to end" };

/** Every reading that is not a person's — or a spawn's — keystrokes sitting in the box. */
const NOT_TYPED: readonly ComposerReading[] = [
  { kind: "empty" },
  { kind: "suggestion", text: "approved, land it" },
  { kind: "placeholder", text: 'Try "create a util logging.py that..."' },
  { kind: "unreadable", reason: "no Claude Code composer prompt is on the screen" },
];

describe("decidePickupComposer", () => {
  it("accepts every reading that is not a typed line, however many Enters are spent", () => {
    expect(NOT_TYPED.length).toBeGreaterThan(0);
    const decisions = NOT_TYPED.flatMap((reading) => [
      decidePickupComposer({ entersSpent: 0, reading }),
      decidePickupComposer({ entersSpent: MAX_PICKUP_ENTERS, reading }),
    ]);
    expect(decisions).toEqual(Array<unknown>(NOT_TYPED.length * 2).fill({ kind: "accept" }));
  });

  it("budgets four Enters in all, `sendLine`'s own included — the three later presses the gate had before", () => {
    expect(MAX_PICKUP_ENTERS).toBe(4);
  });

  it("presses Enter on a typed line for every count below the budget", () => {
    const counts = [1, 2, 3];
    expect(counts.map((entersSpent) => decidePickupComposer({ entersSpent, reading: TYPED }))).toEqual(
      Array<unknown>(counts.length).fill({ kind: "submit", text: "Read /handovers/a-doc.md end to end" }),
    );
  });

  it("refuses, carrying the stuck text, on a typed line once the budget is spent", () => {
    expect(decidePickupComposer({ entersSpent: MAX_PICKUP_ENTERS, reading: TYPED })).toEqual({
      kind: "refuse",
      text: "Read /handovers/a-doc.md end to end",
    });
  });
});

// Measured on cmux 0.65.2: `sendLine`'s Enter left the box typed on 4 seats of 4, and a bare Enter 2.2 s
// after it took every time — so the witness window presses on a box it positively reads holding the line.
describe("decidePickupPoll", () => {
  const FRESH: PickupSubmitState = { entersSpent: 1, pressedOnTyped: false, ticksSinceEnter: 1 };

  it("waits on a typed box until the spacing after `sendLine`'s Enter, then presses", () => {
    expect(decidePickupPoll({ reading: TYPED, state: FRESH })).toEqual({ kind: "wait" });
    expect(decidePickupPoll({ reading: TYPED, state: { ...FRESH, ticksSinceEnter: 2 } })).toEqual({
      kind: "submit",
      text: "Read /handovers/a-doc.md end to end",
    });
  });

  it("spaces each later Enter by the Enters already spent", () => {
    const spent = [1, 2, 3];
    expect(spent.map((entersSpent) => pickupEnterSpacing({ entersSpent }))).toEqual([2, 4, 6]);
    expect(
      decidePickupPoll({ reading: TYPED, state: { entersSpent: 3, pressedOnTyped: true, ticksSinceEnter: 5 } }),
    ).toEqual({ kind: "wait" });
  });

  it("gives up with the stuck text once every Enter is spent and the last one's spacing has passed", () => {
    const spentState = { entersSpent: MAX_PICKUP_ENTERS, pressedOnTyped: true, ticksSinceEnter: 8 };
    expect(decidePickupPoll({ reading: TYPED, state: spentState })).toEqual({
      kind: "budget-spent",
      text: "Read /handovers/a-doc.md end to end",
    });
    expect(decidePickupPoll({ reading: TYPED, state: { ...spentState, ticksSinceEnter: 7 } })).toEqual({
      kind: "wait",
    });
  });

  it("reads a box emptied after an Enter pressed on it typed as the line leaving it", () => {
    const pressed: PickupSubmitState = { entersSpent: 2, pressedOnTyped: true, ticksSinceEnter: 1 };
    const readable = NOT_TYPED.filter((reading) => reading.kind !== "unreadable");
    expect(readable.length).toBeGreaterThan(0);
    expect(readable.map((reading) => decidePickupPoll({ reading, state: pressed }))).toEqual(
      Array<unknown>(readable.length).fill({ kind: "left-composer" }),
    );
  });

  it("never presses or claims a submit on a box it never saw typed, or one it cannot read", () => {
    const unreadable = NOT_TYPED.filter((reading) => reading.kind === "unreadable");
    const decisions = [
      ...NOT_TYPED.map((reading) => decidePickupPoll({ reading, state: { ...FRESH, ticksSinceEnter: 30 } })),
      ...unreadable.map((reading) =>
        decidePickupPoll({ reading, state: { entersSpent: 2, pressedOnTyped: true, ticksSinceEnter: 30 } }),
      ),
    ];
    expect(decisions).toEqual(Array<unknown>(NOT_TYPED.length + unreadable.length).fill({ kind: "wait" }));
  });
});

describe("foldComposerReading", () => {
  const UNREADABLE: ComposerReading = { kind: "unreadable", reason: "the styled grid could not be read: gone" };

  it("keeps a box last seen typed typed through a read that fails", () => {
    expect(foldComposerReading({ next: UNREADABLE, previous: TYPED })).toEqual(TYPED);
  });

  it("takes every other read as the new state, including an unreadable one over a box never seen typed", () => {
    expect(NOT_TYPED.length).toBeGreaterThan(0);
    const pairs = NOT_TYPED.flatMap((previous) => [...NOT_TYPED, TYPED].map((next) => ({ next, previous })));
    const fromTyped = NOT_TYPED.filter((next) => next.kind !== "unreadable").map((next) => ({ next, previous: TYPED }));
    expect([...pairs, ...fromTyped].map((pair) => foldComposerReading(pair))).toEqual(
      [...pairs, ...fromTyped].map((pair) => pair.next),
    );
  });
});
