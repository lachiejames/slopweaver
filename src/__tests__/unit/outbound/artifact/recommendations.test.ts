/**
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */

import { describe, expect, it } from "vitest";

import { alertSummaryFormSchema, alertSummaryToUpdate } from "../../../../outbound/artifact/alertSummary.js";
import { digestFormSchema, digestToUpdate } from "../../../../outbound/artifact/digest.js";
import {
  OPPORTUNITY_MARKER,
  RAISED_PR_LABEL,
  RECOMMENDATION_CHANGE_MAX,
  RECOMMENDATION_OWNER_MAX,
  RECOMMENDATION_TARGET_MAX,
  RECOMMENDATIONS_HEADING,
  RECOMMENDATIONS_MAX,
  type RecommendationForm,
  recommendationAuthorSchema,
  recommendationCitations,
  recommendationFormSchema,
  recommendationLine,
  recommendationsBlock,
  withRecommendations,
} from "../../../../outbound/artifact/recommendations.js";
import { updateArtifactFitsUntruncated, updateArtifactSchema } from "../../../../outbound/artifact/schema.js";
import type { Citation } from "../../../../outbound/artifact/types.js";
import { visibleLengthOfDetail, visibleLengthOfRuns } from "../../../../outbound/artifact/visibleLength.js";
import { BULLET_ITEM_VISIBLE_MAX } from "../../../../outbound/assistant/contentLimits.js";

/** The widest recommendation every cap admits — what the file's arithmetic is stated against. */
function widest(over: Partial<RecommendationForm> = {}): RecommendationForm {
  return {
    act: "change-config",
    change: "c".repeat(RECOMMENDATION_CHANGE_MAX),
    evidenceUrl: "https://example.com/evidence",
    finding: "red",
    owner: "o".repeat(RECOMMENDATION_OWNER_MAX),
    target: "t".repeat(RECOMMENDATION_TARGET_MAX),
    ...over,
  };
}

/** A chip four characters wide, which is the widest a card can hand a recommendation. */
const WIDE_CHIP: readonly Citation[] = [{ id: "c10", label: "[10]", url: "https://example.com/finding" }];

describe("a recommendation line", () => {
  it("is exactly the per-item cap at its widest, so nothing is ever trimmed", () => {
    const runs = recommendationLine({ citationId: "c10", recommendation: widest() });

    expect(visibleLengthOfRuns({ citations: WIDE_CHIP, runs })).toBe(BULLET_ITEM_VISIBLE_MAX);
    expect(visibleLengthOfRuns({ citations: WIDE_CHIP, runs })).toBe(200);
  });

  it("leads a finding's act with that finding's severity glyph and an opportunity with the bulb", () => {
    const act = recommendationLine({ citationId: "c10", recommendation: widest({ finding: "orange" }) });
    const opportunity = recommendationLine({
      citationId: "c10",
      recommendation: widest({ change: "publish the NZ heartbeat", finding: undefined }),
    });

    expect(act[0]).toEqual({ text: `🟠 Change config: ${"c".repeat(RECOMMENDATION_CHANGE_MAX)}`, type: "text" });
    expect(opportunity[0]).toEqual({
      text: `${OPPORTUNITY_MARKER} Change config: publish the NZ heartbeat`,
      type: "text",
    });
  });

  it("renders the target as a code run, which the raw-markup conversion leaves alone", () => {
    const runs = recommendationLine({
      citationId: "c1",
      recommendation: widest({ target: "acme-admin apps/ops/datadog/index.ts" }),
    });

    expect(runs[1]).toEqual({ text: " · ", type: "text" });
    expect(runs[2]).toEqual({ code: true, text: "acme-admin apps/ops/datadog/index.ts", type: "text" });
  });

  it("ends every line in a citation chip, so no recommendation is uncited", () => {
    const runs = recommendationLine({ citationId: "r1", recommendation: widest({ owner: undefined }) });

    expect(runs.at(-1)).toEqual({ citationId: "r1", type: "citation" });
  });
});

