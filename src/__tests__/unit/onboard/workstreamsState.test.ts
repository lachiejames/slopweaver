import { describe, expect, it } from "vitest";

import { type MinedState, onboardWorkstreamsState } from "../../../onboard/workstreams.js";

/** A mine that read Notion and left three candidates, one unanswered. */
const MINED: MinedState = {
  candidates: 3,
  minedIso: "2026-10-03T04:00:00.000Z",
  minedSources: ["notion"],
  proposalOwed: 0,
  unanswered: 1,
};

describe("onboardWorkstreamsState", () => {
  it("asks for one source first when nothing is pulled, and reveals nothing", () => {
    const state = onboardWorkstreamsState({ held: [{ bytes: 0, source: "notion" }], mined: null });
    expect([state.step, state.reveal, state.unread]).toEqual(["pull", false, []]);
    expect(state.next).toContain("Notion alone");
  });

  it("mines what one source holds when nothing has been mined, before the screen is shown", () => {
    const state = onboardWorkstreamsState({
      held: [
        { bytes: 412, source: "notion" },
        { bytes: 0, source: "slack" },
      ],
      mined: null,
    });
    expect([state.step, state.reveal, state.unread]).toEqual(["mine", false, ["notion"]]);
  });

  it("sends the person to the console while a candidate waits on their word", () => {
    const state = onboardWorkstreamsState({ held: [{ bytes: 412, source: "notion" }], mined: MINED });
    expect([state.step, state.reveal]).toEqual(["react", true]);
    expect(state.next).toBe("1 candidate(s) wait on their word, on the console at /workstreams#candidates");
  });

  it("mines again for a source pulled since the mine read it, keeping the screen revealed", () => {
    const state = onboardWorkstreamsState({
      held: [
        { bytes: 412, source: "notion" },
        { bytes: 90, source: "slack" },
      ],
      mined: MINED,
    });
    expect([state.step, state.reveal, state.unread]).toEqual(["mine", true, ["slack"]]);
    expect(state.next).toBe("mine again: slack pulled since the mine read it");
  });

  it("mines again for a proposal of theirs no mine has read", () => {
    const state = onboardWorkstreamsState({
      held: [{ bytes: 412, source: "notion" }],
      mined: { ...MINED, proposalOwed: 2 },
    });
    expect([state.step, state.next]).toEqual(["mine", "mine again: 2 proposal(s) of theirs unread"]);
  });

  it("counts no source unread for a mine that did not say what it read", () => {
    const state = onboardWorkstreamsState({
      held: [{ bytes: 90, source: "slack" }],
      mined: { ...MINED, minedSources: [], unanswered: 0 },
    });
    expect([state.step, state.unread]).toEqual(["answered", []]);
  });
});
