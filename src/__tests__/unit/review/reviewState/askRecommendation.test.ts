import { describe, expect, it } from "vitest";
import { askRecommendation } from "../../../../review/reviewState.js";
import { NOW } from "./fixtures.js";

describe("askRecommendation", () => {
  const base = {
    bump: { kind: "unknown", why: "" } as const,
    ci: "green" as const,
    slack: { asked: "no", asks: [], bounded: true, mentioned: "no", mentions: [], why: "" } as const,
    undrafted: true,
  };

  it("says still-draft before anything else", () => {
    expect(
      askRecommendation({
        conflicted: false,
        selfMerging: false,
        stacked: false,
        state: { ...base, ci: "red", undrafted: false },
      }),
    ).toBe("still-draft");
  });

  it("says blocked on red CI", () => {
    expect(
      askRecommendation({
        conflicted: false,
        selfMerging: false,
        stacked: false,
        state: { ...base, ci: "red" },
      }),
    ).toBe("blocked");
  });

  it("does NOT block on an open CodeRabbit thread, which is advisory here", () => {
    expect(askRecommendation({ conflicted: false, selfMerging: false, stacked: false, state: base })).toBe("send-ask");
  });

  // The gap: a conflict used to be folded into `blocked` and evaluated AFTER self-merging, so a
  // conflicting pull request in a self-merging repository read "land it yourself" and never reached a card.
  it("says conflicting on a merge conflict, ahead of self-merging", () => {
    expect(askRecommendation({ conflicted: true, selfMerging: true, stacked: false, state: base })).toBe("conflicting");
  });

  it("says conflicting ahead of a draft and red CI, because the branch has to be rebased whatever else is true", () => {
    const draftRed = { ...base, ci: "red" as const, undrafted: false };
    expect(askRecommendation({ conflicted: true, selfMerging: false, stacked: false, state: draftRed })).toBe(
      "conflicting",
    );
  });

  it("never says blocked for a conflict alone — blocked is red CI", () => {
    expect(askRecommendation({ conflicted: false, selfMerging: false, stacked: false, state: base })).toBe("send-ask");
  });

  it("says unknown rather than send-ask when the Slack window could not be bounded", () => {
    const slack = { asked: "unknown", asks: [], bounded: true, mentioned: "unknown", mentions: [], why: "w" } as const;
    expect(
      askRecommendation({
        conflicted: false,
        selfMerging: false,
        stacked: false,
        state: { ...base, slack },
      }),
    ).toBe("unknown");
  });

  it("says send-ask for a green, undrafted pull request nobody has been asked about", () => {
    expect(askRecommendation({ conflicted: false, selfMerging: false, stacked: false, state: base })).toBe("send-ask");
  });

  it("says bump when an ask exists and cadence says a day of silence has passed", () => {
    const slack = { asked: "yes", asks: [], bounded: true, mentioned: "yes", mentions: [], why: "" } as const;
    const bump = { eligibleSinceIso: NOW, kind: "due", silentSinceIso: NOW } as const;
    expect(
      askRecommendation({
        conflicted: false,
        selfMerging: false,
        stacked: false,
        state: { ...base, bump, slack },
      }),
    ).toBe("bump");
  });

  it("says already-asked when an ask exists and no bump is due", () => {
    const slack = { asked: "yes", asks: [], bounded: true, mentioned: "yes", mentions: [], why: "" } as const;
    const bump = { kind: "replied", why: "they replied" } as const;
    expect(
      askRecommendation({
        conflicted: false,
        selfMerging: false,
        stacked: false,
        state: { ...base, bump, slack },
      }),
    ).toBe("already-asked");
  });

  // A pull request is not asked about until it targets staging. One such pull request
  // was ALSO a draft, and `still-draft` would have said "undraft it and ask" — the wrong sentence for it.
  it("says stacked for a pull request off the default branch, before still-draft can say undraft-and-ask", () => {
    expect(
      askRecommendation({
        conflicted: false,
        selfMerging: false,
        stacked: true,
        state: { ...base, undrafted: false },
      }),
    ).toBe("stacked");
  });

  it("says stacked over red CI too — a stacked pull request is never an ask while its base has not landed", () => {
    expect(
      askRecommendation({
        conflicted: false,
        selfMerging: false,
        stacked: true,
        state: { ...base, ci: "red" as const },
      }),
    ).toBe("stacked");
  });

  // A conflict outranks stacked as it outranks everything else: the branch has to be rebased before the
  // stack can move at all, so the row says `conflicting` rather than hiding the pull request as stacked.
  it("says conflicting rather than stacked when a stacked pull request also conflicts", () => {
    expect(askRecommendation({ conflicted: true, selfMerging: false, stacked: true, state: base })).toBe("conflicting");
  });

  it("lets self-merges outrank stacked, because it means nobody is EVER asked", () => {
    expect(askRecommendation({ conflicted: false, selfMerging: true, stacked: true, state: base })).toBe("self-merges");
  });

  it("lets self-merges outrank a draft and red CI, so neither can mask it", () => {
    const draftRed = { ...base, ci: "red" as const, undrafted: false };
    expect(askRecommendation({ conflicted: false, selfMerging: true, stacked: false, state: draftRed })).toBe(
      "self-merges",
    );
  });

  // Each row is one priority boundary of the ladder, with its expected verdict written out rather than
  // computed, so a reordering of the short-circuits fails a named row instead of agreeing with itself.
  it.each([
    { conflicted: true, expected: "conflicting", selfMerging: true, stacked: true, undrafted: false },
    { conflicted: false, expected: "self-merges", selfMerging: true, stacked: true, undrafted: false },
    { conflicted: false, expected: "stacked", selfMerging: false, stacked: true, undrafted: false },
    { conflicted: false, expected: "still-draft", selfMerging: false, stacked: false, undrafted: false },
    { conflicted: false, expected: "send-ask", selfMerging: false, stacked: false, undrafted: true },
  ] as const)(
    "says $expected at conflicted=$conflicted, selfMerging=$selfMerging, stacked=$stacked, undrafted=$undrafted",
    ({ conflicted, expected, selfMerging, stacked, undrafted }) => {
      expect(askRecommendation({ conflicted, selfMerging, stacked, state: { ...base, undrafted } })).toBe(expected);
    },
  );
});

describe("askRecommendation and an unknown CodeRabbit verdict", () => {
  it("still recommends the ask when CodeRabbit is unreadable, because it is advisory", () => {
    expect(
      askRecommendation({
        conflicted: false,
        selfMerging: false,
        stacked: false,
        state: {
          bump: { kind: "unknown", why: "" },
          ci: "green",
          slack: { asked: "no", asks: [], bounded: true, mentioned: "no", mentions: [], why: "" },
          undrafted: true,
        },
      }),
    ).toBe("send-ask");
  });
});