describe("a recommendation the bot has already raised a pull request for", () => {
  /** The pull request the bot raised, distinct from the evidence the recommendation stands on. */
  const RAISED = "https://github.com/acme/acme-admin/pull/4821";

  it("is 195 at its widest, because the link REPLACES the act word rather than joining it", () => {
    const runs = recommendationLine({ citationId: "c10", recommendation: widest({ raisedPrUrl: RAISED }) });

    expect(visibleLengthOfRuns({ citations: WIDE_CHIP, runs })).toBe(195);
    expect(visibleLengthOfRuns({ citations: WIDE_CHIP, runs })).toBeLessThan(BULLET_ITEM_VISIBLE_MAX);
  });

  it("leads with the severity glyph, then the link, then the change — and no act word", () => {
    const runs = recommendationLine({ citationId: "c10", recommendation: widest({ raisedPrUrl: RAISED }) });

    expect(runs[0]).toEqual({ text: "🔴 ", type: "text" });
    expect(runs[1]).toEqual({ label: RAISED_PR_LABEL, type: "link", url: RAISED });
    expect(runs[2]).toEqual({ text: `: ${"c".repeat(RECOMMENDATION_CHANGE_MAX)}`, type: "text" });
    expect(JSON.stringify(runs)).not.toContain("Change config");
  });

  it("KEEPS the evidence chip, so the pull request never stands in for what justified it", () => {
    const runs = recommendationLine({ citationId: "r1", recommendation: widest({ raisedPrUrl: RAISED }) });
    const { added } = recommendationCitations({ existing: [], recommendations: [widest({ raisedPrUrl: RAISED })] });

    expect(runs.at(-1)).toEqual({ citationId: "r1", type: "citation" });
    expect(added).toEqual([{ id: "r1", label: "[1]", url: "https://example.com/evidence" }]);
  });

  it("keeps the target and the owner, which a second chip would have had to spend", () => {
    const runs = recommendationLine({ citationId: "c10", recommendation: widest({ raisedPrUrl: RAISED }) });

    expect(runs[4]).toEqual({ code: true, text: "t".repeat(RECOMMENDATION_TARGET_MAX), type: "text" });
    expect(runs[5]).toEqual({ text: ` · ${"o".repeat(RECOMMENDATION_OWNER_MAX)}`, type: "text" });
  });

  it("reaches a real card unchanged, with nothing truncated", () => {
    const form = {
      kind: "alert-summary" as const,
      label: "alerts-service-p1",
      recommendations: [widest({ raisedPrUrl: RAISED })],
      rows: [{ citationUrl: "https://ap1.datadoghq.com/monitors/1", count: 3, label: "m", severity: "red" as const }],
      skipped: 0,
      window: "24h",
    };

    expect(alertSummaryFormSchema.safeParse(form).success).toBe(true);
    const artifact = alertSummaryToUpdate({ form });
    expect(updateArtifactFitsUntruncated({ artifact })).toBe(true);
    expect(JSON.stringify(artifact.detail)).toContain(RAISED);
  });

  it("is REFUSED by both schemas when the pull request is also the evidence", () => {
    const same = { evidenceUrl: "https://example.com/evidence", raisedPrUrl: "https://example.com/evidence" };
    const card = recommendationFormSchema.safeParse(widest(same));
    const { finding: _colour, ...authored } = widest(same);
    const row = recommendationAuthorSchema.safeParse({ ...authored, clears: "webhook-failures" });

    expect(card.success).toBe(false);
    expect(JSON.stringify(card.error?.issues)).toContain("PRODUCED");
    expect(row.success).toBe(false);
  });
});

