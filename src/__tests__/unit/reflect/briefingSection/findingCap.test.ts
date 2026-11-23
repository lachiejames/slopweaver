/*
 * The finding cap is refused rather than trimmed: five render with every field in its own note, a sixth names every
 * finding past the cap, and the summary says how many more the backlog holds.
 */
import { describe, expect, it } from "vitest";

import { unwrapErr } from "#lib/result.js";

import type { BriefingBlock, BriefingNote } from "../../../../outbound/briefing/types.js";
import { textOfContent } from "../../../../outbound/briefing/vocabulary.js";
import { renderSelfImprovementSection, SELF_IMPROVEMENT_MAX_FINDINGS } from "../../../../reflect/briefingSection.js";
import { SelfImprovementSectionErrors } from "../../../../reflect/briefingSectionErrors.js";
import type { RankedFinding } from "../../../../reflect/rank.js";
import { finding, headlineText, ranked, render } from "./harness.js";

/** Every word a note carries, headline and fold, nested folds included, so a field anywhere in it is findable. */
const blockText = ({ block }: { block: BriefingBlock }): string => {
  if (block.kind === "para") return textOfContent({ content: block.content });
  if (block.kind === "list") return block.items.map((content) => textOfContent({ content })).join("\n");
  if (block.kind !== "fold") throw new Error(`the section never renders a ${block.kind} block`);
  return [block.fold.summary, ...block.fold.blocks.map((inner) => blockText({ block: inner }))].join("\n");
};

const noteText = ({ note }: { note: BriefingNote }): string =>
  [headlineText({ note }), ...note.detail!.blocks.map((block) => blockText({ block }))].join("\n");

describe("renderSelfImprovementSection — the cap is REFUSED, never trimmed", () => {
  const five = Array.from({ length: SELF_IMPROVEMENT_MAX_FINDINGS }, (_, index) =>
    ranked({ id: `id-${String(index + 1)}` }),
  );

  it("renders five findings, every field of each one in its own note, in the order given", () => {
    const grades = ["keep", "adjust", "drop", "keep", "adjust"] as const;
    const distinct = Array.from({ length: SELF_IMPROVEMENT_MAX_FINDINGS }, (_, index): RankedFinding => {
      const n = String(index + 1);
      return ranked({
        baseImpact: index + 1,
        closedAtIso: `2026-09-1${n}T03:00:00.000Z`,
        closedBy: `slopweaver#90${n}`,
        daysSeen: 20 + index,
        finding: finding({
          classKey: `class-${n}`,
          cost: index + 1,
          coveredBy: [`board-${n}`],
          evidence: [`evidence-${n}-a`, `evidence-${n}-b`],
          firstSeenIso: `2026-09-0${n}T01:00:00.000Z`,
          impact: index + 2,
          knownBy: [`memory-${n}`],
          lastSeenIso: `2026-09-0${n}T02:00:00.000Z`,
          locus: `locus-${n}`,
          occurrences: 10 + index,
          refutedBy: [`register-${n}`],
          safety: index + 3,
          source: index % 2 === 0 ? "run-journal" : "dev-gate",
          summary: `summary number ${n} of the five`,
        }),
        grade: grades[index],
        id: `id-${n}`,
        priorSurfacings: 30 + index,
        score: 100 + index,
      });
    });
    const notes = render({ findings: distinct }).notes;
    expect(notes.length).toBe(5);
    distinct.forEach((candidate, index) => {
      const text = noteText({ note: notes[index]! });
      const { finding: f } = candidate;
      [
        f.summary,
        candidate.id,
        `Seen at ${f.locus} by the ${f.source} reader, ${String(f.occurrences)} time(s)`,
        `(first ${f.firstSeenIso}, last ${f.lastSeenIso})`,
        `on ${String(candidate.daysSeen)} day(s) in all, shown ${String(candidate.priorSurfacings)} time(s) before`,
        `as class ${f.classKey}`,
        `Score ${candidate.score.toFixed(2)} is impact ${String(f.impact)} (${String(candidate.baseImpact)} before recurrence)`,
        `times safety ${String(f.safety)} over cost ${String(f.cost)}`,
        `Graded ${candidate.grade!}; closed by ${candidate.closedBy!} at ${candidate.closedAtIso!}`,
        ...f.evidence,
        ...f.coveredBy,
        ...f.refutedBy,
        ...f.knownBy,
      ].forEach((fragment) => expect(text).toContain(fragment));
    });
  });

  it("refuses a sixth finding, naming it, rather than rendering five and dropping it", () => {
    const refused = unwrapErr(
      renderSelfImprovementSection({ findings: [...five, ranked({ id: "id-6" })], notShown: 0 }),
    );
    expect(refused).toEqual(SelfImprovementSectionErrors.tooManyFindings({ cap: 5, overflowIds: ["id-6"] }));
    expect(refused.message).toContain("it would have dropped id-6");
  });

  it("names EVERY finding past the cap, in the order it received them", () => {
    const findings = [...five, ranked({ id: "id-6" }), ranked({ id: "id-7" })];
    expect(unwrapErr(renderSelfImprovementSection({ findings, notShown: 0 })).code).toBe("TOO_MANY_FINDINGS");
    expect(unwrapErr(renderSelfImprovementSection({ findings, notShown: 0 }))).toEqual(
      SelfImprovementSectionErrors.tooManyFindings({ cap: 5, overflowIds: ["id-6", "id-7"] }),
    );
  });

  it("says how many ranked findings the backlog holds, so five never reads as everything", () => {
    expect(render({ findings: five, notShown: 23 }).summary).toBe(
      "Self-improvement opportunities: 5 this window, 23 more held back; nothing was changed",
    );
  });
});
