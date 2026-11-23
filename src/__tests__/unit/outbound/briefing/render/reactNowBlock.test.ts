/*
 * The react-now block's cards: `awaiting` renders nothing and never hides the empty state, a waiting card carries
 * its mark and the line naming its session and event, and every ready card sits above every waiting one under an
 * `<h3>` that cannot close the region the gate reads. `artifact` is used only here, so it stays here.
 */
import { describe, expect, it } from "vitest";

import { renderBriefing, renderCard } from "../../../../../outbound/briefing/render.js";
import type { BriefingArtifactLink } from "../../../../../outbound/briefing/types.js";
import { CARD, FORM, NOW_ISO, text } from "./harness.js";

/** One artifact entry, with whatever a test needs to vary. */
function artifact({ over }: { over: Partial<BriefingArtifactLink> }): BriefingArtifactLink {
  return {
    label: "Daily Friction Review",
    pending: false,
    url: "https://example.invalid/review",
    waitingOn: text({ value: "Three findings want a keep or drop." }),
    ...over,
  };
}

describe("the one-index sections on the rendered page", () => {
  it("renders nothing at all for `awaiting`, wherever the form put it", () => {
    const html = renderBriefing({
      form: { ...FORM, awaiting: [artifact({ over: { pending: true } })] },
    });

    expect(html).not.toContain("waiting for you elsewhere");
    expect(html).not.toContain("react now on");
    expect(html).not.toContain('href="#awaiting"');
  });

  it("says nothing is open when the cards are empty, even while `awaiting` carries a pending entry", () => {
    const html = renderBriefing({
      form: {
        ...FORM,
        awaiting: [artifact({ over: { pending: true } })],
        reactNow: { meFacing: [], openArtifacts: [], teamFacing: [] },
      },
    });

    expect(html).toContain("nothing open above the line right now");
  });

  it("still renders the honest empty state when nothing is open anywhere", () => {
    const html = renderBriefing({ form: { ...FORM, reactNow: { meFacing: [], openArtifacts: [], teamFacing: [] } } });

    expect(html).toContain("nothing open above the line right now");
  });

  it("renders a waiting card with its mark and the line naming the session and the event", () => {
    const waiting = {
      ...CARD,
      readiness: { state: "waiting" as const, event: "the 271x measurement comes back", session: "handoff-9141" },
    };

    expect(renderCard({ card: waiting, nowIso: NOW_ISO, position: 2 })).toContain(
      '<div class="need" data-readiness="waiting" style="border-left-color:var(--muted)">' +
        '<div class="q">2. Are you happy with the draft?</div>' +
        '<div class="age" data-premise-kind="composed" data-premise-iso="2026-09-11T21:18:59Z">premise 2 hours old</div>' +
        '<div class="wait">waiting on handoff-9141 · the 271x measurement comes back</div>',
    );
  });

  it("puts every ready card above every waiting one, whichever grouping each sits in", () => {
    const waitingTeam = {
      ...CARD,
      question: "Does the stack go for review once it is native?",
      readiness: { state: "waiting" as const, event: "the four adopt into one native stack", session: "handoff-9141" },
    };
    const readyMine = { ...CARD, question: "Was landing it the right call?" };
    const html = renderBriefing({
      form: { ...FORM, reactNow: { meFacing: [readyMine], openArtifacts: [], teamFacing: [waitingTeam] } },
    });

    expect(html.indexOf("Was landing it the right call?")).toBeLessThan(
      html.indexOf("Does the stack go for review once it is native?"),
    );
    expect(html.indexOf('id="react-now-me"')).toBeLessThan(html.indexOf('id="react-now-waiting"'));
    expect(html).toContain('<h3 id="react-now-waiting">waiting on a session — nothing to answer yet</h3>');
    expect(html).not.toContain('id="react-now-team"');
  });

  it("numbers the block across the partition, so a ready card is always card 1", () => {
    const waitingTeam = { ...CARD, readiness: { state: "waiting" as const, event: "the fix lands", session: "ws:12" } };
    const readyMine = { ...CARD, question: "Was landing it the right call?" };
    const html = renderBriefing({
      form: { ...FORM, reactNow: { meFacing: [readyMine], openArtifacts: [], teamFacing: [waitingTeam] } },
    });

    expect(html).toContain('<div class="q">1. Was landing it the right call?</div>');
    expect(html).toContain('<div class="q">2. Are you happy with the draft?</div>');
  });

  it("uses `<h3>` so the waiting grouping cannot close the react-now region the gate reads", () => {
    const waiting = { ...CARD, readiness: { state: "waiting" as const, event: "the fix lands", session: "ws:12" } };
    const html = renderBriefing({
      form: { ...FORM, reactNow: { meFacing: [], openArtifacts: [], teamFacing: [waiting] } },
    });

    expect(html.indexOf('id="react-now-waiting"')).toBeLessThan(html.indexOf('id="alignment"'));
    expect(html).not.toContain('<h2 id="react-now-waiting"');
  });
});
