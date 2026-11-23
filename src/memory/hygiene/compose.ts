/**
 * THE CARD, and the report that backs it — the only place this pass produces something a human reads.
 *
 * Pure. Two renderings of one report, and they are deliberately not the same shape:
 *
 * - {@link composeHygieneCard} builds the `UpdateArtifact` — a colour-coded ranked list above the fold, every
 *   piece of evidence collapsed below it. Rule 7.
 * - {@link renderHygieneReport} builds the markdown that goes to `$SLOPWEAVER_HOME/morning`, which is the
 *   run's evidence rather than its message: nothing is capped there, because nobody is being asked to read it
 *   in a Slack scroll.
 *
 * ## The sixth proposal is REFUSED, not trimmed
 *
 * `./rank.ts` splits at `ABOVE_FOLD_CAP`, and this module refuses an above-the-fold list longer than that
 * instead of quietly cutting it. Rule 7 states the mechanism — "shape is enforced by the SCHEMA, never by
 * review … an outbound form caps what appears above the fold and REFUSES a violation rather than truncating
 * one" — and a composer that trimmed its own overflow would be exactly the review-shaped enforcement the rule
 * names. The refusal is a FACT about the input, not a policy block, so it is a plain `Result` failure and
 * carries no escape hatch.
 *
 * ## Colour declares what is being asked of the owner, and nothing else
 *
 * The band comes from the check's own severity, with one override: a `keep` recommendation is always green,
 * because a keep asks the owner for nothing — it is the pass reporting that it found something and talked itself
 * out of it. That override is why a refuted drop is visible at all rather than being dropped from the card:
 * `../../reflect/crossRef.ts`'s own words, a refutation "can go stale, so it is printed rather than obeyed".
 *
 * ## Why the card never says how long anything will take
 *
 * Nothing here estimates. A proposal carries `daysSeen`, which is a MEASUREMENT of how long it has been
 * waiting, and never a projection of when it will be done.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { InlineRun, UpdateArtifact } from "../../outbound/artifact/types.js";
import { readableSubject } from "./proposalId.js";
import { ABOVE_FOLD_CAP, type RankedProposals } from "./rank.js";
import {
  HYGIENE_CHECK_IDS,
  type HygieneCheckId,
  type MemoryHygieneProposal,
  type MemoryHygieneReport,
} from "./types.js";

/**
 * The colour each check's proposals open with, in `RANK_GLYPHS` vocabulary.
 *
 * Red is reserved for the one finding that is costing something RIGHT NOW: an index past the loader's limit
 * is not loading memories at this moment, which no other check can say. A schema defect and a vanished
 * referent are orange because the memory is wrong rather than absent. A moved referent and a duplicate pair
 * are yellow — both are edits, and neither makes a memory false. Enforcement is yellow because its drop is
 * the one recommendation that removes something, so it earns a look rather than a glance.
 *
 * @internal
 */
export const CHECK_GLYPH: Readonly<Record<HygieneCheckId, string>> = {
  duplicate: "🟡",
  enforcement: "🟡",
  "index-budget": "🔴",
  "referent-gone": "🟠",
  "referent-moved": "🟡",
  schema: "🟠",
};

/** The glyph one proposal opens with. A `keep` is always green: it asks the owner for nothing. */
function glyphOf({ proposal }: { proposal: MemoryHygieneProposal }): string {
  if (proposal.recommendation === "keep") {
    return "🟢";
  }
  return CHECK_GLYPH[proposal.check];
}

/** The recurrence suffix, written only when a proposal has actually waited. */
function recurrenceSuffix({ proposal }: { proposal: MemoryHygieneProposal }): string {
  if (proposal.daysSeen <= 1) {
    return "";
  }
  return ` (${String(proposal.daysSeen)}d)`;
}

/** One above-the-fold index line: colour, recommendation, the one-line summary, and any recurrence. */
function indexLine({ proposal }: { proposal: MemoryHygieneProposal }): readonly InlineRun[] {
  return [
    { text: `${glyphOf({ proposal })} `, type: "text" },
    { bold: true, text: proposal.recommendation, type: "text" },
    { text: ` — ${proposal.summary}${recurrenceSuffix({ proposal })}`, type: "text" },
  ];
}

/** One proposal's below-the-fold block: its id, its evidence, and everything that argued against it. */
function detailItems({ proposal }: { proposal: MemoryHygieneProposal }): readonly (readonly InlineRun[])[] {
  const refuted = proposal.refutations.map((refutation): readonly InlineRun[] => [
    { text: `${proposal.id} refuted (${refutation.rule}): ${refutation.detail}`, type: "text" },
  ]);
  return [
    [
      { code: true, text: proposal.id, type: "text" },
      { text: ` ${proposal.check} · ${readableSubject({ subject: proposal.subject })}`, type: "text" },
    ],
    ...proposal.evidence.map((line): readonly InlineRun[] => [{ text: line, type: "text" }]),
    ...refuted,
  ];
}

