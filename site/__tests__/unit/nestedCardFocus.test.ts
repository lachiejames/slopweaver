/*
 * The keyboard's route into a nested warning mark's portalled card and out past it (Tab from a Queue
 * row enters its card rather than the next row, the blur does not close the card, the Full message fold is reachable
 * by keyboard, and a row with two marks leaves neither one's fold unreachable).
 */
import { describe, expect, it } from "vitest";

import { nestedCardMove } from "../../lib/nestedCardFocus";

describe("nestedCardMove", () => {
  it("enters the first card on Tab from the control, the one stop being its Full message fold", () => {
    expect(nestedCardMove({ cards: [1], from: { kind: "control" }, key: "Tab", shift: false })).toEqual({
      card: 0,
      kind: "card",
      stop: 0,
    });
  });

  it("walks a row's two cards in order on Tab, then past the row, and back again on Shift+Tab to the row", () => {
    expect([
      nestedCardMove({ cards: [1, 1], from: { kind: "control" }, key: "Tab", shift: false }),
      nestedCardMove({ cards: [1, 1], from: { at: 0, card: 0, kind: "card" }, key: "Tab", shift: false }),
      nestedCardMove({ cards: [1, 1], from: { at: 0, card: 1, kind: "card" }, key: "Tab", shift: false }),
      nestedCardMove({ cards: [1, 1], from: { at: 0, card: 1, kind: "card" }, key: "Tab", shift: true }),
      nestedCardMove({ cards: [1, 1], from: { at: 0, card: 0, kind: "card" }, key: "Tab", shift: true }),
    ]).toEqual([
      { card: 0, kind: "card", stop: 0 },
      { card: 1, kind: "card", stop: 0 },
      { kind: "after-control" },
      { card: 0, kind: "card", stop: 0 },
      { kind: "control" },
    ]);
  });

  it("skips a card with no stop, and lands Shift+Tab on the previous card's LAST stop", () => {
    expect([
      nestedCardMove({ cards: [0, 2], from: { kind: "control" }, key: "Tab", shift: false }),
      nestedCardMove({ cards: [2, 0, 1], from: { at: 0, card: 2, kind: "card" }, key: "Tab", shift: true }),
    ]).toEqual([
      { card: 1, kind: "card", stop: 0 },
      { card: 0, kind: "card", stop: 1 },
    ]);
  });

  it("leaves the browser's own order alone between stops, off the control backwards, with no stop, and for other keys", () => {
    expect([
      nestedCardMove({ cards: [2], from: { at: 0, card: 0, kind: "card" }, key: "Tab", shift: false }),
      nestedCardMove({ cards: [2], from: { at: 1, card: 0, kind: "card" }, key: "Tab", shift: true }),
      nestedCardMove({ cards: [1], from: { kind: "control" }, key: "Tab", shift: true }),
      nestedCardMove({ cards: [0], from: { kind: "control" }, key: "Tab", shift: false }),
      nestedCardMove({ cards: [1], from: { at: -1, card: 0, kind: "card" }, key: "Tab", shift: false }),
      nestedCardMove({ cards: [1], from: { kind: "control" }, key: "Enter", shift: false }),
    ]).toEqual([
      { kind: "stay" },
      { kind: "stay" },
      { kind: "stay" },
      { kind: "stay" },
      { kind: "stay" },
      { kind: "stay" },
    ]);
  });
});
