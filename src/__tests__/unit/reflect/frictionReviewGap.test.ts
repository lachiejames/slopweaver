/**
 * {@link latestReportDate}/{@link computeFrictionReviewGap} — pure, no fixtures needed.
 *
 * The staleness half exists because the two-date comparison had a blind spot that was exactly the failure
 * the gauge is for: a dead producer closes the gap by starving it. `THE 20 SEP 2026 READING` below is that
 * measurement frozen as a case, so the regression is pinned to the observation that found it.
 */
import { describe, expect, it } from "vitest";
import {
  computeFrictionReviewGap,
  latestReportDate,
  REPORT_STALE_AFTER_DAYS,
  renderFrictionReviewLine,
} from "../../../reflect/frictionReviewGap.js";

/** A day on which none of the reports below is stale, so a case can isolate the gap half. */
const SAME_DAY = "2026-09-02";

describe("latestReportDate", () => {
  it("returns null for an empty listing", () => {
    expect(latestReportDate({ filenames: [] })).toBeNull();
  });

  it("returns null when nothing matches the report filename shape", () => {
    expect(latestReportDate({ filenames: ["feedback-locked-in-audit-28aug.md", "readme.md"] })).toBeNull();
  });

  it("returns the one report date present", () => {
    expect(latestReportDate({ filenames: ["self-improvement-2026-09-01.md"] })).toBe("2026-09-01");
  });

  it("returns the newest date among several, regardless of listing order", () => {
    const filenames = [
      "self-improvement-2026-09-01.md",
      "self-improvement-2026-09-03.md",
      "self-improvement-2026-09-02.md",
    ];
    expect(latestReportDate({ filenames })).toBe("2026-09-03");
  });

  it("ignores non-report files mixed into the same directory", () => {
    const filenames = ["self-improvement-2026-09-01.md", "feedback-locked-in-audit-28aug.md"];
    expect(latestReportDate({ filenames })).toBe("2026-09-01");
  });
});

describe("computeFrictionReviewGap — the publish gap", () => {
  it("is never a gap when no report has ever been written", () => {
    expect(computeFrictionReviewGap({ latestReportDate: null, publishedDate: null, todayDate: SAME_DAY })).toEqual({
      daysSinceLatestReport: null,
      hasGap: false,
      isStale: false,
      latestReportDate: null,
      publishedDate: null,
    });
  });

  it("is a gap when a report exists and nothing has ever been published", () => {
    expect(
      computeFrictionReviewGap({ latestReportDate: "2026-09-02", publishedDate: null, todayDate: SAME_DAY }),
    ).toEqual({
      daysSinceLatestReport: 0,
      hasGap: true,
      isStale: false,
      latestReportDate: "2026-09-02",
      publishedDate: null,
    });
  });

  it("is a gap when the report is newer than the last publish", () => {
    expect(
      computeFrictionReviewGap({
        latestReportDate: "2026-09-02",
        publishedDate: "2026-09-01",
        todayDate: SAME_DAY,
      }),
    ).toEqual({
      daysSinceLatestReport: 0,
      hasGap: true,
      isStale: false,
      latestReportDate: "2026-09-02",
      publishedDate: "2026-09-01",
    });
  });

  it("is not a gap when the last publish already covers the newest report", () => {
    expect(
      computeFrictionReviewGap({
        latestReportDate: "2026-09-02",
        publishedDate: "2026-09-02",
        todayDate: SAME_DAY,
      }),
    ).toEqual({
      daysSinceLatestReport: 0,
      hasGap: false,
      isStale: false,
      latestReportDate: "2026-09-02",
      publishedDate: "2026-09-02",
    });
  });

  it("is not a gap when the last publish is somehow newer than the newest report", () => {
    expect(
      computeFrictionReviewGap({
        latestReportDate: "2026-09-01",
        publishedDate: "2026-09-02",
        todayDate: "2026-09-01",
      }),
    ).toEqual({
      daysSinceLatestReport: 0,
      hasGap: false,
      isStale: false,
      latestReportDate: "2026-09-01",
      publishedDate: "2026-09-02",
    });
  });
});

