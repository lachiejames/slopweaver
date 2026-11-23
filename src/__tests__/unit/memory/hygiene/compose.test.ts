/**
 * THE CARD AND THE MORNING REPORT.
 *
 * The strongest assertion here is that the composed card PARSES against the real `updateArtifactSchema`. Rule 7
 * says the shape is enforced by the schema rather than by review, so a test checking only that the fields look
 * plausible would be the review-shaped enforcement the rule names — an `indexStyle: "ordered"` card whose lines do
 * not open with a rank glyph is refused by the form, and only the form knows that.
 *
 * Beside it: the sixth above-the-fold proposal is REFUSED rather than trimmed, and a `keep` is always green
 * because it asks the owner for nothing.
 *
 * Everything here is invented. This is a public repository, and a fixture is the easiest place for a private
 * string to arrive unnoticed.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { CHECK_GLYPH, composeHygieneCard, renderHygieneReport } from "../../../../memory/hygiene/compose.js";
import { ABOVE_FOLD_CAP, rankProposals } from "../../../../memory/hygiene/rank.js";
import {
  HYGIENE_CHECK_IDS,
  type HygieneCheckId,
  type HygieneRecommendation,
  type IndexBudget,
  type MemoryHygieneProposal,
  type MemoryHygieneReport,
} from "../../../../memory/hygiene/types.js";
import { updateArtifactSchema } from "../../../../outbound/artifact/schema.js";

/** The fixed instant every rendering is judged at. */
const NOW_ISO = "2026-09-18T08:00:00.000Z";

/** An index measurement that fits, so a case has to opt into the truncating one. */
const FITS: IndexBudget = {
  bytes: 400,
  cutAtLine: null,
  limitReached: null,
  lines: 8,
  nearLimit: false,
  pointersBelowCut: [],
};

/** One proposal, with only the fields a case varies. */
function proposalOf({
  check,
  subject,
  recommendation = "adjust",
  daysSeen = 1,
}: {
  check: HygieneCheckId;
  subject: string;
  recommendation?: HygieneRecommendation;
  daysSeen?: number;
}): MemoryHygieneProposal {
  return {
    check,
    daysSeen,
    evidence: [`evidence for ${subject}`],
    files: [subject],
    id: subject.slice(0, 12).padEnd(12, "0"),
    recommendation,
    refutations: [],
    subject,
    summary: `${check} on ${subject}`,
  };
}

/** A whole report over a given set of proposals. */
function reportOf({
  proposals,
  indexBudget = FITS,
  knowledgeRows = 7,
}: {
  proposals: readonly MemoryHygieneProposal[];
  indexBudget?: IndexBudget;
  knowledgeRows?: number | null;
}): MemoryHygieneReport {
  return {
    indexBudget,
    knowledgeRows,
    leafCount: 19,
    nowIso: NOW_ISO,
    proposals,
    residue: ["the duplicate scan never reads bodies"],
  };
}

