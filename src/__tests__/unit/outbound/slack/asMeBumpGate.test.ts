import { describe, expect, it } from "vitest";

import { JUDGEMENT_NOTE } from "../../../../hatch/render.js";
import { bumpRefusalFor, hasResolvedMention, isBumpShaped } from "../../../../outbound/slack/asMeBumpGate.js";

describe("isBumpShaped", () => {
  it("recognises the word bump", () => {
    expect(isBumpShaped({ text: "bumping this thread" })).toBe(true);
  });

  it("recognises a review-request phrase", () => {
    expect(isBumpShaped({ text: "pls review when you get a chance" })).toBe(true);
  });

  it("recognises still waiting", () => {
    expect(isBumpShaped({ text: "still waiting on this one" })).toBe(true);
  });

  it("FALSIFIABLE NEGATIVE — ordinary prose with none of the chase vocabulary is not bump-shaped", () => {
    expect(isBumpShaped({ text: "the deploy finished cleanly and the dashboard looks good" })).toBe(false);
  });
});

describe("hasResolvedMention", () => {
  it("finds a resolved mention token", () => {
    expect(hasResolvedMention({ text: "bumping this <@U0JONAH>" })).toBe(true);
  });

  it("does not mistake a plain @handle for a resolved mention", () => {
    expect(hasResolvedMention({ text: "bumping this @jonah" })).toBe(false);
  });

  it("does not mistake a bare name for a resolved mention", () => {
    expect(hasResolvedMention({ text: "bumping this for Jonah" })).toBe(false);
  });
});

describe("bumpRefusalFor", () => {
  it("refuses a bump with no resolved mention, in the house four-line shape", () => {
    const refusal = bumpRefusalFor({ text: "Jonah, just bumping this — any update on #16000?" });
    expect(refusal.length).toBe(4);
    expect(refusal[2]).toBe(
      'To override use the designated escape hatch slopweaver hatch open untagged-bump --reason "<why this' +
        ' one is a legitimate exception>", then re-run slopweaver slack post --as me.',
    );
    expect(refusal[3]).toBe(JUDGEMENT_NOTE);
  });

  it("names the person it thinks is being chased when it can tell from a greeting", () => {
    const refusal = bumpRefusalFor({ text: "Hey Jonah, just bumping this" });
    expect(refusal[0]).toContain("it reads as chasing Jonah");
  });

  it("sends nothing when the hatch the owner's ruling opened is open", () => {
    expect(bumpRefusalFor({ allowUntagged: true, text: "Hey Jonah, just bumping this" })).toEqual([]);
  });

  it("passes a bump that already carries a resolved mention", () => {
    const refusal = bumpRefusalFor({ text: "bumping this <@U0JONAH>" });
    expect(refusal.length).toBe(0);
  });

  it("FALSIFIABLE NEGATIVE — a non-bump body with no mention passes untouched", () => {
    const refusal = bumpRefusalFor({ text: "the deploy finished cleanly and the dashboard looks good" });
    expect(refusal.length).toBe(0);
  });

  it("passes a bump whose person hint cannot be guessed, still refusing", () => {
    const refusal = bumpRefusalFor({ text: "just a reminder that this is still waiting on review" });
    expect(refusal[0]).toBe(
      "slopweaver slack post --as me blocked because the message reads as a chase but carries no resolved " +
        "`<@U…>` mention, and an untagged chase lands in nobody's activity feed.",
    );
  });
});