describe("computeFrictionReviewGap — the producer's age", () => {
  it("declares the threshold the boundary cases below are measured against", () => {
    expect(REPORT_STALE_AFTER_DAYS).toBe(2);
  });

  it("counts whole days from the newest report to today", () => {
    const gap = computeFrictionReviewGap({
      latestReportDate: "2026-09-03",
      publishedDate: "2026-09-03",
      todayDate: "2026-09-20",
    });

    expect(gap.daysSinceLatestReport).toBe(17);
  });

  it("is not stale on the report's own day", () => {
    const gap = computeFrictionReviewGap({
      latestReportDate: "2026-09-02",
      publishedDate: "2026-09-02",
      todayDate: "2026-09-02",
    });

    expect(gap.daysSinceLatestReport).toBe(0);
    expect(gap.isStale).toBe(false);
  });

  it("is not stale one day later — a run that slipped past midnight must not shout", () => {
    const gap = computeFrictionReviewGap({
      latestReportDate: "2026-09-02",
      publishedDate: "2026-09-02",
      todayDate: "2026-09-03",
    });

    expect(gap.daysSinceLatestReport).toBe(1);
    expect(gap.isStale).toBe(false);
  });

  it("is stale on the second missed day, which is the threshold itself", () => {
    const gap = computeFrictionReviewGap({
      latestReportDate: "2026-09-02",
      publishedDate: "2026-09-02",
      todayDate: "2026-09-04",
    });

    expect(gap.daysSinceLatestReport).toBe(2);
    expect(gap.isStale).toBe(true);
  });

  it("THE 20 SEP 2026 READING: a stamped report is not a gap and IS stale", () => {
    expect(
      computeFrictionReviewGap({
        latestReportDate: "2026-09-03",
        publishedDate: "2026-09-03",
        todayDate: "2026-09-20",
      }),
    ).toEqual({
      daysSinceLatestReport: 17,
      hasGap: false,
      isStale: true,
      latestReportDate: "2026-09-03",
      publishedDate: "2026-09-03",
    });
  });

  it("is a gap AND stale when a dead producer's last report was never republished", () => {
    const gap = computeFrictionReviewGap({
      latestReportDate: "2026-09-03",
      publishedDate: null,
      todayDate: "2026-09-20",
    });

    expect(gap.hasGap).toBe(true);
    expect(gap.isStale).toBe(true);
  });

  it("is never stale when no report has ever been written, however far in the future today is", () => {
    const gap = computeFrictionReviewGap({
      latestReportDate: null,
      publishedDate: null,
      todayDate: "2027-01-01",
    });

    expect(gap.daysSinceLatestReport).toBeNull();
    expect(gap.isStale).toBe(false);
  });

  it("reports no age rather than throwing when the report date is unreadable", () => {
    const gap = computeFrictionReviewGap({
      latestReportDate: "not-a-date",
      publishedDate: null,
      todayDate: "2026-09-20",
    });

    expect(gap.daysSinceLatestReport).toBeNull();
    expect(gap.isStale).toBe(false);
  });

  it("reports no age rather than throwing when today is unreadable", () => {
    const gap = computeFrictionReviewGap({
      latestReportDate: "2026-09-03",
      publishedDate: null,
      todayDate: "not-a-date",
    });

    expect(gap.daysSinceLatestReport).toBeNull();
    expect(gap.isStale).toBe(false);
  });

  it("is not stale when today is somehow before the newest report", () => {
    const gap = computeFrictionReviewGap({
      latestReportDate: "2026-09-20",
      publishedDate: "2026-09-20",
      todayDate: "2026-09-03",
    });

    expect(gap.daysSinceLatestReport).toBe(-17);
    expect(gap.isStale).toBe(false);
  });
});

describe("renderFrictionReviewLine", () => {
  it("says nothing has ever run when no report exists, even if marked is somehow true", () => {
    const gap = computeFrictionReviewGap({
      latestReportDate: null,
      publishedDate: null,
      todayDate: SAME_DAY,
    });
    expect(renderFrictionReviewLine({ gap, marked: true })).toBe(
      "reflect friction-review: no self-improvement report has ever been written — nothing to check",
    );
  });

  it("reports a fresh stamp when marked", () => {
    const gap = computeFrictionReviewGap({
      latestReportDate: "2026-09-02",
      publishedDate: "2026-09-02",
      todayDate: SAME_DAY,
    });
    expect(renderFrictionReviewLine({ gap, marked: true })).toBe(
      "reflect friction-review: stamped 2026-09-02 as republished",
    );
  });

  it("reports the gap, naming both dates, when unmarked and behind", () => {
    const gap = computeFrictionReviewGap({
      latestReportDate: "2026-09-02",
      publishedDate: "2026-09-01",
      todayDate: SAME_DAY,
    });
    expect(renderFrictionReviewLine({ gap, marked: false })).toBe(
      "reflect friction-review: GAP — newest report is 2026-09-02, last republish stamped 2026-09-01",
    );
  });

  it("names 'never' when there is a gap and nothing has ever been published", () => {
    const gap = computeFrictionReviewGap({
      latestReportDate: "2026-09-02",
      publishedDate: null,
      todayDate: SAME_DAY,
    });
    expect(renderFrictionReviewLine({ gap, marked: false })).toBe(
      "reflect friction-review: GAP — newest report is 2026-09-02, last republish stamped never",
    );
  });

  it("reports current when unmarked and there is no gap", () => {
    const gap = computeFrictionReviewGap({
      latestReportDate: "2026-09-02",
      publishedDate: "2026-09-02",
      todayDate: SAME_DAY,
    });
    expect(renderFrictionReviewLine({ gap, marked: false })).toBe(
      "reflect friction-review: current — 2026-09-02 is republished",
    );
  });

  it("reports STALE with the age and the check that settles it", () => {
    const gap = computeFrictionReviewGap({
      latestReportDate: "2026-09-03",
      publishedDate: "2026-09-03",
      todayDate: "2026-09-20",
    });
    expect(renderFrictionReviewLine({ gap, marked: false })).toBe(
      "reflect friction-review: STALE — newest report is 2026-09-03, 17 days old; the producer has " +
        "stopped, so republishing will not help. Check the row with `slopweaver automation due`",
    );
  });

  it("reports STALE rather than a fresh stamp — marking a dead report must not read as success", () => {
    const gap = computeFrictionReviewGap({
      latestReportDate: "2026-09-03",
      publishedDate: "2026-09-03",
      todayDate: "2026-09-20",
    });
    expect(renderFrictionReviewLine({ gap, marked: true })).toBe(
      "reflect friction-review: STALE — newest report is 2026-09-03, 17 days old; the producer has " +
        "stopped, so republishing will not help. Check the row with `slopweaver automation due`",
    );
  });

  it("reports STALE rather than the gap when both hold at once", () => {
    const gap = computeFrictionReviewGap({
      latestReportDate: "2026-09-03",
      publishedDate: null,
      todayDate: "2026-09-20",
    });
    expect(renderFrictionReviewLine({ gap, marked: false })).toBe(
      "reflect friction-review: STALE — newest report is 2026-09-03, 17 days old; the producer has " +
        "stopped, so republishing will not help. Check the row with `slopweaver automation due`",
    );
  });
});
