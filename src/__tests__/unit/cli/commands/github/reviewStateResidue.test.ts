/**
 * `review-state`'s residue lines: the base residue keeps the coverage's own lines first and adds the
 * truncation and search-ceiling sentences only past their boundaries; the Slack residue always states corpus
 * freshness, private-surface invisibility and the collapse caveat, and adds the skipped-leg line only when
 * the live leg did not run.
 */
import { describe, expect, it } from "vitest";

import { baseResidue, slackResidue } from "../../../../../cli/commands/github/reviewStateResidue.js";
import type { NeighbourhoodWindow, SlackCoverage } from "../../../../../review/slackEvidenceTypes.js";

const coverage = ({ residue }: { residue: readonly string[] }): SlackCoverage => ({
  corpusThroughIso: "2026-09-01T00:00:00.000Z",
  liveRan: true,
  neighbourhoods: [],
  residue,
  shareThreads: {},
});

const TRUNCATED = "21 pull requests matched and 20 were read — raise --limit to see the rest";
const PRIVATE = "a direct message or private channel the owner's own token cannot read is invisible to both Slack legs";
const COLLAPSE_NONE =
  "Slack's search collapses matches that sit close together in one thread, so the live leg can only ever confirm an ask, never rule one out";
const SKIPPED =
  "the live Slack search leg was skipped (--no-slack-live), so nothing posted since the watermark was seen beyond the thread under each channel post of the owner's";

describe("baseResidue", () => {
  it("keeps the coverage's own lines first and adds nothing when every match was read", () => {
    expect(baseResidue({ coverage: coverage({ residue: ["first", "second"] }), limit: 20, total: 20 })).toEqual([
      "first",
      "second",
    ]);
  });

  it("adds the truncation sentence at one past the limit, and not at the limit itself", () => {
    const base = coverage({ residue: ["first"] });
    expect(baseResidue({ coverage: base, limit: 20, total: 20 })).toEqual(["first"]);
    expect(baseResidue({ coverage: base, limit: 20, total: 21 })).toEqual(["first", TRUNCATED]);
  });

  it("adds GitHub's 1000 search-ceiling sentence at 1001 and not at 1000", () => {
    const base = coverage({ residue: [] });
    expect(baseResidue({ coverage: base, limit: 1000, total: 1000 })).toEqual([]);
    expect(baseResidue({ coverage: base, limit: 1001, total: 1001 })).toEqual([
      "GitHub's own search caps a result set at 1000, so the match count itself is a floor",
    ]);
  });

  it("adds both sentences, truncation first, when the match count passes both boundaries", () => {
    expect(baseResidue({ coverage: coverage({ residue: [] }), limit: 50, total: 1001 })).toEqual([
      "1001 pull requests matched and 50 were read — raise --limit to see the rest",
      "GitHub's own search caps a result set at 1000, so the match count itself is a floor",
    ]);
  });

  it("returns a fresh array rather than the coverage's own residue", () => {
    const residue = ["first"];
    const lines = baseResidue({ coverage: coverage({ residue }), limit: 1, total: 2 });
    expect(lines).toEqual(["first", "2 pull requests matched and 1 were read — raise --limit to see the rest"]);
    expect(residue).toEqual(["first"]);
  });
});

describe("slackResidue", () => {
  it("says the corpus was never ingested when there is no watermark", () => {
    expect(
      slackResidue({ corpusThroughIso: undefined, liveRan: true, neighbourhoods: [], nowIso: "2026-09-01T02:00:00Z" }),
    ).toEqual([
      "the Slack corpus has never been ingested, so NO row here can report `no` — run `slopweaver refresh --source slack`",
      PRIVATE,
      COLLAPSE_NONE,
    ]);
  });

  it("states the watermark and how many hours it is behind the read", () => {
    expect(
      slackResidue({
        corpusThroughIso: "2026-09-01T00:00:00Z",
        liveRan: true,
        neighbourhoods: [],
        nowIso: "2026-09-01T02:00:00Z",
      }),
    ).toEqual([
      "only the Slack corpus can decide a `no`, and it reaches 2026-09-01T00:00:00Z — 2h behind this read. Anything asked inside that gap reads as `unknown`; `slopweaver refresh --source slack` closes it",
      PRIVATE,
      COLLAPSE_NONE,
    ]);
  });

  it("clamps a watermark later than the read to 0h behind", () => {
    expect(
      slackResidue({
        corpusThroughIso: "2026-09-01T05:00:00Z",
        liveRan: true,
        neighbourhoods: [],
        nowIso: "2026-09-01T02:00:00Z",
      })[0],
    ).toBe(
      "only the Slack corpus can decide a `no`, and it reaches 2026-09-01T05:00:00Z — 0h behind this read. Anything asked inside that gap reads as `unknown`; `slopweaver refresh --source slack` closes it",
    );
  });

  it("names every conversation read around a hit, in order, instead of the standing collapse caveat", () => {
    const neighbourhoods: readonly NeighbourhoodWindow[] = [
      { channelId: "C111", fromIso: "2026-09-01T00:00:00Z", throughIso: "2026-09-01T02:00:00Z" },
      { channelId: "C222", fromIso: "2026-09-01T00:00:00Z", throughIso: "2026-09-01T02:00:00Z" },
    ];
    expect(
      slackResidue({ corpusThroughIso: undefined, liveRan: true, neighbourhoods, nowIso: "2026-09-01T02:00:00Z" })[2],
    ).toBe(
      "Slack's search collapses matches that sit close together in one thread, so the live leg can only ever confirm an ask — except in the 2 conversation(s) read around a hit since the watermark, which were read exhaustively: C111 C222",
    );
  });

  it("adds the skipped-leg line last when the live leg did not run, and not when it did", () => {
    const args = { corpusThroughIso: undefined, neighbourhoods: [], nowIso: "2026-09-01T02:00:00Z" };
    const never =
      "the Slack corpus has never been ingested, so NO row here can report `no` — run `slopweaver refresh --source slack`";
    expect(slackResidue({ ...args, liveRan: true })).toEqual([never, PRIVATE, COLLAPSE_NONE]);
    expect(slackResidue({ ...args, liveRan: false })).toEqual([never, PRIVATE, COLLAPSE_NONE, SKIPPED]);
  });
});
