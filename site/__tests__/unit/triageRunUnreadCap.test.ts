/*
 * `triage_next` over a card fitted near its cap, with every record source unread at a long reason: the unread list is added after the card was fitted, so unbounded it carried the answer past the page's
 * tool cap and the page refused it whole, after the console had already moved.
 */
import { describe, expect, it } from "vitest";

import { TOOL_OUTPUT_MAX, toolOutputOf } from "../../components/live/talkSession";
import { runTriageNext } from "../../components/voice/triageRun";
import { UNREAD_MAX_BYTES } from "../../lib/unreadFit";
import { fakes, handRows, STEP, wholeBriefing } from "./triageRunFixture";

describe("runTriageNext with every record source unread", () => {
  it("keeps a card fitted near its cap under the page's cap, naming every source", async () => {
    const id = `say-whether-${"the-orb-breathes-".repeat(40)}now`;
    const filler = "the orb breathes slowly through the call ".repeat(200);
    const rows = handRows({
      steps: [{ ...STEP, id, what: `Read file:///Users/someone/.slopweaver/pages/orb-notes/index.html ${filler}` }],
    });
    const { seams } = fakes({ openCards: false, rows, walk: undefined });
    const words = wholeBriefing({ slug: "orb-notes", text: "words ".repeat(8000) });
    const unread = Array.from({ length: 16 }, (_, at) => ({
      source: `register ${String(at)}`,
      why: "slow ".repeat(400),
    }));
    const cards = () => ({ ...seams.cards(), unread });
    const ran = await runTriageNext({
      minutes: undefined,
      seams: { ...seams, cards, readBriefing: async () => words },
    });
    const sent = toolOutputOf({ answer: ran.answer, tool: "triage_next" });
    const answer = ran.answer as { unread: readonly { source: string }[]; triage: { card: string } };
    // Within the unread budget of the cap, so this list unbudgeted (16 reasons of 2 KB each) would cross it.
    expect(new TextEncoder().encode(JSON.stringify(ran.answer)).length).toBeGreaterThan(
      TOOL_OUTPUT_MAX - UNREAD_MAX_BYTES,
    );
    expect(sent).toBe(JSON.stringify(ran.answer));
    expect([answer.triage.card, answer.unread.map(({ source }) => source)]).toEqual([
      `hand:${id}`,
      unread.map(({ source }) => source),
    ]);
  });
});
