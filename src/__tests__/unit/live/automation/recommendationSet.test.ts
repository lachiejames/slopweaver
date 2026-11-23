/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  type FiredFinding,
  parseRecommendationSet,
  RECOMMENDATION_SET_MAX,
  RecommendationSetErrors,
  recommendationSelectionLines,
  recommendationsDocumentOf,
  recommendationsFlagArgs,
  selectRecommendations,
  shedToFit,
} from "../../../../live/automation/recommendationSet.js";
import type { RecommendationAuthored } from "../../../../outbound/artifact/recommendations.js";

/** One authored recommendation. `clears` absent is an opportunity, which is the field that decides. */
function authored(over: Partial<RecommendationAuthored> = {}): RecommendationAuthored {
  return {
    act: "tune-monitor",
    change: "renotify 60 to 0 so a stuck group stops re-posting hourly",
    evidenceUrl: "https://ap1.datadoghq.com/monitors/700001",
    ...over,
  };
}

const FIRED: readonly FiredFinding[] = [
  { key: "webhook-failures", severity: "red" },
  { key: "checkout-latency", severity: "orange" },
];

describe("parsing an authored set", () => {
  it("accepts the document a row carries and keeps every field", () => {
    const set = unwrap(parseRecommendationSet({ value: { recommendations: [authored({ clears: "a" })] } }));

    expect(set.recommendations).toEqual([authored({ clears: "a" })]);
  });

  it("names the field and the reason when a recommendation is not one", () => {
    const failure = unwrapErr(
      parseRecommendationSet({ value: { recommendations: [{ act: "raise-a-pr", change: "x" }] } }),
    );

    expect(failure.code).toBe("RECOMMENDATION_SET_INVALID");
    expect(failure.message).toContain("recommendations.0.act");
  });

  it("refuses a document that is not a set at all, naming the field that is missing", () => {
    const failure = unwrapErr(parseRecommendationSet({ value: { recommendation: [] } }));

    expect(failure.code).toBe("RECOMMENDATION_SET_INVALID");
  });

  it("refuses more than a row may declare", () => {
    const many = Array.from({ length: RECOMMENDATION_SET_MAX + 1 }, () => authored());

    expect(unwrapErr(parseRecommendationSet({ value: { recommendations: many } })).code).toBe(
      "RECOMMENDATION_SET_INVALID",
    );
  });

  it("tells a TYPO apart from a monitor that was simply quiet, where the vocabulary is closed", () => {
    const selection = selectRecommendations({
      authored: [
        authored({ change: "a typo", clears: "webhok-failures" }),
        authored({ change: "quiet", clears: "checkout-latency" }),
      ],
      fired: [{ key: "webhook-failures", severity: "red" }],
      known: ["webhook-failures", "checkout-latency"],
    });

    expect(selection.dropped).toEqual([
      { change: "a typo", clears: "webhok-failures", reason: "clears-unknown" },
      { change: "quiet", clears: "checkout-latency", reason: "not-fired-this-window" },
    ]);
  });

  it("calls an unmatched key NOT-FIRED where the vocabulary is open, because a typo cannot be told apart", () => {
    const selection = selectRecommendations({
      authored: [authored({ change: "a typo", clears: "webhok-failures" })],
      fired: [{ key: "webhook-failures", severity: "red" }],
    });

    expect(selection.dropped).toEqual([
      { change: "a typo", clears: "webhok-failures", reason: "not-fired-this-window" },
    ]);
  });
});