describe("the recommendation schemas", () => {
  it("refuses markup the card would turn into a ping, a broadcast, a link or a chip", () => {
    const refused = [
      "please ask <@U123>",
      "tell <!here> about it",
      "see [2] above",
      "https://example.com/fix",
      "@seth",
    ];

    expect(refused.filter((change) => recommendationFormSchema.safeParse(widest({ change })).success)).toEqual([]);
  });

  it("refuses every scheme the card's own converter would linkify, mailto included", () => {
    // Regression: the first version matched `https?://` with its own regex and missed `mailto:`, which
    // `typedRuns.ts` converts too, so an authored address rendered as a real link on a card that sent clean.
    const mailto = "email mailto:payments-oncall for the runbook";

    expect(recommendationFormSchema.safeParse(widest({ change: mailto })).success).toBe(false);
    // A scheme the card does NOT convert stays prose, so the schema has no business refusing it either.
    expect(
      recommendationFormSchema.safeParse(widest({ change: "the ftp://example.com/x dump is stale" })).success,
    ).toBe(true);
  });

  it("refuses a BARE REFERENCE, which the card linkifies after this schema or refuses the send over", () => {
    // Measured by an adversarial review: a bare numeric reference in `superseded by …` rendered a link into THIS repository on a
    // card about another one, and the same form with no single repo in context refused the whole send.
    const refused = ["exclude it, superseded by #4821", "reconcile the plans named in CCCC-2225"];

    expect(refused.filter((change) => recommendationFormSchema.safeParse(widest({ change })).success)).toEqual([]);
  });

  it("refuses a PR-LIST shape, where bare digits with no `#` still become links", () => {
    // Third review pass: `merged: 4821, 4822` has no `#` and no key, and `bareRefRuns.ts` linkified both
    // digits anyway. The schema asks `scanBareRefs` now rather than matching a third pattern beside it.
    const change = "clears the backlog merged: 4821, 4822 on the sentinel";

    expect(recommendationFormSchema.safeParse(widest({ change })).success).toBe(false);
  });

  it("leaves an ordinary number alone, so a monitor id and a threshold are still sayable", () => {
    const change = "delete 862992 or give it a 5-span floor: 889036 already pages on invoice.paid lag";

    expect(recommendationFormSchema.safeParse(widest({ change })).success).toBe(true);
  });

  it("still takes a ticket in `target`, which renders as code and is never converted", () => {
    expect(recommendationFormSchema.safeParse(widest({ target: "Linear CCCC-2225" })).success).toBe(true);
  });

  it("accepts ordinary prose with punctuation a monitor's own words carry", () => {
    const change = "renotify 60 → 0, add timeoutH so a stuck group stops re-posting hourly";

    expect(recommendationFormSchema.safeParse(widest({ change })).success).toBe(true);
  });

  it("keeps the two sides apart: a card carries no `clears`, and a row carries no `finding`", () => {
    const authored = { act: "raise-pr", change: "add the exclusion", evidenceUrl: "https://example.com/a" } as const;

    expect(recommendationAuthorSchema.safeParse({ ...authored, clears: "webhook-failures" }).success).toBe(true);
    expect(recommendationAuthorSchema.safeParse({ ...authored, finding: "red" }).success).toBe(false);
    expect(recommendationFormSchema.safeParse({ ...authored, clears: "webhook-failures" }).success).toBe(false);
    expect(recommendationFormSchema.safeParse({ ...authored, finding: "red" }).success).toBe(true);
  });

  it("requires the evidence, because every line on a card cites something", () => {
    const { evidenceUrl: _dropped, ...withoutEvidence } = widest();

    expect(recommendationFormSchema.safeParse(withoutEvidence).success).toBe(false);
  });
});

describe("the citations a recommendation lane declares", () => {
  it("mints `r<n>` ids, which cannot collide with a derivation's own `c<n>`", () => {
    const { added, cited } = recommendationCitations({
      existing: WIDE_CHIP,
      recommendations: [widest({ evidenceUrl: "https://example.com/one" })],
    });

    expect(added).toEqual([{ id: "r1", label: "[2]", url: "https://example.com/one" }]);
    expect(cited.map((entry) => entry.citationId)).toEqual(["r1"]);
  });

  it("REUSES the card's own citation when the evidence is the link the finding already cites", () => {
    const { added, cited } = recommendationCitations({
      existing: WIDE_CHIP,
      recommendations: [widest({ evidenceUrl: "https://example.com/finding" })],
    });

    expect(added).toEqual([]);
    expect(cited.map((entry) => entry.citationId)).toEqual(["c10"]);
  });

  it("costs one citation for two recommendations standing on the same evidence", () => {
    const { added, cited } = recommendationCitations({
      existing: [],
      recommendations: [widest({ evidenceUrl: "https://example.com/same" }), widest({ change: "a second act" })],
    });

    expect(added.map((citation) => citation.url)).toEqual(["https://example.com/same", "https://example.com/evidence"]);
    expect(cited.map((entry) => entry.citationId)).toEqual(["r1", "r2"]);
  });
});

