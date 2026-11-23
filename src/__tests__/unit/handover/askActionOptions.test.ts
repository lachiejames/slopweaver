import { describe, expect, it } from "vitest";

import { MAX_OPTIONS } from "../../../briefing/caps.js";
import { ACTION_MAX_DESTINATIONS, type AskAction } from "../../../handover/askAction.js";
import { actionOptions, actionOptionsFitCap, HOLD_OPTION } from "../../../handover/askActionOptions.js";
import { askShapeProblems } from "../../../handover/askShape.js";

/** An action offering the two places tick 363 named, plus a thread. */
const WHOLE: AskAction = {
  actor: "me",
  body: "<@U01ARI> the E2E switch-over is ready for review.",
  destinations: [
    {
      channel: "C01SDLC",
      kind: "channel",
      label: "Post it to #delivery",
      tradeoff: "the whole channel sees we are asking",
    },
    {
      conversation: "D01ARI",
      kind: "dm",
      label: "DM Ari",
      recipients: [{ label: "Ari", userId: "U01ARI" }],
      tradeoff: "only they see it, so nobody else can pick it up",
    },
  ],
  mentions: [{ label: "Ari", userId: "U01ARI" }],
  version: 1,
};

describe("actionOptions", () => {
  it("gives one option per destination in order, then the hold, lettered by position", () => {
    expect(actionOptions({ action: WHOLE })).toEqual([
      { letter: "A", option: "Post it to #delivery", tradeoff: "the whole channel sees we are asking" },
      { letter: "B", option: "DM Ari", tradeoff: "only they see it, so nobody else can pick it up" },
      { letter: "C", option: HOLD_OPTION.option, tradeoff: HOLD_OPTION.tradeoff },
    ]);
  });

  it("offers the hold even when the action offers one place", () => {
    const one = { ...WHOLE, destinations: [WHOLE.destinations[0]!] };
    expect(actionOptions({ action: one }).map((option) => option.option)).toEqual([
      "Post it to #delivery",
      HOLD_OPTION.option,
    ]);
  });

  it("names what holding costs rather than calling it free", () => {
    expect(HOLD_OPTION.tradeoff).toBe("the thread moves on without our answer, and the draft goes stale");
  });

  it("derives options an ask shape accepts, at the full destination cap", () => {
    const full = {
      ...WHOLE,
      destinations: Array.from({ length: ACTION_MAX_DESTINATIONS }, (_unused, index) => ({
        channel: `C0${String(index)}SDLC`,
        kind: "channel" as const,
        label: `Post it to #room-${String(index)}`,
        tradeoff: `the whole of room ${String(index)} sees we are asking`,
      })),
    };
    const options = actionOptions({ action: full });
    expect(options).toHaveLength(ACTION_MAX_DESTINATIONS + 1);
    expect(
      askShapeProblems({
        shape: {
          lean: "take A, because #delivery is where reviews get picked up",
          options,
          problem: "nobody reviewed it",
          stakes: undefined,
        },
      }),
    ).toEqual([]);
  });
});

describe("actionOptionsFitCap", () => {
  it("is the witness that the two caps still agree", () => {
    expect(actionOptionsFitCap()).toBe(true);
  });

  it("holds because the destination cap leaves the hold a slot", () => {
    expect(ACTION_MAX_DESTINATIONS + 1).toBe(MAX_OPTIONS);
  });
});
