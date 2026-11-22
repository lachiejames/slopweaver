/**
 * What `profile voice measure` prints: the headline per outcome, the cohort lines, and the left-out counts — and
 * the usage text naming the measure subverb.
 */
import { describe, expect, it } from "vitest";

import { measurementHeadline, measurementLines } from "../../../../../cli/commands/profile/voiceRun.js";
import { PROFILE_VOICE_USAGE } from "../../../../../cli/commands/profile/voiceUsage.js";
import type { SlackVoiceMeasurement } from "../../../../../profile/voiceMeasure.js";

const MEASUREMENT: SlackVoiceMeasurement = {
  cohorts: [
    {
      ceilingWords: null,
      cohort: "all-sent",
      measuredAt: "2026-11-05T00:00:00.000Z",
      medianWords: 9,
      p75Words: 18,
      p90Words: 33,
      qualification: "fixture",
      sampleCount: 40,
      source: "fixture",
      surface: "slack",
    },
  ],
  counts: {
    eligibleAllSent: 40,
    eligibleDm: 12,
    excludedAppBotId: 3,
    excludedAppId: 1,
    excludedBroadcastCopy: 2,
    excludedNoProseWords: 4,
    excludedNoRawText: 5,
    excludedSubtype: 6,
    ownerMessageVersions: 61,
    supersededVersions: 7,
  },
};

describe("measurementLines", () => {
  it("prints one line per cohort, then what was counted and what was left out", () => {
    expect(measurementLines({ measurement: MEASUREMENT })).toStrictEqual([
      "  slack/all-sent: median 9, p75 18, p90 33, n=40 (measured 2026-11-05)",
      "  from 61 message version(s) authored as them (7 superseded by a later edit)",
      "  left out: 3 app-posted (bot_id), 1 app-posted (app_id), 2 broadcast copy, 6 system subtype, 5 no text, 4 no words",
    ]);
  });
});

describe("measurementHeadline", () => {
  it("says a written measurement refreshed the context cache", () => {
    expect(
      measurementHeadline({ outcome: { filesRead: 4, kind: "written", measurement: MEASUREMENT, notRead: [] } }),
    ).toBe("profile voice measure: 1 cohort(s) written from 4 Slack file(s); context cache refreshed");
  });

  it("says a dry run wrote nothing", () => {
    expect(
      measurementHeadline({ outcome: { filesRead: 2, kind: "dry-run", measurement: MEASUREMENT, notRead: [] } }),
    ).toBe("profile voice measure (dry run): 1 cohort(s) measured from 2 Slack file(s); nothing written");
  });

  it("carries the no-store reason", () => {
    expect(
      measurementHeadline({
        outcome: { kind: "no-store", measurement: MEASUREMENT, message: "no store selected", notRead: [] },
      }),
    ).toBe("profile voice measure: 1 cohort(s) measured; nothing written — no store selected");
  });
});

describe("PROFILE_VOICE_USAGE", () => {
  it("names all three shapes and the measure exit codes", () => {
    expect(PROFILE_VOICE_USAGE).toContain("slopweaver profile voice measure [--dry-run] [--json] [--home <dir>]");
    expect(PROFILE_VOICE_USAGE).toContain("measure exits 0 when it measured, 3 when there was nothing to measure");
  });
});
