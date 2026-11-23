/*
 * The cmux hang judge's `shouldJournalReading`: the first reading, every unanswered one and a relaunch are kept, a
 * repeat of an answering app is not.
 */
import { describe, expect, it } from "vitest";

import { shouldJournalReading } from "../../../../cmux/hang.js";
import { reading } from "./harness.js";

describe("shouldJournalReading", () => {
  const answering = reading({ at: "18:00", state: "answering" });

  it("journals the first reading", () => {
    expect(shouldJournalReading({ next: answering, previous: undefined })).toBe(true);
  });

  it("skips a repeat of an answering app", () => {
    expect(shouldJournalReading({ next: answering, previous: answering })).toBe(false);
  });

  it("journals every unanswered reading, repeats included", () => {
    const refused = reading({ at: "19:00", state: "refused" });
    expect(shouldJournalReading({ next: refused, previous: refused })).toBe(true);
  });

  it("journals an answering app that relaunched on the same state", () => {
    const relaunched = reading({
      appPid: 24622,
      appStart: "Sat Oct 10 23:45:46 2026",
      at: "23:46",
      state: "answering",
    });
    expect(shouldJournalReading({ next: relaunched, previous: answering })).toBe(true);
  });
});
