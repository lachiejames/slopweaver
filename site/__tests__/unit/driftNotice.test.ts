/*
 * The drift notice the page posts is read strictly: every field present and bounded, minutes a whole number in range,
 * and anything else is no notice at all.
 */
import { describe, expect, it } from "vitest";

import {
  boundedDriftField,
  DRIFT_APP_MAX_CHARS,
  DRIFT_MAX_MINUTES,
  DRIFT_PLAN_MAX_CHARS,
  driftNoticeOf,
} from "../../lib/driftNotice";

const POSTED = { app: "Slack", minutes: 4, noticeId: "drift-1", plan: "do the ISO access review" };

describe("boundedDriftField", () => {
  it("drops control characters, collapses whitespace and caps the text", () => {
    expect(boundedDriftField({ maxChars: 12, value: "  Google\u0007 \n Chrome  canary " })).toBe("Google Chrom");
  });

  it("takes no field that is not a string, or is empty once cleaned", () => {
    expect([
      boundedDriftField({ maxChars: 10, value: 7 }),
      boundedDriftField({ maxChars: 10, value: " \n\t " }),
      boundedDriftField({ maxChars: 10, value: undefined }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe("driftNoticeOf", () => {
  it("reads a well-formed post as the notice, with nothing else carried", () => {
    expect(driftNoticeOf({ value: { ...POSTED, title: "Q4 offsite – Slack" } })).toEqual(POSTED);
  });

  it("caps the plan and the application name a page could post long", () => {
    const notice = driftNoticeOf({ value: { ...POSTED, app: "a".repeat(200), plan: "p".repeat(200) } })!;
    expect([notice.app.length, notice.plan.length]).toEqual([DRIFT_APP_MAX_CHARS, DRIFT_PLAN_MAX_CHARS]);
  });

  it("refuses a post missing a field, or with minutes that are not a whole number in range", () => {
    expect([
      driftNoticeOf({ value: { ...POSTED, noticeId: "" } }),
      driftNoticeOf({ value: { ...POSTED, app: undefined } }),
      driftNoticeOf({ value: { ...POSTED, minutes: 0 } }),
      driftNoticeOf({ value: { ...POSTED, minutes: 3.5 } }),
      driftNoticeOf({ value: { ...POSTED, minutes: "4" } }),
      driftNoticeOf({ value: { ...POSTED, minutes: DRIFT_MAX_MINUTES + 1 } }),
      driftNoticeOf({ value: "Slack" }),
      driftNoticeOf({ value: null }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("takes minutes at the top of the range", () => {
    expect(driftNoticeOf({ value: { ...POSTED, minutes: DRIFT_MAX_MINUTES } })).toEqual({
      ...POSTED,
      minutes: DRIFT_MAX_MINUTES,
    });
  });
});
