/**
 * The snapshot-age judge: what counts as too old to publish, and what the eyebrow says when it is.
 *
 * The defect it exists for had no test possible at all — nothing looked at the age — so these cases are
 * written against the incident's own numbers: a document taken at 23:51 rendered at 14:54 the next day.
 */
import { describe, expect, it } from "vitest";

import {
  judgeSnapshotAge,
  OPEN_PAGES_LABEL,
  SNAPSHOT_MAX_AGE_MS,
  snapshotAgeWords,
  staleSnapshotClause,
  YOUR_LIST_LABEL,
} from "../../../briefing/snapshotAge.js";

/** The render instant every case below is judged against. */
const NOW = "2026-09-21T14:54:00.000Z";

/** One judgement, with the two fields only a refusal reads held constant. */
function judge({ takenIso, nowIso = NOW }: { takenIso: string | undefined; nowIso?: string }) {
  return judgeSnapshotAge({
    flag: "--your-list",
    label: YOUR_LIST_LABEL,
    nowIso,
    source: "run.json",
    takenIso,
  });
}

describe("judgeSnapshotAge", () => {
  it("passes a document taken a minute ago", () => {
    expect(judge({ takenIso: "2026-09-21T14:53:00.000Z" })).toBe(undefined);
  });

  it("passes a document taken EXACTLY at the ceiling, so the bound is inclusive", () => {
    const atCeiling = new Date(Date.parse(NOW) - SNAPSHOT_MAX_AGE_MS).toISOString();

    expect(judge({ takenIso: atCeiling })).toBe(undefined);
  });

  it("refuses a document one millisecond past the ceiling", () => {
    const pastCeiling = new Date(Date.parse(NOW) - SNAPSHOT_MAX_AGE_MS - 1).toISOString();

    expect(judge({ takenIso: pastCeiling })!.ageMs).toBe(SNAPSHOT_MAX_AGE_MS + 1);
  });

  it("carries the whole verdict for the incident's own fifteen-hour snapshot", () => {
    const stale = judge({ takenIso: "2026-09-20T23:51:00.000Z" })!;

    expect(stale.label).toBe(YOUR_LIST_LABEL);
    expect(stale.flag).toBe("--your-list");
    expect(stale.source).toBe("run.json");
    expect(stale.takenIso).toBe("2026-09-20T23:51:00.000Z");
    expect(stale.ageMs).toBe(15 * 60 * 60 * 1000 + 3 * 60 * 1000);
  });

  it("passes an absent instant, because a snapshot nothing could date is a fact rather than a refusal", () => {
    expect(judge({ takenIso: undefined })).toBe(undefined);
  });

  it("passes an instant no clock can parse, for the same reason", () => {
    expect(judge({ takenIso: "the day before yesterday" })).toBe(undefined);
  });

  it("passes when the RENDER's own instant is the unparseable one", () => {
    expect(judge({ nowIso: "not an instant", takenIso: "2026-09-20T23:51:00.000Z" })).toBe(undefined);
  });

  it("passes a snapshot dated in the future rather than reporting a negative age", () => {
    expect(judge({ takenIso: "2026-09-22T00:00:00.000Z" })).toBe(undefined);
  });
});

describe("snapshotAgeWords", () => {
  it("writes minutes alone under an hour", () => {
    expect(snapshotAgeWords({ ageMs: 38 * 60 * 1000 })).toBe("38m");
  });

  it("writes hours and minutes above one", () => {
    expect(snapshotAgeWords({ ageMs: 15 * 60 * 60 * 1000 + 3 * 60 * 1000 })).toBe("15h 3m");
  });

  it("truncates to whole minutes rather than rounding up", () => {
    expect(snapshotAgeWords({ ageMs: 119 * 1000 })).toBe("1m");
  });

  it("answers 0m for a negative age instead of writing a minus sign onto the page", () => {
    expect(snapshotAgeWords({ ageMs: -90 * 60 * 1000 })).toBe("0m");
  });
});

describe("staleSnapshotClause", () => {
  it("names the half in the owner's own words and its age", () => {
    expect(staleSnapshotClause({ ageMs: 15 * 60 * 60 * 1000 + 3 * 60 * 1000, label: YOUR_LIST_LABEL })).toBe(
      "your list 15h 3m old",
    );
  });

  it("does the same for the open-page index", () => {
    expect(staleSnapshotClause({ ageMs: 25 * 60 * 60 * 1000, label: OPEN_PAGES_LABEL })).toBe("open pages 25h 0m old");
  });
});
