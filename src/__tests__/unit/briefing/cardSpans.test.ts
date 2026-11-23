/**
 * The one card cut the card checks and the bare-reference scan share: grouping order, offsets, and a card left
 * open before the me-facing heading.
 */
import { describe, expect, it } from "vitest";

import { extractCards, reactNowCardSpans } from "../../../briefing/cardSpans.js";
import { ME_FACING_ID } from "../../../outbound/briefing/types.js";

const A = '<div class="need"><div class="q">A?</div></div>';
const B = '<div class="need"><div class="q">B?</div></div>';

describe("reactNowCardSpans", () => {
  it("reads the team-facing grouping, then the me-facing one, with each card's offset in the whole block", () => {
    const heading = `<h3 id="${ME_FACING_ID}">yours</h3>`;
    const block = `${A}${heading}${B}`;

    expect(reactNowCardSpans({ block })).toEqual([
      { cardHtml: A, ownHand: false, start: 0 },
      { cardHtml: B, ownHand: true, start: A.length + heading.length },
    ]);
  });

  it("drops a card left open before the me-facing heading, even when a later tag would close it", () => {
    const block = `<div class="need"><div class="q">A?</div><h3 id="${ME_FACING_ID}">yours</h3>${B}</div>`;

    expect(reactNowCardSpans({ block }).map((span) => span.cardHtml)).toEqual([B]);
  });

  it("reads every card as team-facing on a page with no me-facing heading", () => {
    expect(reactNowCardSpans({ block: `${A}${B}` }).map((span) => span.ownHand)).toEqual([false, false]);
  });
});

describe("extractCards", () => {
  it("returns a nested card after the card that holds it, in document order", () => {
    const outer = `<div class="need"><div class="q">Outer?</div>${A}</div>`;

    expect(extractCards({ block: outer })).toEqual([outer, A]);
  });

  it("finds nothing in a block with no card", () => {
    expect(extractCards({ block: "<p>nothing here</p>" })).toEqual([]);
  });
});
