/**
 * The page's OWN furniture is held to the rule it holds a composer to.
 *
 * Codex's planning pass found the case that makes this a test rather than a convention:
 * the eyebrow read `refreshed every sweep`, and `sweep` is one of `src/briefing/fleetJargon.ts`'s registered
 * fleet words — so the renderer was using a word it would have refused a composer for, on the one line of
 * the page a reader cannot fold away.
 *
 * It reads the RENDERED page rather than a list of constants, so a line added to the renderer later is
 * covered without anyone remembering to add it here.
 */
import { describe, expect, it } from "vitest";
import { ungloss } from "../../../../briefing/fleetJargon.js";
import { NO_OWNER_BELIEFS } from "../../../../briefing/ownerBeliefs.js";
import { plainText } from "../../../../briefing/text.js";
import { renderEyebrow } from "../../../../outbound/briefing/eyebrow.js";
import { renderBriefing } from "../../../../outbound/briefing/render.js";
import type { BriefingContent, BriefingForm } from "../../../../outbound/briefing/types.js";

/** One text run, the shape most cells are. */
function text({ value }: { value: string }): BriefingContent {
  return [{ kind: "text", text: value }];
}

/** A form whose every composed cell is plain, so anything the scan finds is the RENDERER's own wording. */
const FORM: BriefingForm = {
  ownerBeliefs: NO_OWNER_BELIEFS,
  alignment: {
    headline: text({ value: "Two of three sessions are on the top five." }),
    intake: text({ value: "Owner turns: four read, all witnessed." }),
  },
  autonomy: { notShown: 0, rows: [] },
  handSteps: { notShown: 0, rows: [], unreadable: 0 },
  awaiting: [],
  header: {
    handoff: "handoff-9012",
    lede: text({ value: "One thing needs your word." }),
    model: "opus",
    pinnedAt: "23:57",
    readyIso: "2026-09-12T01:40:00.000Z",
    refreshedIso: "2026-09-12T01:12:00.000Z",
    sleeping: false,
    workspace: "ws:598",
  },
  history: [],
  reactNow: { meFacing: [], openArtifacts: [], teamFacing: [] },
  recent: [],
};

describe("the renderer's own fixed lines pass the rule they impose", () => {
  it("glosses or avoids every fleet word on the whole rendered page", () => {
    const page = plainText({ html: renderBriefing({ form: FORM }).replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, " ") });

    expect(ungloss({ aboveFold: page })).toBeUndefined();
  });

  it("says how fresh the page is without the word the gate would refuse a composer for", () => {
    const awake = renderEyebrow({ form: FORM });
    const asleep = renderEyebrow({ form: { ...FORM, header: { ...FORM.header, sleeping: true } } });

    expect(awake).toContain("rebuilt with each update");
    expect(asleep).toContain("sleep mode, republished each time this page is rebuilt");
    expect(ungloss({ aboveFold: plainText({ html: awake }) })).toBeUndefined();
    expect(ungloss({ aboveFold: plainText({ html: asleep }) })).toBeUndefined();
  });
});
