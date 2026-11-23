/** A card's `subject.url` never points at a briefing page's own react-now block. */
import { describe, expect, it } from "vitest";

import { CARD, FORM, text, withCard, withMineCard } from "./fixtures.js";
import { refusals } from "./harness.js";

describe("a card's subject never links back at this page", () => {
  /** The exact url on a me-facing card that linked back at its own page. */
  const HIS_URL = "https://claude.ai/code/artifact/af415a0a-f9cd-43b1-aac2-187e71642592#react-now";

  it("refuses the very card the owner clicked through to the page they were reading", () => {
    const over = { subject: { text: "the board's top row, already settled", url: HIS_URL } };

    expect(refusals({ form: withCard({ over }) })).toEqual([
      "reactNow.teamFacing.0.subject.url: this card's `subject.url` points at a briefing page's own " +
        "`#react-now` section, which is a block of cards rather than anything a card is about — and when it " +
        "is this page, it sends you back to what you are already reading. Use an `anchor` run to move you " +
        "within this page; otherwise drop the url, begin the subject's text with `no page`, and put the " +
        "deciding detail in `detail`.",
    ]);
  });

  it("names the me-facing card's own path, so a composer fixes the right one", () => {
    const over = { subject: { text: "the board's top row", url: HIS_URL } };

    expect(refusals({ form: withMineCard({ over }) })).toEqual([
      "reactNow.meFacing.0.subject.url: this card's `subject.url` points at a briefing page's own " +
        "`#react-now` section, which is a block of cards rather than anything a card is about — and when it " +
        "is this page, it sends you back to what you are already reading. Use an `anchor` run to move you " +
        "within this page; otherwise drop the url, begin the subject's text with `no page`, and put the " +
        "deciding detail in `detail`.",
    ]);
  });

  it("leaves a composer's OWN collapsed section alone, so another page's section stays linkable", () => {
    const form = {
      ...FORM,
      history: [
        {
          id: "the-queue-saga",
          notes: [{ headline: text({ value: "The queue drained." }) }],
          summary: "last night",
        },
      ],
      reactNow: {
        meFacing: [],
        openArtifacts: [],
        teamFacing: [
          { ...CARD, subject: { text: "the queue saga", url: "https://claude.ai/code/artifact/abc#the-queue-saga" } },
        ],
      },
    };

    expect(refusals({ form })).toEqual([]);
  });

  it("refuses another briefing page's react-now block too — a list of cards is nothing a card is about", () => {
    const over = { subject: { text: "the other page's cards", url: "https://claude.ai/code/artifact/b#react-now" } };

    expect(refusals({ form: withCard({ over }) })).toEqual([
      "reactNow.teamFacing.0.subject.url: this card's `subject.url` points at a briefing page's own " +
        "`#react-now` section, which is a block of cards rather than anything a card is about — and when it " +
        "is this page, it sends you back to what you are already reading. Use an `anchor` run to move you " +
        "within this page; otherwise drop the url, begin the subject's text with `no page`, and put the " +
        "deciding detail in `detail`.",
    ]);
  });

  it("refuses an empty url, which the page reader refuses too", () => {
    const over = { subject: { text: "the rollout", url: "" } };

    expect(refusals({ form: withCard({ over }) }).map((line) => line.split(":")[0])).toEqual([
      "reactNow.teamFacing.0.subject.url",
    ]);
  });

  it("admits a fragment this page does not render", () => {
    const over = { subject: { text: "the design doc", url: "https://example.invalid/other#installation" } };

    expect(refusals({ form: withCard({ over }) })).toEqual([]);
  });

  it("reports every offending card rather than stopping at the first", () => {
    const bad = { ...CARD, subject: { text: "the board's top row", url: HIS_URL } };
    const form = {
      ...FORM,
      reactNow: {
        meFacing: [{ ...bad, question: "And this one too?" }],
        openArtifacts: [],
        teamFacing: [bad],
      },
    };

    expect(refusals({ form }).map((line) => line.split(":")[0])).toEqual([
      "reactNow.teamFacing.0.subject.url",
      "reactNow.meFacing.0.subject.url",
    ]);
  });
});
