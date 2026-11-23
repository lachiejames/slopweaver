/**
 * {@link renderBriefMarkdown}/{@link briefReportFilename} — pure, a brief in and lines out.
 *
 * The filename case is the load-bearing one: `reflect friction-review` dates a report from its NAME, so a
 * writer and a gauge that disagree on the shape produce a report nothing can see. `THE FILENAME THE GAUGE
 * PARSES` below is that contract asserted against the gauge's own regex rather than against a copy of it.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "#lib/result.js";
import type { ReflectBrief } from "../../../reflect/brief.js";
import { briefReportFilename, renderBriefMarkdown } from "../../../reflect/briefMarkdown.js";
import { type FrictionFinding, findingId } from "../../../reflect/finding.js";
import { planGrade } from "../../../reflect/grades.js";
import type { RankedFinding } from "../../../reflect/rank.js";
import { foldSeenLedger } from "../../../reflect/seen.js";

const finding = (over: Partial<FrictionFinding> = {}): FrictionFinding => ({
  classKey: "a-class",
  consequence: "Work sat waiting on your answer for 9.0h across 1 question(s); the longest wait was 9.0h",
  cost: 2,
  coveredBy: [],
  evidence: [],
  firstSeenIso: "2026-09-19T01:00:00.000Z",
  impact: 3,
  knownBy: [],
  lastSeenIso: "2026-09-19T02:00:00.000Z",
  locus: "handover question",
  occurrences: 1,
  refutedBy: [],
  safety: 4,
  source: "run-journal",
  summary: "1 run(s) stopped to ask the owner the same class of question",
  ...over,
});

const candidate = (over: Partial<RankedFinding> = {}): RankedFinding => ({
  baseImpact: 3,
  closedAtIso: undefined,
  closedBy: undefined,
  daysSeen: 6,
  finding: finding(),
  grade: undefined,
  id: "a-class-run-journal",
  priorSurfacings: 5,
  score: 6,
  ...over,
});

const brief = (over: Partial<ReflectBrief> = {}): ReflectBrief => ({
  backlog: [],
  couldNotVerify: ["the morning-report history is not read here"],
  grades: [],
  heldUnmeasured: 0,
  seenRows: [],
  sources: [{ findings: 1, rowsRead: 338, source: "run-journal" }],
  suppressed: 0,
  surfaced: [candidate()],
  tsIso: "2026-09-20T06:30:00.000Z",
  window: { fromIso: "2026-09-19T06:30:00.000Z", toIso: "2026-09-20T06:30:00.000Z" },
  ...over,
});

const render = ({ over = {} }: { over?: Partial<ReflectBrief> } = {}): string =>
  renderBriefMarkdown({ brief: brief(over), date: "2026-09-20" }).join("\n");

describe("briefReportFilename", () => {
  it("names the report for its own day", () => {
    expect(briefReportFilename({ date: "2026-09-20" })).toBe("self-improvement-2026-09-20.md");
  });

  it("THE FILENAME THE GAUGE PARSES: it matches the shape frictionReviewGap reads a date out of", () => {
    const parsed = /^self-improvement-(\d{4}-\d{2}-\d{2})\.md$/.exec(briefReportFilename({ date: "2026-09-20" }));
    expect(parsed![1]).toBe("2026-09-20");
  });
});

describe("renderBriefMarkdown", () => {
  it("opens with the day it is reporting on", () => {
    expect(renderBriefMarkdown({ brief: brief(), date: "2026-09-20" })[0]).toBe(
      "# Self-improvement mining, 2026-09-20",
    );
  });

  it("counts the surfaced against the whole candidate set, not against the backlog alone", () => {
    const text = render({ over: { backlog: [candidate({ id: "other" })], suppressed: 2 } });
    expect(text).toContain("1 surfaced of 2 candidate classes; 1 in the backlog; 2 dropped by a terminal grade.");
  });

  it("names the window and every source's rows read, so the report carries its own provenance", () => {
    expect(render()).toContain("Window 2026-09-19T06:30:00.000Z .. 2026-09-20T06:30:00.000Z, read run-journal 338.");
  });

  it("a finding's heading is its measured cost to the owner, never a locus and a score", () => {
    const text = render();
    expect(text).toContain(
      "### Work sat waiting on your answer for 9.0h across 1 question(s); the longest wait was 9.0h",
    );
    expect(text).not.toContain("### handover question — 6.0");
  });

  it("says systemic or one-off with its counts directly under the heading", () => {
    const lines = renderBriefMarkdown({ brief: brief(), date: "2026-09-20" });
    const heading = lines.findIndex((line) => line.startsWith("### "));
    expect(lines[heading + 2]).toBe("SYSTEMIC — once this window, seen on 6 different days in all");
  });

  it("calls a finding seen once on one day a one-off", () => {
    const text = render({ over: { surfaced: [candidate({ daysSeen: 1 })] } });
    expect(text).toContain("ONE-OFF — once this window, seen on 1 day");
  });

  it("carries what happened beneath the cost and the pattern, labelled", () => {
    expect(render()).toContain("What happened: 1 run(s) stopped to ask the owner the same class of question");
  });

  it("labels the arithmetic as the fleet's ordering, not a grade, with where it was seen and its history", () => {
    const text = render({
      over: { surfaced: [candidate({ baseImpact: 3, finding: finding({ cost: 2, impact: 5, safety: 4 }) })] },
    });
    expect(text).toContain(
      "- fleet ordering, not a grade: 6.0 = impact 5 (3 before recurrence) x safety 4 / cost 2, " +
        "from run-journal at handover question; surfaced 5 times before",
    );
  });

  it("carries the rubric a grade is against, naming what each grade does", () => {
    const text = render();
    expect(text).toContain("## How to grade");
    expect(text).toContain("- keep — that cost is worth the fleet fixing; it stays on the list until a fix closes it");
    expect(text).toContain(
      "- drop — an acceptable cost, or noise; it is never shown to you again (the underlying thing is not fixed)",
    );
  });

  it("says nothing is graded when every candidate was held for stating no cost, rather than calling it quiet", () => {
    const text = render({ over: { backlog: [candidate({ id: "held" })], heldUnmeasured: 1, surfaced: [] } });
    expect(text).toContain(
      "Nothing to grade: 1 finding could not state a measured cost to you or the fleet, so it was held.",
    );
    expect(text).not.toContain("A quiet pass is a good pass.");
  });

  it("lists the board docs that already cover a finding, sorted", () => {
    const text = render({
      over: { surfaced: [candidate({ finding: finding({ coveredBy: ["zeta-doc", "alpha-doc"] }) })] },
    });
    expect(text).toContain("- board: alpha-doc, zeta-doc");
  });

  it("lists the memories that already record it", () => {
    const text = render({ over: { surfaced: [candidate({ finding: finding({ knownBy: ["a-memory"] }) })] } });
    expect(text).toContain("- memory: a-memory");
  });

  it("says nothing is recorded rather than dropping the line, which would read as a renderer that forgot", () => {
    const text = render();
    expect(text).toContain("- board: nothing recorded");
    expect(text).toContain("- memory: nothing recorded");
  });

  it("always carries the could-not-see section, because silence is never evidence of correctness", () => {
    const text = render();
    expect(text).toContain("## What this run could not see");
    expect(text).toContain("- the morning-report history is not read here");
  });

  it("says a quiet pass is a good pass rather than rendering an empty Surfaced section", () => {
    const text = render({ over: { surfaced: [] } });
    expect(text).toContain("Nothing this window. A quiet pass is a good pass.");
    expect(text).toContain("0 surfaced of 0 candidate classes");
  });

  it("closes by saying the report is evidence rather than a plan", () => {
    const lines = renderBriefMarkdown({ brief: brief(), date: "2026-09-20" });
    expect(lines.at(-2)).toBe("is the dispatched session's job, not this file's. This is the evidence it starts from.");
  });

  it("renders every surfaced finding, not just the first", () => {
    const text = render({
      over: {
        surfaced: [
          candidate({ finding: finding({ consequence: "first cost" }), score: 10 }),
          candidate({ finding: finding({ consequence: "second cost" }), id: "second", score: 8 }),
        ],
      },
    });
    expect(text).toContain("### first cost");
    expect(text).toContain("### second cost");
  });
});

describe("renderBriefMarkdown: the finding id and its evidence, so the owner can grade what they read", () => {
  const signal = { classKey: "donewhen-probe-named-a-flag", locus: "handover amend", source: "run-journal" } as const;
  const id = findingId({ signal });
  const withEvidence = candidate({
    finding: finding({
      ...signal,
      evidence: ["run alpha stopped: which of two PRs to land", "run beta stopped: same question again"],
    }),
    id,
  });

  it("writes the id of every surfaced finding, in a code span, exactly as the ranking carries it", () => {
    const text = render({ over: { surfaced: [withEvidence] } });
    expect(text).toContain(`- finding id: \`${id}\``);
  });

  it("the id findingId mints is twelve lowercase hex characters, so it is always safe inside a code span", () => {
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });

  it("names the one verb that takes the id, so the line is a command rather than a riddle", () => {
    const text = render({ over: { surfaced: [withEvidence] } });
    expect(text).toContain(`slopweaver reflect grade ${id} keep|adjust|drop`);
  });

  it("ROUND-TRIPS: the id read back out of the report is one `reflect grade` finds in the ledger", () => {
    const text = render({ over: { surfaced: [withEvidence] } });
    const written = /^- finding id: `([^`]+)`/m.exec(text)![1]!;
    const states = foldSeenLedger({
      rows: [{ ...signal, disposition: "surfaced", id, occurrences: 2, tsIso: "2026-09-19T06:30:00.000Z" }],
    });
    const plan = unwrap(
      planGrade({ input: { grade: "keep", id: written, tsIso: "2026-09-20T09:00:00.000Z" }, states }),
    );
    expect(plan.row.id).toBe(id);
  });

  it("writes each evidence line the collector recorded, one bullet per line", () => {
    const text = render({ over: { surfaced: [withEvidence] } });
    expect(text).toContain("- evidence: run alpha stopped: which of two PRs to land");
    expect(text).toContain("- evidence: run beta stopped: same question again");
  });

  it("says no evidence was recorded rather than dropping the line, which would read as a renderer that forgot", () => {
    const text = render({ over: { surfaced: [candidate({ finding: finding({ evidence: [] }) })] } });
    expect(text).toContain("- evidence: none recorded");
  });

  it("treats blank evidence strings as no evidence, never as an empty bullet", () => {
    const text = render({ over: { surfaced: [candidate({ finding: finding({ evidence: ["", "  "] }) })] } });
    expect(text).toContain("- evidence: none recorded");
    expect(text).not.toContain("- evidence: \n");
  });

  it("carries the id and the evidence of EVERY surfaced finding, not just the first", () => {
    const text = render({
      over: {
        surfaced: [
          candidate({ finding: finding({ evidence: ["first line"] }), id: "first-id" }),
          candidate({ finding: finding({ evidence: ["second line"] }), id: "second-id" }),
        ],
      },
    });
    expect(text).toContain("- finding id: `first-id`");
    expect(text).toContain("- evidence: first line");
    expect(text).toContain("- finding id: `second-id`");
    expect(text).toContain("- evidence: second line");
  });
});
