/**
 * The pure rules of a retirement: only a declared row may be retired, only its canonical file is removed, and the
 * owner's words must stand in the owner's record byte for byte.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import {
  declaredForRetirement,
  retirementFromWords,
  retirementTarget,
} from "../../../../live/automation/retirement.js";

const RECORD = "Report sweep only made sense for the acme install. So I'd expect all of those to be switched off.";

describe("declaredForRetirement", () => {
  it("accepts a declared row", () => {
    expect(unwrap(declaredForRetirement({ declaredIds: ["a", "b"], recipeId: "b" }))).toBe("b");
  });

  it("refuses a row the install does not declare, since nothing could restore it", () => {
    const refused = declaredForRetirement({ declaredIds: ["a"], recipeId: "hand-written" })._unsafeUnwrapErr();
    expect(refused.code).toBe("RETIREMENT_NOT_DECLARED");
    expect(refused.message).toContain("hand-written is not a standing row this install declares");
  });
});

describe("retirementTarget", () => {
  it("names the canonical file when the row stands there alone", () => {
    const target = retirementTarget({
      definitionFiles: ["a.json", "b.json"],
      definitionIds: ["a", "b"],
      recipeId: "b",
      rejected: [],
    });
    expect(unwrap(target)).toBe("b.json");
  });

  it("answers null when the row has no file", () => {
    const target = retirementTarget({ definitionFiles: ["a.json"], definitionIds: ["a"], recipeId: "b", rejected: [] });
    expect(unwrap(target)).toBe(null);
  });

  it("refuses a canonical file the reader rejected, never deleting it unread", () => {
    const target = retirementTarget({
      definitionFiles: [],
      definitionIds: [],
      recipeId: "b",
      rejected: [{ file: "b.json", why: "bad cadence" }],
    });
    expect(target._unsafeUnwrapErr().message).toBe(
      "b.json does not parse (bad cadence), so it is not removed unread; nothing changed",
    );
  });

  it("refuses a row that also stands in another file", () => {
    const target = retirementTarget({
      definitionFiles: ["b.json", "b-copy.json"],
      definitionIds: ["b", "b"],
      recipeId: "b",
      rejected: [],
    });
    expect(target._unsafeUnwrapErr().code).toBe("RETIREMENT_DEFINITION_AMBIGUOUS");
  });
});

describe("retirementFromWords", () => {
  const base = {
    anchor: "talk-call:acme#turn_1",
    recipeId: "thread-chase-daily",
    recordText: RECORD,
    retiredAtIso: "2026-11-03T08:00:00.000Z",
    why: "chases threads in a workspace this install no longer serves",
  };

  it("composes the entry when the owner's words stand in the record exactly", () => {
    const words = "Report sweep only made sense for the acme install";
    expect(unwrap(retirementFromWords({ ...base, words }))).toEqual({
      anchor: base.anchor,
      recipeId: base.recipeId,
      retiredAtIso: base.retiredAtIso,
      why: base.why,
      words,
    });
  });

  it("refuses words that differ from the record only in case", () => {
    const refused = retirementFromWords({ ...base, words: "report sweep only made" })._unsafeUnwrapErr();
    expect(refused.code).toBe("RETIREMENT_WORDS_NOT_IN_RECORD");
  });

  it("refuses blank words", () => {
    const refused = retirementFromWords({ ...base, words: " \n" })._unsafeUnwrapErr();
    expect(refused.message).toBe("--words is blank — a retirement must carry something a reader can check");
  });

  it("refuses a blank why", () => {
    const refused = retirementFromWords({ ...base, why: "", words: "switched off" })._unsafeUnwrapErr();
    expect(refused.message).toBe("--why is blank — a retirement must carry something a reader can check");
  });
});
