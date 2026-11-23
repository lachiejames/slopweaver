/*
 * The administrator-merge offer: a card that offers one in an option or restates it in `lean` is refused,
 * naming the field and the phrase, while a card that only reports one is left alone.
 */
import { describe, expect, it } from "vitest";

import { artifact, card, check } from "./harness.js";

describe("checkReactNowCards — the administrator-merge offer", () => {
  it("refuses an option that offers one, naming the option and the phrase", () => {
    const html = artifact({
      cards: [card({ options: "A: admin merge it tonight. B: wait for the codeowner review." })],
    });

    const result = check({ html });

    const offer = result.defects.filter((defect) => defect.reason.includes("offers an administrator merge"));
    expect(offer).toHaveLength(1);
    expect(offer[0]!.field).toBe("options");
    expect(offer[0]!.reason).toContain('option A offers an administrator merge with "admin merge"');
  });

  it("refuses the same offer restated in `lean`", () => {
    const html = artifact({ cards: [card({ lean: "B, and land it with --admin once CI is green." })] });

    const result = check({ html });

    const offer = result.defects.filter((defect) => defect.reason.includes("offers an administrator merge"));
    expect(offer).toHaveLength(1);
    expect(offer[0]!.field).toBe("lean");
    expect(offer[0]!.reason).toContain('lean offers an administrator merge with "--admin"');
  });

  it("leaves a card that only REPORTS one alone, so this change can be described on a card", () => {
    const html = artifact({
      cards: [card({ what: "The door now refuses --admin on a review-gated base. It landed this morning." })],
    });

    const result = check({ html });

    expect(result.defects.filter((defect) => defect.reason.includes("offers an administrator merge"))).toEqual([]);
  });
});
