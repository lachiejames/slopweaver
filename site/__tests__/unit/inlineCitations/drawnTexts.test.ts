import { describe, expect, it } from "vitest";

import { handCard } from "../../../lib/handCard";
import { drawnTexts, notInline } from "../../../lib/inlineCitations";
import { pr } from "./fixtures";

describe("drawnTexts", () => {
  it("hands notInline every sentence a card draws, so a PR named in the what is not listed again", () => {
    const { card } = handCard({
      step: {
        checklist: undefined,
        cites: [],
        id: "approve-5",
        ifIgnored: undefined,
        literal: undefined,
        opened: undefined,
        unaddressed: undefined,
        unblocks: `landing #6 (${pr({ n: 6 })})`,
        url: undefined,
        what: `Approve #5 (${pr({ n: 5 })}).`,
        where: undefined,
        witness: undefined,
      },
    });
    expect(notInline({ prUrls: [pr({ n: 5 }), pr({ n: 6 }), pr({ n: 7 })], texts: drawnTexts({ card }) })).toEqual([
      pr({ n: 7 }),
    ]);
  });
});
