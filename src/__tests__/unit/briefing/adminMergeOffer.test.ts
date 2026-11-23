/**
 * The criterion behind "a card never offers an administrator merge", and the refusal it produces. Pure — the
 * input is a string and the output is a string or undefined.
 *
 * The first case is the sentence card a fleet briefing actually carried, which is the
 * card that cost the owner the ruling.
 */
import { describe, expect, it } from "vitest";
import { adminMergeOffer, adminMergeRefusal } from "../../../briefing/adminMergeOffer.js";

describe("adminMergeOffer", () => {
  it("finds the option that cost the ruling", () => {
    expect(adminMergeOffer({ text: "Admin merge it on their word and land it tonight." })).toBe("Admin merge");
  });

  it("finds the flag itself", () => {
    expect(adminMergeOffer({ text: "Land it with `github merge --admin --number 16378`." })).toBe("--admin");
  });

  it("finds the hyphenated and gerund forms", () => {
    expect(adminMergeOffer({ text: "Say yes to admin-merging it." })).toBe("admin-merging");
    expect(adminMergeOffer({ text: "We admin merges nothing" })).toBe("admin merges");
  });

  it("finds the phrase written around the noun", () => {
    expect(adminMergeOffer({ text: "Merge it as admin so it lands before the demo." })).toBe("Merge it as admin");
    expect(adminMergeOffer({ text: "merging this through admin is the fastest route" })).toBe(
      "merging this through admin",
    );
  });

  it("leaves the past tense alone, which reports rather than offers", () => {
    expect(adminMergeOffer({ text: "We admin merged it at 18:04 and pulled the base." })).toBe(undefined);
  });

  it("leaves an ordinary merge alone", () => {
    expect(adminMergeOffer({ text: "Queue it with `github enqueue` and let GitHub land it." })).toBe(undefined);
  });

  it("leaves an unrelated use of admin alone", () => {
    expect(adminMergeOffer({ text: "Ask the org admin to add the reviewer team." })).toBe(undefined);
  });
});

describe("adminMergeRefusal", () => {
  it("names the cell, the phrase and the mechanism that makes it impossible", () => {
    const refusal = adminMergeRefusal({ cell: "option B", phrase: "Admin merge" });
    expect(refusal).toContain('option B offers an administrator merge with "Admin merge"');
    expect(refusal).toContain("a ruleset's requirement is not something admin permission or enforce_admins can waive");
    expect(refusal).toContain("slopweaver github review-state");
  });
});
