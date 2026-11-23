import { describe, expect, it } from "vitest";
import { absenceBounded } from "../../../../review/absenceBounded.js";
import { coverage, NOW } from "./fixtures.js";

describe("absenceBounded", () => {
  it("refuses an absence when only the live leg ran, because Slack collapses proximate matches", () => {
    const bound = absenceBounded({
      coverage: coverage({ liveRan: true }),
      liveFoundBeyondCorpus: false,
      prUpdatedAtIso: NOW,
    });
    expect(bound.bounded).toBe(false);
    expect(bound.why).toContain("only the corpus can carry an absence");
  });

  it("accepts an absence when the corpus reaches past the pull request's own last activity", () => {
    const bound = absenceBounded({
      coverage: coverage(),
      liveFoundBeyondCorpus: false,
      prUpdatedAtIso: "2026-08-20T00:00:00Z",
    });
    expect(bound).toEqual({ bounded: true, why: "" });
  });

  it("refuses an absence when the corpus ends before the pull request was last active", () => {
    const bound = absenceBounded({ coverage: coverage(), liveFoundBeyondCorpus: false, prUpdatedAtIso: NOW });
    expect(bound.bounded).toBe(false);
    expect(bound.why).toContain("the Slack corpus ends 2026-08-29T10:47:20.000Z");
    expect(bound.staleThroughIso).toBe("2026-08-29T10:47:20.000Z");
  });

  it("reads one instant written with and without milliseconds as the corpus reaching it", () => {
    const bound = absenceBounded({
      coverage: coverage({ corpusThroughIso: "2026-08-20T00:00:00.000Z" }),
      liveFoundBeyondCorpus: false,
      prUpdatedAtIso: "2026-08-20T00:00:00Z",
    });
    expect(bound).toEqual({ bounded: true, why: "" });
  });

  it("refuses an absence over a watermark that is not an instant, and never calls the corpus behind", () => {
    const bound = absenceBounded({
      coverage: coverage({ corpusThroughIso: "not-a-date" }),
      liveFoundBeyondCorpus: false,
      prUpdatedAtIso: "2026-09-25T12:00:00Z",
    });
    expect(bound).toEqual({
      bounded: false,
      why: 'the Slack corpus watermark "not-a-date" is not an instant, so nothing here can carry an absence',
    });
  });

  it("reads an activity with no zone as not an instant, never as the host's local time", () => {
    const bound = absenceBounded({
      coverage: coverage({ corpusThroughIso: "2026-09-25T00:00:00.000Z" }),
      liveFoundBeyondCorpus: false,
      prUpdatedAtIso: "2026-09-25T12:00:00",
    });
    expect([bound.bounded, "staleThroughIso" in bound]).toStrictEqual([false, false]);
  });

  it("reads a watermark on a day no calendar has as not an instant, never rolled into the next month", () => {
    const bound = absenceBounded({
      coverage: coverage({ corpusThroughIso: "2026-02-30T00:00:00.000Z" }),
      liveFoundBeyondCorpus: true,
      prUpdatedAtIso: "2026-09-25T12:00:00Z",
    });
    expect(bound).toEqual({
      bounded: false,
      why: 'the Slack corpus watermark "2026-02-30T00:00:00.000Z" is not an instant, so nothing here can carry an absence',
    });
  });

  it("refuses an absence when a live match postdates the watermark, whatever the watermark says", () => {
    const bound = absenceBounded({
      coverage: coverage(),
      liveFoundBeyondCorpus: true,
      prUpdatedAtIso: "2026-08-20T00:00:00Z",
    });
    expect(bound.bounded).toBe(false);
    expect(bound.why).toContain("proves the exhaustive leg is behind");
    expect(bound.staleThroughIso).toBe("2026-08-29T10:47:20.000Z");
  });

  it("dates an offset-bearing watermark by its instant in UTC, never by its local clock fields", () => {
    const bound = absenceBounded({
      coverage: coverage({ corpusThroughIso: "2026-09-25T00:30:00+10:00" }),
      liveFoundBeyondCorpus: false,
      prUpdatedAtIso: "2026-09-24T15:00:00Z",
    });
    expect([bound.bounded, bound.staleThroughIso]).toStrictEqual([false, "2026-09-24T14:30:00.000Z"]);
  });

  it("still dates the corpus behind when a live match proves it, even over an activity that is not an instant", () => {
    const bound = absenceBounded({
      coverage: coverage(),
      liveFoundBeyondCorpus: true,
      prUpdatedAtIso: "not-a-date",
    });
    expect([bound.bounded, bound.staleThroughIso]).toStrictEqual([false, "2026-08-29T10:47:20.000Z"]);
  });

  it("refuses an absence when the corpus was never ingested at all", () => {
    const bound = absenceBounded({
      coverage: coverage({ corpusThroughIso: undefined }),
      liveFoundBeyondCorpus: false,
      prUpdatedAtIso: NOW,
    });
    expect(bound).toEqual({
      bounded: false,
      why: "the Slack corpus has never been ingested, so nothing here can carry an absence",
    });
  });
});
