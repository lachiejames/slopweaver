/*
 * The call widget's derived words: the context chip, which must never say the voice has read a page it was only told
 * the title of, and the one-line summary the call's relays fold behind.
 */

import { describe, expect, it } from "vitest";

import { relaySummary, voiceSeesWords } from "../../lib/talkContext";

describe("voiceSeesWords", () => {
  it("names the page it was told, and says it reads the page only on asking", () => {
    expect(voiceSeesWords({ pageTitle: "Queue", sharing: undefined, sight: "share" })).toEqual({
      detail:
        "It believes you are on Queue, and reads that page only when it asks to. You are not sharing your screen.",
      label: "on Queue",
    });
  });

  it("says the desktop app can look, never promises a gate it does not have, and never says the owner is sharing", () => {
    expect(voiceSeesWords({ pageTitle: "Queue", sharing: undefined, sight: "native" })).toEqual({
      detail:
        "It believes you are on Queue, and reads that page only when it asks to. It can take one picture of your " +
        "whole screen each time it looks, and is told to look only when you ask. The edge of your screen flashes for " +
        "every picture.",
      label: "on Queue · can look",
    });
  });

  it("adds the share when the owner is sharing, turning the voice's third person into the owner's second", () => {
    expect([
      voiceSeesWords({ pageTitle: "Alignment", sharing: "one window they picked", sight: "share" }),
      voiceSeesWords({ pageTitle: "Alignment", sharing: "the owner's whole screen", sight: "share" }).detail,
    ]).toEqual([
      {
        detail:
          "It believes you are on Alignment, and reads that page only when it asks to. It can see one window you picked.",
        label: "on Alignment · sharing",
      },
      "It believes you are on Alignment, and reads that page only when it asks to. It can see your whole screen.",
    ]);
  });

  it("says no page has named itself rather than printing an empty title", () => {
    expect(voiceSeesWords({ pageTitle: "", sharing: undefined, sight: "share" })).toEqual({
      detail: "No page has told it where you are. You are not sharing your screen.",
      label: "no page named",
    });
  });
});

describe("relaySummary", () => {
  it("counts each outcome that happened, relayed first, whatever order they arrived in", () => {
    expect(relaySummary({ outcomes: ["board-only", "relayed", "refused", "relayed"] })).toBe(
      "2 relayed · 1 board-only · 1 refused",
    );
  });

  it("is empty when nothing was relayed", () => {
    expect(relaySummary({ outcomes: [] })).toBe("");
  });
});