describe("selecting what reaches today's card", () => {
  it("keeps an act whose finding fired, and colours it with that finding's severity", () => {
    const selection = selectRecommendations({
      authored: [authored({ clears: "checkout-latency" })],
      fired: FIRED,
    });

    expect(selection.kept).toEqual([{ ...authored(), finding: "orange" }]);
    expect(selection.dropped).toEqual([]);
  });

  it("drops an act whose finding did NOT fire, and says so rather than silently", () => {
    const selection = selectRecommendations({ authored: [authored({ clears: "quiet-monitor" })], fired: FIRED });

    expect(selection.kept).toEqual([]);
    expect(selection.dropped).toEqual([
      { change: authored().change, clears: "quiet-monitor", reason: "not-fired-this-window" },
    ]);
  });

  it("orders acts by their finding's RANK, not by the order they were authored in", () => {
    const selection = selectRecommendations({
      authored: [
        authored({ change: "second finding", clears: "checkout-latency" }),
        authored({ change: "first finding", clears: "webhook-failures" }),
      ],
      fired: FIRED,
    });

    expect(selection.kept.map((recommendation) => recommendation.change)).toEqual(["first finding", "second finding"]);
  });

  it("keeps two acts on one finding in the order they were authored", () => {
    const selection = selectRecommendations({
      authored: [
        authored({ change: "act one", clears: "webhook-failures" }),
        authored({ change: "act two", clears: "webhook-failures" }),
      ],
      fired: FIRED,
    });

    expect(selection.kept.map((recommendation) => recommendation.change)).toEqual(["act one", "act two"]);
  });

  it("puts opportunities after the acts, and carries no severity on one", () => {
    const selection = selectRecommendations({
      authored: [authored({ change: "an opportunity" }), authored({ change: "an act", clears: "webhook-failures" })],
      fired: FIRED,
    });

    expect(selection.kept).toEqual([
      { ...authored({ change: "an act" }), finding: "red" },
      authored({ change: "an opportunity" }),
    ]);
  });

  it("keeps at most two opportunities, and reports the third as over the cap", () => {
    const selection = selectRecommendations({
      authored: [1, 2, 3].map((n) => authored({ change: `opportunity ${String(n)}` })),
      fired: FIRED,
    });

    expect(selection.kept.map((recommendation) => recommendation.change)).toEqual(["opportunity 1", "opportunity 2"]);
    expect(selection.dropped).toEqual([{ change: "opportunity 3", reason: "over-cap" }]);
  });

  it("HOLDS one place for an opportunity when the day fires more acts than the card can carry", () => {
    const fired: readonly FiredFinding[] = [1, 2, 3, 4, 5].map((n) => ({
      key: `finding-${String(n)}`,
      severity: "red" as const,
    }));
    const selection = selectRecommendations({
      authored: [
        ...[1, 2, 3, 4, 5].map((n) => authored({ change: `act ${String(n)}`, clears: `finding-${String(n)}` })),
        authored({ change: "an opportunity" }),
      ],
      fired,
    });

    expect(selection.kept.map((recommendation) => recommendation.change)).toEqual([
      "act 1",
      "act 2",
      "act 3",
      "act 4",
      "an opportunity",
    ]);
    expect(selection.dropped).toEqual([{ change: "act 5", clears: "finding-5", reason: "over-cap" }]);
  });

  it("keeps nothing at all when the row authored nothing", () => {
    expect(selectRecommendations({ authored: [], fired: FIRED })).toEqual({ dropped: [], kept: [] });
  });
});

describe("shedding to fit", () => {
  it("keeps everything when the card already fits", () => {
    const selection = selectRecommendations({ authored: [authored({ clears: "webhook-failures" })], fired: FIRED });
    const shed = shedToFit({ fits: () => true, selection });

    expect(shed).toEqual(selection);
  });

  it("drops from the TAIL until the card fits, and reports each shed line", () => {
    const selection = selectRecommendations({
      authored: [
        authored({ change: "act one", clears: "webhook-failures" }),
        authored({ change: "act two", clears: "checkout-latency" }),
      ],
      fired: FIRED,
    });
    const shed = shedToFit({ fits: (kept) => kept.length <= 1, selection });

    expect(shed.kept.map((recommendation) => recommendation.change)).toEqual(["act one"]);
    expect(shed.dropped).toEqual([{ change: "act two", reason: "shed-to-fit" }]);
  });

  it("sheds every line rather than changing whether a card the counts alone would refuse still sends", () => {
    const selection = selectRecommendations({ authored: [authored({ clears: "webhook-failures" })], fired: FIRED });
    const shed = shedToFit({ fits: () => false, selection });

    expect(shed.kept).toEqual([]);
    expect(shed.dropped).toEqual([{ change: authored().change, reason: "shed-to-fit" }]);
  });
});

