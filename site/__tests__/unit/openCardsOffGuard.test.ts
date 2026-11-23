/*
 * The voice turns the owner's openCards switch off only for their own general ask: measured, one call turned it off
 * for a complaint about one Slack thread, and it stayed off into the next call.
 */
import { describe, expect, it } from "vitest";

import { heardOpenCardsOff, OPEN_CARDS_OFF_WINDOW } from "../../lib/openCardsOffGuard";
import type { GateEntry } from "../../lib/relayGate";

/** Talk that names no card, thread or ask, to push words back past the window. */
const FILLER = "and we kept on talking for a while ";

/**
 * A call record holding only what the owner was heard saying, fragment by fragment.
 *
 * @param fragments the owner's heard fragments, oldest first
 * @returns the record
 */
function heard({ fragments }: { fragments: readonly string[] }): readonly GateEntry[] {
  return fragments.map((text) => ({ kind: "heard", text }) as const);
}

/**
 * Whether one utterance, heard whole, turns the switch off.
 *
 * @param said what the owner said
 * @returns the guard's answer
 */
function offFor({ said }: { said: string }): boolean {
  return heardOpenCardsOff({ log: heard({ fragments: [said] }) });
}

describe("heardOpenCardsOff", () => {
  it("allows the owner's general asks to stop opening cards", () => {
    const general = [
      "Stop opening cards.",
      "Don't open the cards anymore.",
      "Don’t open any cards for now.",
      "Turn automatic card opening off.",
      "Turn off auto-open.",
      "Disable auto open please.",
      "Stop opening cards, that's annoying.",
      "Stop opening cards for the rest of the call.",
    ];
    expect(general.length).toBeGreaterThan(0);
    expect(general.filter((said) => !offFor({ said }))).toEqual([]);
  });

  it("refuses the measured complaint about the Slack thread in hand", () => {
    expect(offFor({ said: "Hey, I've already got the Slack thread in front of me, stop trying to open it" })).toBe(
      false,
    );
  });

  it("refuses words about one card, page, thread or pull request", () => {
    const oneThing = [
      "Don't open that one.",
      "Stop opening this thread.",
      "Don't open the PR.",
      "Stop opening this card.",
      "Stop opening cards for this PR.",
      "For this PR, stop opening cards.",
      "This PR is already open, stop opening cards.",
      "Hey, I've already got the Slack thread in front of me, stop opening cards.",
      "Stop this card from opening cards.",
      "This card, e.g., is already open, stop opening cards.",
      "I've got that one open. Stop opening cards.",
      "Stop opening cards, the thread is right there.",
      "This Vanta control is already up, stop opening cards.",
      "Don't open cards from that thread.",
      "Stop that, I've already got it.",
      "I like opening cards.",
    ];
    expect(oneThing.length).toBeGreaterThan(0);
    expect(oneThing.filter((said) => offFor({ said }))).toEqual([]);
  });

  it("joins the owner's fragments in the order they arrived", () => {
    expect(heardOpenCardsOff({ log: heard({ fragments: [" Stop open", "ing cards", " please."] }) })).toBe(true);
  });

  it("refuses for a card the owner named before the window, while the ask sits inside it", () => {
    const said = `This card ${"blah ".repeat(OPEN_CARDS_OFF_WINDOW / 5)}stop opening cards`;
    expect(heardOpenCardsOff({ log: heard({ fragments: [said] }) })).toBe(false);
  });

  it("allows a general ask once a card the owner named is more than twice the window back", () => {
    const between = ` ${FILLER.repeat(Math.ceil(OPEN_CARDS_OFF_WINDOW / FILLER.length))}`;
    expect(
      heardOpenCardsOff({ log: heard({ fragments: ["I've got this thread open.", between, "Stop opening cards."] }) }),
    ).toBe(false);
    const later = heard({ fragments: ["I've got this thread open.", `${between}${between}`, "Stop opening cards."] });
    expect(heardOpenCardsOff({ log: later })).toBe(true);
  });

  // A slice at the window's edge invented a word boundary inside "xstop".
  it("never finds an ask the whole text does not hold", () => {
    const said = `xstop opening cards ${"x".repeat(OPEN_CARDS_OFF_WINDOW - "stop opening cards ".length)}`;
    expect(heardOpenCardsOff({ log: heard({ fragments: [said] }) })).toBe(false);
  });

  // A global match took "this t" and skipped the overlapping "the card" behind it.
  it("never skips a referent overlapping another", () => {
    const said = `this the card ${"x".repeat(2 * OPEN_CARDS_OFF_WINDOW - 23)} stop opening cards`;
    expect(heardOpenCardsOff({ log: heard({ fragments: [said] }) })).toBe(false);
  });

  it("refuses when the owner has said nothing this call", () => {
    expect(heardOpenCardsOff({ log: [] })).toBe(false);
    expect(heardOpenCardsOff({ log: [{ kind: "read", tool: "read_card" }, { kind: "relayed" }] })).toBe(false);
  });

  it("refuses an ask the owner made further back than the window", () => {
    const later = ` ${FILLER.repeat(Math.ceil(OPEN_CARDS_OFF_WINDOW / FILLER.length))}`;
    expect(heardOpenCardsOff({ log: heard({ fragments: ["Stop opening cards.", later] }) })).toBe(false);
  });
});