describe("the blocks the lane derives", () => {
  it("derives nothing at all when a card turned the lane off", () => {
    expect(recommendationsBlock({ cited: [] })).toEqual([]);
    expect(withRecommendations({ citations: [], detail: [{ runs: [], type: "paragraph" }] })).toEqual({
      citations: [],
      detail: [{ runs: [], type: "paragraph" }],
    });
  });

  it("opens with the bold heading and then one list line per recommendation", () => {
    const { cited } = recommendationCitations({ existing: [], recommendations: [widest()] });
    const blocks = recommendationsBlock({ cited });

    expect(blocks[0]).toEqual({
      runs: [{ bold: true, text: RECOMMENDATIONS_HEADING, type: "text" }],
      type: "paragraph",
    });
    expect(blocks[1]?.type).toBe("list");
  });

  it("costs 1015 visible characters at its widest — five lines plus the heading, inside the 1800 detail cap", () => {
    const five = Array.from({ length: RECOMMENDATIONS_MAX }, (_unused, position) =>
      widest({ evidenceUrl: `https://example.com/${String(position)}` }),
    );
    const { added, cited } = recommendationCitations({ existing: [], recommendations: five });

    expect(visibleLengthOfDetail({ citations: added, detail: recommendationsBlock({ cited }) })).toBe(1015);
  });

  it("puts the lane FIRST, so the reader meets it directly below the fold", () => {
    const table = { columns: ["a"], rows: [], type: "table" } as const;
    const combined = withRecommendations({ citations: [], detail: [table], recommendations: [widest()] });

    expect(combined.detail[0]?.type).toBe("paragraph");
    expect(combined.detail[1]?.type).toBe("list");
    expect(combined.detail[2]).toEqual(table);
    expect(combined.citations).toEqual([{ id: "r1", label: "[1]", url: "https://example.com/evidence" }]);
  });
});

describe("a card carrying the lane", () => {
  it("sends a digest with five maximal recommendations on a quiet day, with nothing truncated", () => {
    const form = {
      items: [{ count: 3, severity: "red" as const, title: "webhook failures" }],
      kind: "digest" as const,
      label: "Payments",
      recommendations: Array.from({ length: RECOMMENDATIONS_MAX }, (_unused, position) =>
        widest({ evidenceUrl: `https://example.com/${String(position)}` }),
      ),
      window: "24h",
    };

    expect(digestFormSchema.safeParse(form).success).toBe(true);
    const { artifact } = digestToUpdate({ form, isKnownPerson: () => false });
    expect(artifact.detail[0]).toEqual({
      runs: [{ bold: true, text: RECOMMENDATIONS_HEADING, type: "text" }],
      type: "paragraph",
    });
    expect(updateArtifactSchema.safeParse(artifact).success).toBe(true);
    expect(updateArtifactFitsUntruncated({ artifact })).toBe(true);
  });

  it("sends a ten-row alert summary carrying five maximal recommendations", () => {
    const form = {
      kind: "alert-summary" as const,
      label: "alerts-service-p1",
      recommendations: Array.from({ length: RECOMMENDATIONS_MAX }, (_unused, position) =>
        widest({ evidenceUrl: `https://example.com/${String(position)}` }),
      ),
      rows: Array.from({ length: 10 }, (_unused, position) => ({
        citationUrl: `https://ap1.datadoghq.com/monitors/${String(position)}`,
        count: 10 - position,
        label: `monitor ${String(position)}`,
        severity: "red" as const,
      })),
      skipped: 4,
      window: "7d",
    };

    expect(alertSummaryFormSchema.safeParse(form).success).toBe(true);
    const artifact = alertSummaryToUpdate({ form });
    expect(artifact.detail[0]).toEqual({
      runs: [{ bold: true, text: RECOMMENDATIONS_HEADING, type: "text" }],
      type: "paragraph",
    });
    expect(updateArtifactFitsUntruncated({ artifact })).toBe(true);
  });

  it("refuses a digest whose items and recommendations together overflow the detail cap", () => {
    const form = {
      items: Array.from({ length: 4 }, (_unused, position) => ({
        count: 5,
        severity: "red" as const,
        substance: "s".repeat(400),
        title: `item ${String(position)}`,
      })),
      kind: "digest" as const,
      label: "Payments",
      recommendations: Array.from({ length: RECOMMENDATIONS_MAX }, (_unused, position) =>
        widest({ evidenceUrl: `https://example.com/${String(position)}` }),
      ),
      window: "24h",
    };

    const refused = digestFormSchema.safeParse(form);
    expect(refused.success).toBe(false);
    expect(JSON.stringify(refused.error?.issues)).toContain("recommendations");
  });
});