describe("what a row and a report carry", () => {
  it("re-serialises a row's own array as the one argv word the read leg takes", () => {
    const lane = recommendationsDocumentOf({ value: [authored({ clears: "webhook-failures" })] });

    expect(lane.document).toBe(JSON.stringify({ recommendations: [authored({ clears: "webhook-failures" })] }));
    expect(lane.problem).toBeUndefined();
    expect(recommendationsFlagArgs({ document: lane.document })).toEqual(["--recommendations", lane.document]);
  });

  it("leaves a row that never turned the lane on with exactly the argv it always had", () => {
    const lane = recommendationsDocumentOf({ value: undefined });

    expect(lane).toEqual({ document: undefined, problem: undefined });
    expect(recommendationsFlagArgs({ document: undefined })).toEqual([]);
  });

  it("turns the LANE off and states why when a row's set is malformed — never the row, which still posts", () => {
    const lane = recommendationsDocumentOf({ value: [{ act: "raise-pr" }] });

    expect(lane.document).toBeUndefined();
    expect(lane.problem).toContain("recommendations lane OFF");
    expect(lane.problem).toContain("recommendations.0.change");
  });

  it("turns the lane off on an EMPTY array too, which a row can easily leave behind", () => {
    expect(recommendationsDocumentOf({ value: [] }).document).toBeUndefined();
  });

  it("reports what reached the card and every line that did not, with its reason", () => {
    const selection = selectRecommendations({
      authored: [
        authored({ change: "act one", clears: "webhook-failures" }),
        authored({ change: "never", clears: "x" }),
      ],
      fired: FIRED,
    });

    expect(recommendationSelectionLines({ selection })).toEqual([
      "",
      "recommendations: 1 on the card, 1 left off",
      "  + tune-monitor: act one",
      "  - not-fired-this-window: never",
    ]);
  });

  it("says nothing at all when the lane is off, so an untouched row's report is unchanged", () => {
    expect(recommendationSelectionLines({ selection: { dropped: [], kept: [] } })).toEqual([]);
  });

  it("builds its refusals through the factory the real code calls", () => {
    expect(RecommendationSetErrors.documentUnreadable({ detail: "no such file" }).message).toContain("no such file");
  });
});

describe("the raised pull request a row writes back", () => {
  /** The draft the bot opened for the top-ranked recommendation, written onto the row afterwards. */
  const RAISED = "https://github.com/acme/acme-admin/pull/4821";

  it("reaches the card's copy, which is rebuilt field by field and would otherwise drop it", () => {
    const selection = selectRecommendations({
      authored: [authored({ clears: "webhook-failures", raisedPrUrl: RAISED })],
      fired: FIRED,
    });

    expect(selection.kept).toEqual([
      {
        act: "tune-monitor",
        change: "renotify 60 to 0 so a stuck group stops re-posting hourly",
        evidenceUrl: "https://ap1.datadoghq.com/monitors/700001",
        finding: "red",
        raisedPrUrl: RAISED,
      },
    ]);
  });

  it("survives the row's own document round trip, so a tick passes the URL on unchanged", () => {
    const lane = recommendationsDocumentOf({ value: [authored({ clears: "a", raisedPrUrl: RAISED })] });

    expect(lane.problem).toBe(undefined);
    expect(lane.document).toContain(RAISED);
  });

  it("turns the LANE off, never the card, when the row names its own evidence as the pull request", () => {
    const lane = recommendationsDocumentOf({
      value: [authored({ clears: "a", raisedPrUrl: "https://ap1.datadoghq.com/monitors/700001" })],
    });

    expect(lane.document).toBe(undefined);
    expect(lane.problem).toContain("recommendations lane OFF");
  });
});