/** The one-line lead. Names the counts the owner would otherwise have to add up. */
function tldrOf({ report, ranked }: { report: MemoryHygieneReport; ranked: RankedProposals }): string {
  const drops = report.proposals.filter((entry) => entry.recommendation === "drop").length;
  const carried = ranked.belowFold.length;
  if (report.proposals.length === 0) {
    return `${String(report.leafCount)} memories, nothing to propose.`;
  }
  const carriedClause = carried === 0 ? "" : `, ${String(carried)} more below`;
  return `${String(report.proposals.length)} proposals over ${String(report.leafCount)} memories, ${String(drops)} of them a drop${carriedClause}. Nothing has been changed.`;
}

/**
 * Build the card.
 *
 * @param report the whole run, already ranked
 * @param ranked the split at the fold, from `./rank.ts`
 * @returns the artifact, or the reason its above-the-fold list could not be shown honestly
 */
export function composeHygieneCard({
  report,
  ranked,
}: {
  report: MemoryHygieneReport;
  ranked: RankedProposals;
}): Result<UpdateArtifact> {
  if (ranked.aboveFold.length > ABOVE_FOLD_CAP) {
    return err([
      `${String(ranked.aboveFold.length)} proposals were put above the fold, over the cap of ${String(ABOVE_FOLD_CAP)} — rank them before composing rather than trimming here`,
    ]);
  }
  const carried = ranked.belowFold.map((proposal): readonly InlineRun[] => [
    { text: `${glyphOf({ proposal })} ${proposal.recommendation} — ${proposal.summary}`, type: "text" },
  ]);
  return ok({
    citations: [],
    detail: [
      {
        runs: [{ text: "Every proposal, with its evidence. Nothing here has been applied.", type: "text" }],
        type: "paragraph",
      },
      ...ranked.aboveFold.map((proposal) => ({ items: detailItems({ proposal }), type: "bullets" }) as const),
      ...(carried.length === 0 ? [] : [{ items: carried, type: "bullets" } as const]),
      { items: report.residue.map((line): readonly InlineRun[] => [{ text: line, type: "text" }]), type: "bullets" },
    ],
    index: ranked.aboveFold.map((proposal) => indexLine({ proposal })),
    indexStyle: "ordered",
    kind: "update",
    media: [],
    tldr: tldrOf({ ranked, report }),
  });
}

/** One proposal's markdown section, evidence and refutations included. */
function reportSection({ proposal }: { proposal: MemoryHygieneProposal }): readonly string[] {
  return [
    `### ${proposal.recommendation} · ${readableSubject({ subject: proposal.subject })}`,
    "",
    `- id: \`${proposal.id}\``,
    `- check: ${proposal.check}`,
    `- files: ${proposal.files.join(", ")}`,
    `- days seen: ${String(proposal.daysSeen)}`,
    `- summary: ${proposal.summary}`,
    ...proposal.evidence.map((line) => `- evidence: ${line}`),
    ...proposal.refutations.map((refutation) => `- refuted (${refutation.rule}): ${refutation.detail}`),
    "",
  ];
}

/**
 * Render the run's evidence as the markdown that goes to the morning-report directory.
 *
 * Deterministic: every line comes from the report, which was ranked by a total comparator and carries its
 * instant as an injected field. So two runs over an unchanged corpus at the same instant produce byte-identical
 * text, which is what makes yesterday's report something a reader can diff rather than re-read.
 *
 * @param report the whole run
 * @returns the markdown, newline-terminated
 */
export function renderHygieneReport({ report }: { report: MemoryHygieneReport }): string {
  const budget = report.indexBudget;
  const cut = budget.cutAtLine === null ? "the whole index loads" : `truncates at line ${String(budget.cutAtLine)}`;
  const knowledge =
    report.knowledgeRows === null ? "the knowledge rows NOT read" : `${String(report.knowledgeRows)} knowledge row(s)`;
  const lines = [
    "# Memory hygiene",
    "",
    `Run at ${report.nowIso} over ${String(report.leafCount)} memories and ${knowledge}. This pass PROPOSES and never edits.`,
    "",
    "## The index",
    "",
    `- ${String(budget.lines)} lines, ${String(budget.bytes)} bytes — ${cut}`,
    ...budget.pointersBelowCut.map((target) => `- never loaded at session start: ${target}`),
    "",
    "## Proposals",
    "",
    ...(report.proposals.length === 0 ? ["Nothing to propose.", ""] : []),
    ...report.proposals.flatMap((proposal) => reportSection({ proposal })),
    "## What this run could not settle",
    "",
    ...report.residue.map((line) => `- ${line}`),
    "",
    "## Grading",
    "",
    "Answer a proposal by its id:",
    "",
    "```bash",
    "slopweaver memory grade <id> accepted --why '<what you want done>'",
    "slopweaver memory grade <id> refused --why '<why it stands>'",
    "```",
    "",
    `A refusal is terminal — it is never proposed again. Checks, in severity order: ${HYGIENE_CHECK_IDS.join(", ")}.`,
    "",
  ];
  return `${lines.join("\n")}`;
}
