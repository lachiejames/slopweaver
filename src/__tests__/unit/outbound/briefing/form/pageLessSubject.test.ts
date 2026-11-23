/** A url-less subject begins with `no page`, and never stands in for the fold. */
import { describe, expect, it } from "vitest";

import { CARD, FORM, withCard } from "./fixtures.js";
import { refusals } from "./harness.js";

describe("a page-less card says `no page`", () => {
  it("admits a url-less subject whose words say so, beside a fold", () => {
    const over = { subject: { text: "no page — this decision exists only here" } };

    expect(refusals({ form: withCard({ over }) })).toEqual([]);
  });

  it("refuses a url-less subject that does not say so", () => {
    const over = { subject: { text: "the stale-ready fix" } };

    expect(refusals({ form: withCard({ over }) })).toEqual([
      "reactNow.teamFacing.0.subject.text: a subject with no `url` must begin with `no page`, so the card " +
        "says outright that there is no page to open rather than leaving a title that looks like a link " +
        "somebody dropped.",
    ]);
  });

  it("refuses a `no page` subject standing in for the fold it does not replace", () => {
    const form = {
      ...FORM,
      reactNow: {
        meFacing: [],
        openArtifacts: [],
        teamFacing: [{ ...CARD, detail: undefined, subject: { text: "no page — this row" } }],
      },
    };

    expect(refusals({ form })).toEqual([
      "reactNow.teamFacing.0: a decision card offers nowhere to go for the detail that decides it — give it " +
        "a `detail` fold or a `subject.url`. A `no page` subject names the absence of a page; it does not " +
        "supply the detail. Four capped cells are not enough to answer from.",
    ]);
  });

  it("still lets a linked subject stand in for the fold", () => {
    const form = {
      ...FORM,
      reactNow: {
        meFacing: [],
        openArtifacts: [],
        teamFacing: [
          {
            ...CARD,
            detail: undefined,
            subject: { text: "acme-admin#16415 — the stacked conflicts", url: "https://github.com/e/a/pull/16415" },
          },
        ],
      },
    };

    expect(refusals({ form })).toEqual([]);
  });
});