describe("composeHygieneCard", () => {
  it("composes a card the real outbound form accepts", () => {
    const proposals = [...HYGIENE_CHECK_IDS].map((check) => proposalOf({ check, subject: `${check}.md` }));
    const ranked = rankProposals({ proposals });
    const card = unwrap(composeHygieneCard({ ranked, report: reportOf({ proposals }) }));
    expect(updateArtifactSchema.safeParse(card).success).toBe(true);
    expect(card.kind).toBe("update");
    expect(card.indexStyle).toBe("ordered");
    expect(card.index.length).toBe(ABOVE_FOLD_CAP);
  });

  it("leads with the counts the owner would otherwise add up themselves, and says nothing changed", () => {
    const proposals = [
      proposalOf({ check: "enforcement", recommendation: "drop", subject: "restates.md" }),
      proposalOf({ check: "duplicate", subject: "a.md + b.md" }),
    ];
    const ranked = rankProposals({ proposals });
    const card = unwrap(composeHygieneCard({ ranked, report: reportOf({ proposals }) }));
    expect(card.tldr).toBe("2 proposals over 19 memories, 1 of them a drop. Nothing has been changed.");
  });

  it("says how many are carried below the fold, and never how long anything will take", () => {
    const proposals = Array.from({ length: ABOVE_FOLD_CAP + 2 }, (_unused, position) =>
      proposalOf({ check: "duplicate", subject: `pair-${String(position)}.md` }),
    );
    const ranked = rankProposals({ proposals });
    const card = unwrap(composeHygieneCard({ ranked, report: reportOf({ proposals }) }));
    expect(card.tldr).toBe("7 proposals over 19 memories, 0 of them a drop, 2 more below. Nothing has been changed.");
    expect(updateArtifactSchema.safeParse(card).success).toBe(true);
  });

  it("says so plainly when there is nothing to propose", () => {
    const card = unwrap(
      composeHygieneCard({ ranked: rankProposals({ proposals: [] }), report: reportOf({ proposals: [] }) }),
    );
    expect(card.tldr).toBe("19 memories, nothing to propose.");
    expect(card.index).toEqual([]);
    expect(updateArtifactSchema.safeParse(card).success).toBe(true);
  });

  it("REFUSES a sixth proposal above the fold rather than trimming one", () => {
    const proposals = Array.from({ length: ABOVE_FOLD_CAP + 1 }, (_unused, position) =>
      proposalOf({ check: "duplicate", subject: `pair-${String(position)}.md` }),
    );
    const overflowing = { aboveFold: proposals, belowFold: [] };
    const composed = composeHygieneCard({ ranked: overflowing, report: reportOf({ proposals }) });
    expect(composed.isErr()).toBe(true);
    expect(composed._unsafeUnwrapErr()[0]).toContain(`over the cap of ${String(ABOVE_FOLD_CAP)}`);
  });

  it("opens a truncating index red, and a `keep` green whatever its check", () => {
    const proposals = [
      proposalOf({ check: "index-budget", subject: "MEMORY.md" }),
      proposalOf({ check: "referent-gone", recommendation: "keep", subject: "kept.md" }),
    ];
    const ranked = rankProposals({ proposals });
    const card = unwrap(composeHygieneCard({ ranked, report: reportOf({ indexBudget: FITS, proposals }) }));
    const openers = card.index.map((line) => line[0]!);
    expect(openers.map((run) => (run.type === "text" ? run.text : ""))).toEqual(["🔴 ", "🟢 "]);
    expect(CHECK_GLYPH["referent-gone"]).toBe("🟠");
  });

  it("writes the recurrence only once a proposal has actually waited", () => {
    const fresh = [proposalOf({ check: "duplicate", daysSeen: 1, subject: "fresh.md" })];
    const chronic = [proposalOf({ check: "duplicate", daysSeen: 9, subject: "chronic.md" })];
    const freshCard = unwrap(
      composeHygieneCard({ ranked: rankProposals({ proposals: fresh }), report: reportOf({ proposals: fresh }) }),
    );
    const chronicCard = unwrap(
      composeHygieneCard({ ranked: rankProposals({ proposals: chronic }), report: reportOf({ proposals: chronic }) }),
    );
    expect(JSON.stringify(freshCard.index)).not.toContain("(1d)");
    expect(JSON.stringify(chronicCard.index)).toContain("(9d)");
  });

  it("carries every glyph the check registry needs", () => {
    expect(HYGIENE_CHECK_IDS.length).toBeGreaterThan(0);
    expect([...HYGIENE_CHECK_IDS].filter((check) => CHECK_GLYPH[check].length === 0)).toEqual([]);
  });
});

describe("renderHygieneReport", () => {
  it("renders byte-identically twice over the same report", () => {
    const proposals = [proposalOf({ check: "duplicate", subject: "a.md + b.md" })];
    const report = reportOf({ proposals });
    expect(renderHygieneReport({ report })).toBe(renderHygieneReport({ report }));
  });

  it("carries every section, each proposal's id and evidence, and the grading commands", () => {
    const proposals = [
      proposalOf({ check: "enforcement", recommendation: "drop", subject: "restates.md" }),
      proposalOf({ check: "duplicate", subject: "a.md + b.md" }),
    ];
    const text = renderHygieneReport({ report: reportOf({ proposals }) });
    expect(text).toContain("# Memory hygiene");
    expect(text).toContain(
      `Run at ${NOW_ISO} over 19 memories and 7 knowledge row(s). This pass PROPOSES and never edits.`,
    );
    const unread = renderHygieneReport({ report: reportOf({ knowledgeRows: null, proposals }) });
    expect(unread).toContain(`over 19 memories and the knowledge rows NOT read.`);
    expect(text).toContain("## The index");
    expect(text).toContain("- 8 lines, 400 bytes — the whole index loads");
    expect(text).toContain("### drop · restates.md");
    expect(text).toContain("- evidence: evidence for restates.md");
    expect(text).toContain("## What this run could not settle");
    expect(text).toContain("- the duplicate scan never reads bodies");
    expect(text).toContain("slopweaver memory grade <id> refused --why '<why it stands>'");
    expect(text).toContain(`Checks, in severity order: ${HYGIENE_CHECK_IDS.join(", ")}.`);
  });

  it("names the truncation and every memory below the cut", () => {
    const budget: IndexBudget = {
      bytes: 26_000,
      cutAtLine: 200,
      limitReached: "bytes",
      lines: 240,
      nearLimit: true,
      pointersBelowCut: ["late-one", "late-two"],
    };
    const text = renderHygieneReport({ report: reportOf({ indexBudget: budget, proposals: [] }) });
    expect(text).toContain("- 240 lines, 26000 bytes — truncates at line 200");
    expect(text).toContain("- never loaded at session start: late-one");
    expect(text).toContain("- never loaded at session start: late-two");
  });

  it("says there is nothing to propose rather than leaving the section empty", () => {
    expect(renderHygieneReport({ report: reportOf({ proposals: [] }) })).toContain("Nothing to propose.");
  });
});
