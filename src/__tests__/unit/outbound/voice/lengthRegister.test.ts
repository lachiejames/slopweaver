/**
 * The measured length check, and the distinction that stops it reporting clean when it never ran.
 *
 * A surface no cohort measured returns `uncalibrated` with zero warnings, and a surface within its
 * threshold returns `measured` with zero warnings. Those two are indistinguishable by the warning list
 * alone, which is exactly the shape `a-check-that-cannot-fail-reports-clean` names — so both are asserted
 * on the CALIBRATION field rather than on the absence of output.
 *
 * The threshold-boundary pair is the other property worth pinning: a body exactly at p90 must not warn and
 * one word past it must, because a warning that fires at the median would fire on half of everything the
 * owner sends and be turned off within a day.
 */
import { describe, expect, it } from "vitest";

import type { AboveFoldCell } from "../../../../outbound/voice/aboveFold.js";
import {
  authoredProseWordCount,
  cohortForSurface,
  lengthVerdictFor,
} from "../../../../outbound/voice/lengthRegister.js";
import type { VoiceCohort } from "../../../../store/profile/types.js";

/** The owner's measured Slack cohort, as `communication-style.md` states it. */
const SLACK_ALL: VoiceCohort = {
  ceilingWords: 50,
  cohort: "all-sent",
  measuredAt: "2026-08-23T00:00:00.000Z",
  medianWords: 14,
  p75Words: 29,
  p90Words: 54,
  qualification: "",
  sampleCount: 4718,
  source: "file:communication-style.md",
  surface: "slack",
};

/** The much shorter two-person calibration measured on the same surface. */
const SLACK_CALIBRATION: VoiceCohort = {
  ...SLACK_ALL,
  cohort: "dm-calibration",
  medianWords: 7,
  p75Words: null,
  p90Words: 18,
  sampleCount: 312,
};

/** One cell carrying `count` plain words. */
function cellOf({ count }: { count: number }): AboveFoldCell {
  return { path: "body", text: Array.from({ length: count }, () => "word").join(" ") };
}

describe("authoredProseWordCount", () => {
  it("counts across every cell, because the register measures a message and a cell is a form field", () => {
    expect(authoredProseWordCount({ cells: [cellOf({ count: 4 }), cellOf({ count: 6 })] })).toBe(10);
  });

  it("drops a URL, so the count is the same one the sentence cap uses", () => {
    const withUrl: AboveFoldCell = { path: "body", text: "see https://example.com/a/very/long/path for this" };
    expect(authoredProseWordCount({ cells: [withUrl] })).toBe(3);
  });
});

describe("cohortForSurface", () => {
  it("picks the larger sample, so a two-person calibration never judges a channel post", () => {
    expect(cohortForSurface({ cohorts: [SLACK_CALIBRATION, SLACK_ALL], surface: "slack" })?.cohort).toBe("all-sent");
  });

  it("reaches nothing on a surface nobody measured", () => {
    expect(cohortForSurface({ cohorts: [SLACK_ALL], surface: "notion" })).toBeUndefined();
  });
});

describe("lengthVerdictFor", () => {
  it("says UNCALIBRATED on a surface nothing measured, rather than reporting no warnings", () => {
    const verdict = lengthVerdictFor({ cells: [cellOf({ count: 4000 })], cohorts: [SLACK_ALL], surface: "notion" });
    expect(verdict.calibration).toBe("uncalibrated");
    expect(verdict.warnings).toStrictEqual([]);
  });

  it("says MEASURED and stays silent for a body at exactly the threshold", () => {
    const verdict = lengthVerdictFor({ cells: [cellOf({ count: 54 })], cohorts: [SLACK_ALL], surface: "slack" });
    expect(verdict.calibration).toBe("measured");
    expect(verdict.warnings).toStrictEqual([]);
    expect(verdict.words).toBe(54);
  });

  it("warns one word past the threshold, naming the cohort, the ratio and that it never blocks", () => {
    const verdict = lengthVerdictFor({ cells: [cellOf({ count: 55 })], cohorts: [SLACK_ALL], surface: "slack" });
    expect(verdict.warnings).toHaveLength(1);
    expect(verdict.warnings[0]).toContain("slack/all-sent p90 54");
    expect(verdict.warnings[0]).toContain("1.0x");
    expect(verdict.warnings[0]).toContain("never blocks the write");
  });

  it("falls back to a stated ceiling when no p90 was measured", () => {
    const ceilingOnly: VoiceCohort = { ...SLACK_ALL, ceilingWords: 20, p90Words: null };
    const verdict = lengthVerdictFor({ cells: [cellOf({ count: 21 })], cohorts: [ceilingOnly], surface: "slack" });
    expect(verdict.warnings[0]).toContain("stated ceiling 20");
  });

  it("is uncalibrated when a cohort exists but carries neither a p90 nor a ceiling", () => {
    const hollow: VoiceCohort = { ...SLACK_ALL, ceilingWords: null, p90Words: null };
    expect(lengthVerdictFor({ cells: [cellOf({ count: 900 })], cohorts: [hollow], surface: "slack" }).calibration).toBe(
      "uncalibrated",
    );
  });
});
