/**
 * `firstFiring.ts` — when a scheduled card opens with its day-one intro, what the derived one says, and the read
 * verbs' `--intro` flag. All pure.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import type { RecipeDefinitionRun } from "../../../../live/automation/definitionRunStore.js";
import { RecipeErrors } from "../../../../live/automation/errors.js";
import {
  cadencePhrase,
  defaultIntro,
  firstFiringIntro,
  introFlagArgs,
  parseIntroFlag,
} from "../../../../live/automation/firstFiring.js";
import { INTRO_LINE_VISIBLE_MAX, introSchema } from "../../../../outbound/artifact/introAndRank.js";

const RAN: RecipeDefinitionRun = {
  exitCode: 0,
  lastRunAtIso: "2026-09-15T08:00:04Z",
  watermarkIso: "2026-09-15T08:00:00Z",
};

describe("cadencePhrase", () => {
  it.each([
    ["0 8 * * *", "every day"],
    ["30 9 * * 1-5", "every weekday"],
    ["0 9 * * 1", "every Monday"],
    ["0 */4 * * *", "on a regular schedule"],
    ["0 8 1 * *", "on a regular schedule"],
    ["0 8 * * 1,3", "on a regular schedule"],
    ["not a cron", "on a regular schedule"],
  ])("reads %s as %s", (cadence, phrase) => {
    expect(cadencePhrase({ cadence })).toBe(phrase);
  });
});

describe("defaultIntro", () => {
  it("says it is a trial, how often, what it covers, and where feedback goes, in lines inside the cap", () => {
    const lines = defaultIntro({ cadence: "0 8 * * *" });

    expect(lines).toEqual([
      "👋 this is a trial. i will post a summary of this channel's alerts here every day.",
      "it lists what fired and what needs a person, so you can see it without digging through the alerts.",
      "feedback goes in the thread. if it is not useful, it gets turned off.",
    ]);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(INTRO_LINE_VISIBLE_MAX);
  });

  it("names no row label, so nothing a row is called can make its intro unpostable", () => {
    const hostile = ["0 8 * * *", "0 */4 * * *", "30 9 * * 1-5"].map((cadence) => defaultIntro({ cadence }));

    expect(hostile.every((lines) => introSchema.safeParse(lines).success)).toBe(true);
  });
});

describe("defaultIntro states the cadence it was given", () => {
  it("names the schedule in words, and stays inside every bound the card applies", () => {
    const [opening] = defaultIntro({ cadence: "0 */4 * * *" });

    expect(opening).toContain("on a regular schedule");
    expect(introSchema.safeParse(defaultIntro({ cadence: "0 */4 * * *" })).success).toBe(true);
  });
});

describe("firstFiringIntro", () => {
  it("carries no intro once any firing of the row has settled, even when the row wrote one", () => {
    expect(firstFiringIntro({ cadence: "0 8 * * *", intro: ["hello"], priorRun: RAN })).toBe(undefined);
  });

  it("still introduces a row whose only runs were refused at the door or retired dead", () => {
    const refused: RecipeDefinitionRun = { ...RAN, exitCode: 3 };
    const dead: RecipeDefinitionRun = { ...RAN, exitCode: 1 };

    expect(firstFiringIntro({ cadence: "0 8 * * *", intro: ["hello"], priorRun: refused })).toEqual(["hello"]);
    expect(firstFiringIntro({ cadence: "0 8 * * *", intro: ["hello"], priorRun: dead })).toEqual(["hello"]);
  });

  it("stays quiet on a row that delivered once, even when its latest run failed", () => {
    const failedSince: RecipeDefinitionRun = { ...RAN, exitCode: 1, firstSucceededIso: "2026-09-10T08:00:04Z" };

    expect(firstFiringIntro({ cadence: "0 8 * * *", intro: ["hello"], priorRun: failedSince })).toBe(undefined);
  });

  it("uses the row's own lines on the first firing", () => {
    expect(firstFiringIntro({ cadence: "0 8 * * *", intro: ["hello"], priorRun: undefined })).toEqual(["hello"]);
  });

  it("derives the intro on the first firing when the row wrote none", () => {
    expect(firstFiringIntro({ cadence: "0 8 * * *", intro: undefined, priorRun: undefined })).toEqual(
      defaultIntro({ cadence: "0 8 * * *" }),
    );
  });
});

describe("introFlagArgs and parseIntroFlag", () => {
  it("round-trips the lines through the flag", () => {
    const args = introFlagArgs({ intro: ["one.", "two."] });

    expect(args[0]).toBe("--intro");
    expect(unwrap(parseIntroFlag({ value: args[1] }))).toEqual(["one.", "two."]);
  });

  it("adds no flag when there is no intro, and parses an absent flag as none", () => {
    expect(introFlagArgs({ intro: undefined })).toEqual([]);
    expect(unwrap(parseIntroFlag({ value: undefined }))).toBe(undefined);
  });

  it("REFUSES a value that is not JSON", () => {
    expect(unwrapErr(parseIntroFlag({ value: "hello" }))).toEqual(RecipeErrors.introNotJson({ got: "hello" }));
    expect(unwrapErr(parseIntroFlag({ value: "hello" })).message).toBe(
      `--intro is not JSON: pass a JSON array of lines, e.g. '["this is a trial."]'`,
    );
  });

  it("REFUSES a line wider than the card would accept, so a row's own intro is caught when it is planned", () => {
    const { message } = unwrapErr(parseIntroFlag({ value: JSON.stringify(["x".repeat(INTRO_LINE_VISIBLE_MAX + 1)]) }));

    expect(message).toContain("--intro must be a JSON array of 1 to 4 non-empty lines");
  });

  it("REFUSES a line carrying a line break, which the card would refuse at the post leg", () => {
    const { message } = unwrapErr(parseIntroFlag({ value: JSON.stringify(["a trial.\nit posts every day."]) }));

    expect(message).toContain("--intro must be a JSON array of 1 to 4 non-empty lines");
  });

  it("REFUSES a line the CARD would refuse: emoji past the cap in UTF-16 units, a raw link, a [n] marker", () => {
    const refusals = ["👋".repeat(61), "the runbook is https://wiki.example.invalid/alerts", "see [1] below"].map(
      (line) => parseIntroFlag({ value: JSON.stringify([line]) }).isErr(),
    );

    expect(refusals).toEqual([true, true, true]);
  });

  it("REFUSES a line naming a ticket or control id, which the door refuses as bare text", () => {
    const refusals = [
      "it replaces SUP-123.",
      "worth reading before #456 lands.",
      "it covers HRS-52 today.",
      "the old thread is #1234567 if you want the history.",
      "it replaces the old checklist (#123) entirely.",
      "it covers the training control (HRS-52) here.",
      "closed today: 15632",
      "see [1234] below.",
    ].map((line) => parseIntroFlag({ value: JSON.stringify([line]) }).isErr());

    expect(refusals).toEqual([true, true, true, true, true, true, true, true]);
  });

  it("REFUSES five lines", () => {
    const { message } = unwrapErr(parseIntroFlag({ value: JSON.stringify(["a", "b", "c", "d", "e"]) }));

    expect(message).toContain("--intro must be a JSON array of 1 to 4 non-empty lines");
  });
});
