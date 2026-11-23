/** React-now's two groupings, capped together and never sharing a question. */
import { describe, expect, it } from "vitest";

import { CARD, FORM, text } from "./fixtures.js";
import { refusals } from "./harness.js";

describe("react-now's two groupings", () => {
  it("caps the two TOGETHER, because what the owner scrolls is one block rather than either half", () => {
    const team = Array.from({ length: 26 }, () => CARD);
    const mine = Array.from({ length: 26 }, (_, index) => ({ ...CARD, question: `Land ${String(index)} yourself?` }));

    expect(refusals({ form: { ...FORM, reactNow: { meFacing: mine, teamFacing: team } } })).toEqual([
      "reactNow: react now carries more than 50 cards across both groupings. A block that long has stopped " +
        "being a list of things to react to — land some of it, or fold it away.",
    ]);
  });

  it("admits fifty, which is the block the owner asked for rather than the wall the cap refuses", () => {
    const team = Array.from({ length: 25 }, () => CARD);
    const mine = Array.from({ length: 25 }, (_, index) => ({ ...CARD, question: `Land ${String(index)} yourself?` }));

    expect(refusals({ form: { ...FORM, reactNow: { meFacing: mine, teamFacing: team } } })).toEqual([]);
  });

  it("refuses the same question in both groupings, since one card cannot be both an approach and a report", () => {
    expect(
      refusals({ form: { ...FORM, reactNow: { meFacing: [CARD], openArtifacts: [], teamFacing: [CARD] } } }),
    ).toEqual([
      "reactNow: the same question appears in both react-now groupings, so the card claims both that a " +
        "colleague is on the other end of it and that nobody but you sees it. Pick one.",
    ]);
  });

  it("admits both groupings empty, which is the honest quiet state", () => {
    expect(refusals({ form: { ...FORM, reactNow: { meFacing: [], openArtifacts: [], teamFacing: [] } } })).toEqual([]);
  });

  it("charges a card's subject line to the card's own budget, since a reader meets it", () => {
    // Each cell inside its own cap, and the subject — 100 words in 199 characters, inside the field's own
    // 300 — is what tips the whole card past 200. Without it this card passes.
    const subject = { text: Array.from({ length: 100 }, () => "a").join(" "), url: "https://github.com/o/r/pull/1" };
    const inside = {
      ...CARD,
      ifSilent: text({ value: Array.from({ length: 30 }, () => "beta").join(" ") }),
      lean: text({ value: Array.from({ length: 30 }, () => "beta").join(" ") }),
      what: text({ value: `${Array.from({ length: 55 }, () => "beta").join(" ")}. And one more.` }),
      // Two of the thirty words are the warrant the card owes; the count is what this test measures.
      whyYou: text({ value: `only you ${Array.from({ length: 28 }, () => "beta").join(" ")}` }),
    };
    const over = { ...inside, subject };

    expect(
      refusals({ form: { ...FORM, reactNow: { meFacing: [], openArtifacts: [], teamFacing: [inside] } } }),
    ).toEqual([]);

    expect(refusals({ form: { ...FORM, reactNow: { meFacing: [], openArtifacts: [], teamFacing: [over] } } })).toEqual([
      "reactNow.teamFacing.0: the whole card runs over the cap of 200 words above the fold. Every field is " +
        "short enough on its own and the card still is not. Fold something.",
    ]);
  });

  it("refuses a form that writes either eyebrow instant as anything but an instant a clock parses", () => {
    const header = { ...FORM.header, refreshedIso: "01:40 AEST" };

    expect(refusals({ form: { ...FORM, header } })).toEqual([
      "header.refreshedIso: an eyebrow instant must be an ISO-8601 timestamp a clock can parse, as in " +
        "`2026-09-02T09:07:42Z`.",
    ]);
  });

  it("admits an anchor into a grouping that renders, and refuses one into a grouping that does not", () => {
    const pointing = {
      ...CARD,
      whyYou: [
        { kind: "text" as const, text: "Only you can say. " },
        { kind: "anchor" as const, target: "react-now-me", text: "yours" },
      ],
    };

    expect(
      refusals({ form: { ...FORM, reactNow: { meFacing: [], openArtifacts: [], teamFacing: [pointing] } } }),
    ).toEqual([
      "form: an anchor run points at a section this page does not carry, so it would render as a link that " +
        "scrolls nowhere. Give the section an `id`, or point the anchor at one that renders.",
    ]);
    expect(
      refusals({
        form: {
          ...FORM,
          reactNow: {
            meFacing: [{ ...CARD, question: "Land it yourself?" }],
            openArtifacts: [],
            teamFacing: [pointing],
          },
        },
      }),
    ).toEqual([]);
  });
});
