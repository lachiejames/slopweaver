/** The lede, the collapsed sections and the ranked index are held to what a gated card is held to. */
import { describe, expect, it } from "vitest";

import type { BriefingOpenArtifact } from "../../../../../outbound/briefing/types.js";
import { FORM, sentenceOfWords, text } from "./fixtures.js";
import { refusals } from "./harness.js";

describe("every section reads the way a gated card does", () => {
  it("refuses a lede over the cap a card's `what` carries, at the lede's own path", () => {
    const lede = { ...FORM.header, lede: text({ value: sentenceOfWords({ count: 61 }) }) };

    expect(refusals({ form: { ...FORM, header: lede } })).toEqual([
      "header.lede: the lede runs to 61 words, over the cap of 60. It is the first thing the owner reads and it is " +
        "held to what a card's `what` is held to — say the one thing the page is about, and let the " +
        "sections below carry the rest.",
    ]);
  });

  it("refuses a fleet word the lede never explains, and names what it means", () => {
    const lede = { ...FORM.header, lede: text({ value: "The fill spawned the audit tonight." }) };

    expect(refusals({ form: { ...FORM, header: lede } })).toEqual([
      'header.lede: the lede uses the fleet word "The fill spawned" and never says what it means — "fill" ' +
        "here is the scan that starts work nobody is holding. Say what it means in the same breath, above " +
        "the fold, or write the card without the word.",
    ]);
  });

  it("refuses one a collapsed section uses and never explains, naming the section as the page names it", () => {
    const earlierToday = {
      notes: [{ headline: text({ value: "This tick closed the chair." }) }],
      summary: "earlier today, in order",
    };

    expect(refusals({ form: { ...FORM, earlierToday } })).toEqual([
      'earlierToday.notes: "earlier today, in order" uses the fleet word "This tick" and never says what it ' +
        'means — "tick" here is one pass of the supervisor\'s loop. Say what it means in the same breath, ' +
        "above the fold, or write the card without the word.",
    ]);
  });

  it("passes the same section once one of its notes says what the word means", () => {
    const earlierToday = {
      notes: [
        { headline: text({ value: "Every tick is one pass of the supervisor's loop." }) },
        { headline: text({ value: "This tick closed the chair." }) },
      ],
      summary: "earlier today, in order",
    };

    expect(refusals({ form: { ...FORM, earlierToday } })).toEqual([]);
  });

  it("adds NO length cap inside a fold, which is the owner's ruling left where it was", () => {
    const earlierToday = {
      notes: [
        {
          detail: {
            blocks: [{ content: text({ value: sentenceOfWords({ count: 400 }) }), kind: "para" as const }],
            summary: "the whole read",
          },
          headline: text({ value: sentenceOfWords({ count: 120 }) }),
        },
      ],
      summary: "earlier today, in order",
    };

    expect(refusals({ form: { ...FORM, earlierToday } })).toEqual([]);
  });

  it("never reads the owner's own list, whose every field the session-start verb supplied", () => {
    const yourList = {
      notShown: 0,
      readIso: "2026-09-02T00:00:00Z",
      rows: [
        {
          closing: false,
          headline: text({ value: "The fill spawned it." }),
          identity: "slack:C1:1",
          link: false,
          rank: 1,
          score: 10,
          whenIso: "2026-09-02T00:00:00Z",
          where: "#dev",
          who: "ada",
          why: "the owner asked",
        },
      ],
      source: "slopweaver session-start",
    };

    expect(refusals({ form: { ...FORM, yourList } })).toEqual([]);
  });

  it("refuses a ranked ask that asks permission for what doctrine already settles", () => {
    const ranked: BriefingOpenArtifact = {
      ask: text({ value: "Should I merge the pull request now that it is green?" }),
      label: "Scope split",
      landedIso: "2026-09-02T00:00:00Z",
      rank: 1,
      url: "https://example.invalid/page-1",
      validity: { mark: "valid" },
    };
    const form = { ...FORM, reactNow: { ...FORM.reactNow, openArtifacts: [ranked] } };

    expect(refusals({ form })[0]).toContain(
      "reactNow.openArtifacts.0.ask: the ranked open-pages index asks permission for",
    );
  });
});
