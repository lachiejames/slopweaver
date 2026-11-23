import { describe, expect, it } from "vitest";

import { type BriefContext, renderBrief } from "../../../detective/brief.js";
import { type Lead } from "../../../detective/fanout.js";
import { judgeName, type NameFinding } from "../../../detective/nameProbe.js";
import { orderCells, type ProbeCell, type ProbeReport } from "../../../store/probe/result.js";
import type { ProbeShape } from "../../../store/probe/shapes.js";

/** One cell of a ladder, built from the total this file cares about. */
const cell = ({ shape, rows }: { shape: ProbeShape; rows: number }): ProbeCell => ({
  bySource: rows === 0 ? [] : [{ rows, source: "slack" }],
  ids: null,
  indexed: true,
  rows,
  shape,
});

/** A probe report over the given ladders. */
const report = ({ rows }: { rows: readonly { subject: string; cells: readonly ProbeCell[] }[] }): ProbeReport => ({
  elapsedMs: 1,
  enumerateAtOrBelow: 40,
  includeBots: false,
  rows: rows.map((row) => ({
    botsHidden: 0,
    cells: orderCells({ cells: row.cells }),
    elapsedMs: 1,
    kind: "term" as const,
    subject: row.subject,
  })),
  source: null,
});

/** The measured barten/barton finding, built through the real judge rather than by hand. */
const bartenFinding: NameFinding = judgeName({
  asked: "barten",
  forms: ["barten", "barton"],
  probe: report({
    rows: [
      { cells: [cell({ rows: 48, shape: "exact" })], subject: "barten" },
      { cells: [cell({ rows: 3061, shape: "exact" })], subject: "barton" },
    ],
  }),
});

const context = ({
  recalled = [],
  nameFinding = null,
}: { recalled?: readonly string[]; nameFinding?: NameFinding | null } = {}): BriefContext => ({
  index: 3,
  nameFinding,
  question: "what are Tobyn Barten's top five pain points",
  recalled,
  reportPath: "/tmp/report-3.md",
  total: 7,
});

const keywordLead: Lead = {
  keyword: "barten",
  rows: 18,
  source: "slack",
  startShape: "exact",
  why: '18 slack record(s) matched "barten" at its narrowest shape, exact',
};

const discoveryLead: Lead = {
  keyword: null,
  rows: 0,
  source: null,
  startShape: null,
  why: "ask the question in other words",
};

describe("renderBrief", () => {
  it("names this detective's place in the wave, so a report can identify itself", () => {
    const brief = renderBrief({ context: context(), lead: keywordLead });
    expect(brief).toContain("# Detective 3 of 7");
    expect(brief).toContain("what are Tobyn Barten's top five pain points");
  });

  it("opens a keyword lead at its narrowest shape and names the source as a start, not a fence", () => {
    const brief = renderBrief({ context: context(), lead: keywordLead });
    expect(brief).toContain('Your lead: the keyword "barten" in slack.');
    expect(brief).toContain("lead is where you START, never a boundary you may not cross");
  });

  it("tells the discovery detective it has no keyword on purpose", () => {
    const brief = renderBrief({ context: context(), lead: discoveryLead });
    expect(brief).toContain("You are the DISCOVERY detective");
    expect(brief).toContain("your job is the form nobody proposed");
  });

  it("hands over every rung of the ladder, counts before records", () => {
    const brief = renderBrief({ context: context(), lead: keywordLead });
    const rungs = ["store probe", "store groups", "store hits", "store peek", "store open", "store around"];
    expect(rungs.filter((rung) => brief.includes(rung))).toEqual(rungs);
  });

  it("keeps the fan-out flat and the detective silent", () => {
    const brief = renderBrief({ context: context(), lead: keywordLead });
    expect(brief).toContain("You never spawn another agent");
    expect(brief).toContain("You never post anything anywhere");
  });

  // MEASURED once: the Workflow harness relays the worker's own request to every leaf, and fourteen
  // Haiku detectives each started a `turn watch` on the worker's card; one ran `find` over a code directory.
  it("tells a leaf the relayed worker steps and a filesystem walk are not its own", () => {
    const brief = renderBrief({ context: context(), lead: keywordLead });
    expect(brief).toContain("You never run a `turn` verb");
    expect(brief).toContain("the WORKER's, and those steps are its own");
    expect(brief).toContain("You never walk the filesystem");
  });

  // MEASURED on the first live dogfood of this path: asked "what are Jane Acme's top five
  // pain points", FIVE of the six detectives that reported cited one record
  // — a bot message answering that same question —
  // instead of a record anyone else wrote. The one that did not was the gmail detective, whose source
  // did not hold a copy of it. A prior answer contains the question's own words, so it ranks for the
  // very question it was sent to investigate. Reproduce with
  // `slopweaver store groups --term <surname> --shape exact --facet container`.
  it("refuses the bot's own earlier answer as evidence, the same way a recalled lesson is refused", () => {
    const brief = renderBrief({ context: context(), lead: keywordLead });
    expect(brief).toContain("You never answer from the bot's own earlier answer");
    expect(brief).toContain("It is a HYPOTHESIS");
    expect(brief).toContain("a record someone OTHER than this bot wrote");
  });

  it("carries that refusal to the discovery detective too", () => {
    const brief = renderBrief({ context: context(), lead: discoveryLead });
    expect(brief).toContain("You never answer from the bot's own earlier answer");
  });

  it("says plainly when nothing was recalled, rather than implying the ground is safe", () => {
    const brief = renderBrief({ context: context(), lead: keywordLead });
    expect(brief).toContain("not\nthat there are no traps");
  });

  it("prints a recalled claim and marks it as something to challenge", () => {
    const brief = renderBrief({ context: context({ recalled: ["exclude the datadog channel"] }), lead: keywordLead });
    expect(brief).toContain("exclude the datadog channel");
  });

  it("names the report path and demands both not-optional closing sections", () => {
    const brief = renderBrief({ context: context(), lead: keywordLead });
    expect(brief).toContain("/tmp/report-3.md");
    expect(brief).toContain("what I could not establish");
    expect(brief).toContain("what I\nwould tell the next detective");
  });

  it("carries the pre-planning name finding into a keyword detective's brief", () => {
    const brief = renderBrief({ context: context({ nameFinding: bartenFinding }), lead: keywordLead });
    expect(brief).toContain('The name "barten" was probed across 2 form(s)');
    expect(brief).toContain('holds this person under "barton"');
  });

  it("carries the same finding into the discovery detective's brief", () => {
    const brief = renderBrief({ context: context({ nameFinding: bartenFinding }), lead: discoveryLead });
    expect(brief).toContain('holds this person under "barton"');
  });

  it("prints no name section at all when no name step ran", () => {
    expect(renderBrief({ context: context(), lead: keywordLead })).not.toContain("was probed across");
  });
});
