/*
 * Whether a hand step card's `where` goes behind its fold: the chip is the place, unless the owner pastes something and
 * `where` says where it goes.
 */
import { describe, expect, it } from "vitest";

import { whereBehind } from "../../lib/stepRowFold";

const TRELICA = "https://acme.trelica.app";

describe("whereBehind", () => {
  it("folds where when a chip draws and the owner pastes nothing", () => {
    expect(whereBehind({ destination: TRELICA, step: { checklist: undefined, literal: undefined } })).toBe(true);
  });

  it("keeps where above the fold when no chip draws", () => {
    expect(whereBehind({ destination: undefined, step: { checklist: undefined, literal: undefined } })).toBe(false);
  });

  it("keeps where above the fold when the owner pastes a literal", () => {
    expect(whereBehind({ destination: TRELICA, step: { checklist: undefined, literal: "op signin" } })).toBe(false);
  });

  it("keeps where above the fold when the owner works a checklist", () => {
    expect(whereBehind({ destination: TRELICA, step: { checklist: [], literal: undefined } })).toBe(false);
  });
});
