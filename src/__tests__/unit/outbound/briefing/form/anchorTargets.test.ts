/** An anchor run may name only a heading this page renders. */
import { describe, expect, it } from "vitest";

import { CARD, FORM, withCard } from "./fixtures.js";
import { refusals } from "./harness.js";

describe("the anchor targets a form may name", () => {
  /** The team card, waiting on a session rather than ready. */
  const WAITING = { ...CARD, readiness: { event: "the rebase lands", session: "wt/queue", state: "waiting" } };

  it("admits an anchor at the waiting heading the renderer emits", () => {
    const form = {
      ...FORM,
      header: { ...FORM.header, lede: [{ kind: "anchor", target: "react-now-waiting", text: "one card waits" }] },
      reactNow: { meFacing: [], openArtifacts: [], teamFacing: [WAITING] },
    };

    expect(refusals({ form })).toEqual([]);
  });

  it("admits an anchor at the hand-steps heading once a step is open", () => {
    const form = {
      ...FORM,
      handSteps: {
        notShown: 0,
        unreadable: 0,
        rows: [
          {
            id: "trelica-signin",
            postedIso: "2026-09-19T18:25:44.275Z",
            tier: "fleet-blocked" as const,
            unblocks: "every scheduled Trelica resync",
            what: "Sign in to Trelica in Chrome",
            witness: "slopweaver hand done trelica-signin",
          },
        ],
      },
      header: { ...FORM.header, lede: [{ kind: "anchor", target: "waiting-on-you", text: "one step is yours" }] },
    };

    expect(refusals({ form })).toEqual([]);
  });

  it("refuses that same anchor when nothing is waiting on the owner's hands, because the heading never renders", () => {
    const form = {
      ...FORM,
      header: { ...FORM.header, lede: [{ kind: "anchor", target: "waiting-on-you", text: "one step is yours" }] },
    };

    expect(refusals({ form })).toEqual([
      "form: an anchor run points at a section this page does not carry, so it would render as a link that " +
        "scrolls nowhere. Give the section an `id`, or point the anchor at one that renders.",
    ]);
  });

  it("refuses an anchor at a grouping heading whose cards all wait, because none renders", () => {
    const form = {
      ...FORM,
      header: { ...FORM.header, lede: [{ kind: "anchor", target: "react-now-team", text: "the team block" }] },
      reactNow: { meFacing: [], openArtifacts: [], teamFacing: [WAITING] },
    };

    expect(refusals({ form })).toEqual([
      "form: an anchor run points at a section this page does not carry, so it would render as a link that " +
        "scrolls nowhere. Give the section an `id`, or point the anchor at one that renders.",
    ]);
  });

  it("refuses a subject at a grouping heading whether or not THIS page renders it", () => {
    const over = {
      readiness: { event: "the rebase lands", session: "wt/queue", state: "waiting" as const },
      subject: { text: "the team block", url: "https://claude.ai/code/artifact/abc#react-now-team" },
    };

    expect(refusals({ form: withCard({ over }) }).map((line) => line.split(":")[0])).toEqual([
      "reactNow.teamFacing.0.subject.url",
    ]);
  });
});
