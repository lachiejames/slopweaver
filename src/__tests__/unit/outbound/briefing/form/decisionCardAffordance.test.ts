/** A decision card offers a fold or a subject link to go to for the detail that decides it. */
import { describe, expect, it } from "vitest";

import { cardAboveFoldWords } from "../../../../../outbound/briefing/aboveFoldText.js";
import type { BriefingCard } from "../../../../../outbound/briefing/types.js";
import { CARD, FORM, withCard } from "./fixtures.js";
import { refusals } from "./harness.js";

describe("a decision card offers somewhere to go", () => {
  const NOWHERE =
    "reactNow.teamFacing.0: a decision card offers nowhere to go for the detail that decides it — give it " +
    "a `detail` fold or a `subject.url`. A `no page` subject names the absence of a page; it does not " +
    "supply the detail. Four capped cells are not enough to answer from.";

  /**
   * The shared card with its fold REMOVED, so the only affordance is whatever the case adds back.
   *
   * A spread cannot take a key away, and these cases are precisely about absence.
   *
   * @param over fields to set after the fold is dropped
   * @returns the form, with that one card in the team-facing grouping
   */
  function withoutFold({ over = {} }: { over?: Partial<BriefingCard> } = {}): unknown {
    const card: Record<string, unknown> = { ...CARD, ...over };
    delete card["detail"];
    return { ...FORM, reactNow: { meFacing: [], openArtifacts: [], teamFacing: [card] } };
  }

  it("refuses a card offering neither a fold nor a subject", () => {
    expect(refusals({ form: withoutFold() })).toEqual([NOWHERE]);
  });

  it("admits a card whose only affordance is a subject link", () => {
    const over = { subject: { text: "#100 the draft", url: "https://example.com/pull/100" } };
    expect(refusals({ form: withoutFold({ over }) })).toEqual([]);
  });

  it("admits a card whose only affordance is a fold, which is the shared fixture", () => {
    expect(refusals({ form: withCard({ over: {} }) })).toEqual([]);
  });

  it("does not charge the fold against the above-fold budget, so the affordance is free", () => {
    const withSubject = { subject: { text: "#100 the draft", url: "https://example.com/pull/100" } };
    expect(cardAboveFoldWords({ card: { ...CARD, ...withSubject } })).toBeGreaterThan(
      cardAboveFoldWords({ card: CARD }),
    );
  });
});
