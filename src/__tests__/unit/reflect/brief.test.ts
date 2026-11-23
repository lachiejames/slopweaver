import { describe, expect, it } from "vitest";

import type { CoverageSource } from "../../../lib/rareTokens.js";
import { ok } from "../../../lib/result.js";
import { composeBrief, mineSubstrates, readCoverage, reflectPaths, renderBriefLines } from "../../../reflect/brief.js";
import { type FrictionFinding, REFLECT_SOURCES, type ReflectSource } from "../../../reflect/finding.js";
import { heartbeatFor, heartbeatSchema } from "../../../reflect/heartbeat.js";
import { SURFACE_CAP } from "../../../reflect/rank.js";
import { foldSeenLedger, type SeenState } from "../../../reflect/seen.js";
import type { CollectorReading, ReflectWindow, SubstrateReader } from "../../../reflect/substrate.js";

const window: ReflectWindow = { fromIso: "2026-08-27T00:00:00.000Z", toIso: "2026-08-28T00:00:00.000Z" };
const tsIso = "2026-08-28T00:00:00.000Z";
const noState: ReadonlyMap<string, SeenState> = new Map();

const finding = (over: Partial<FrictionFinding> = {}): FrictionFinding => ({
  classKey: "a-class",
  consequence: "a measured cost",
  cost: 2,
  coveredBy: [],
  evidence: ["one piece of evidence"],
  firstSeenIso: "2026-08-27T01:00:00.000Z",
  impact: 3,
  knownBy: [],
  refutedBy: [],
  lastSeenIso: "2026-08-27T02:00:00.000Z",
  locus: "a locus",
  occurrences: 1,
  safety: 4,
  source: "run-journal",
  summary: "a summary",
  ...over,
});

const reading = ({
  source,
  findings = [],
  residue = [],
  rowsRead = 0,
}: {
  source: ReflectSource;
  findings?: readonly FrictionFinding[];
  residue?: readonly string[];
  rowsRead?: number;
}): CollectorReading => ({ findings, residue, rowsRead, source });

const fakeReader = ({ files }: { files: Readonly<Record<string, string>> }): SubstrateReader => ({
  listNames: (dir) =>
    [
      ...new Set(
        Object.keys(files)
          .filter((path) => path.startsWith(`${dir}/`))
          .map((path) => path.slice(dir.length + 1).split("/")[0]!),
      ),
    ].toSorted((a, b) => a.localeCompare(b)),
  readText: (path) => files[path],
});

describe("composeBrief", () => {
  it("refuses a sixth finding by construction", () => {
    const findings = Array.from({ length: 12 }, (_, index) =>
      finding({ classKey: `class-${String(index)}`, source: REFLECT_SOURCES[index % REFLECT_SOURCES.length]! }),
    );
    const brief = composeBrief({
      readings: [reading({ findings, source: "run-journal" })],
      states: noState,
      tsIso,
      window,
    });
    expect(brief.surfaced).toHaveLength(SURFACE_CAP);
  });

  it("always says something under could-not-verify, even on a run that found things", () => {
    const brief = composeBrief({
      readings: [reading({ findings: [finding()], residue: ["one ledger was absent"], source: "run-journal" })],
      states: noState,
      tsIso,
      window,
    });
    expect(brief.couldNotVerify).toStrictEqual(["one ledger was absent"]);
  });

  it("calls a quiet window a good pass rather than an empty one", () => {
    const brief = composeBrief({ readings: [], states: noState, tsIso, window });
    expect(brief.couldNotVerify).toStrictEqual([
      "no confirmable friction this window, nothing to propose — a good pass, not a wasted one",
    ]);
  });

  it("says which source the share held back, rather than dropping it silently", () => {
    const findings = Array.from({ length: 5 }, (_, index) => finding({ classKey: `class-${String(index)}` }));
    const brief = composeBrief({
      readings: [reading({ findings, source: "run-journal" })],
      states: noState,
      tsIso,
      window,
    });
    expect(brief.couldNotVerify[0]).toContain("run-journal had 3 more findings than its share");
  });

  it("records one sighting per candidate, surfaced or backlogged, all stamped with the injected instant", () => {
    const findings = Array.from({ length: 4 }, (_, index) => finding({ classKey: `class-${String(index)}` }));
    const brief = composeBrief({
      readings: [reading({ findings, source: "run-journal" })],
      states: noState,
      tsIso,
      window,
    });
    expect(brief.seenRows).toHaveLength(4);
    expect(brief.seenRows.filter((row) => row.disposition === "surfaced")).toHaveLength(2);
    expect(brief.seenRows.every((row) => row.tsIso === tsIso)).toBe(true);
  });

  it("reports every source, so a collector that produced nothing is visible as a zero", () => {
    const brief = composeBrief({
      readings: [reading({ rowsRead: 9, source: "dev-gate" })],
      states: noState,
      tsIso,
      window,
    });
    expect(brief.sources).toHaveLength(REFLECT_SOURCES.length);
    expect(brief.sources.find((one) => one.source === "dev-gate")).toStrictEqual({
      findings: 0,
      rowsRead: 9,
      source: "dev-gate",
    });
  });

  it("prints the grade distribution for every source even before any grade exists", () => {
    const brief = composeBrief({ readings: [], states: noState, tsIso, window });
    expect(brief.grades).toHaveLength(REFLECT_SOURCES.length);
    expect(brief.grades[0]).toStrictEqual({ adjust: 0, drop: 0, keep: 0, source: "run-journal" });
  });

  it("is byte-identical over two runs of the same inputs", () => {
    const readings = [reading({ findings: [finding()], residue: ["a note"], source: "run-journal" })];
    const first = composeBrief({ readings, states: noState, tsIso, window });
    const second = composeBrief({ readings, states: noState, tsIso, window });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("applies the cross-reference before ranking, so a covered finding is demoted", () => {
    const covering: readonly CoverageSource[] = [
      ...Array.from({ length: 20 }, (_, index) => ({ id: `filler-${String(index)}`, text: "handover locus common" })),
      { id: "the-doc", text: "sprocket calibration widget" },
    ];
    const brief = composeBrief({
      coverage: { board: covering, memory: [] },
      readings: [
        reading({ findings: [finding({ classKey: "sprocket-calibration", locus: "widget" })], source: "run-journal" }),
      ],
      states: noState,
      tsIso,
      window,
    });
    expect(brief.surfaced[0]!.finding.coveredBy).toStrictEqual(["the-doc"]);
    expect(brief.surfaced[0]!.baseImpact).toBe(2);
  });

  it("counts what a terminal drop suppressed", () => {
    const dropped = finding();
    const rows = [
      {
        classKey: dropped.classKey,
        disposition: "drop" as const,
        id: "",
        locus: dropped.locus,
        occurrences: 1,
        source: dropped.source,
        tsIso: "2026-08-26T00:00:00.000Z",
      },
    ];
    const withRealId = composeBrief({
      readings: [reading({ findings: [dropped], source: "run-journal" })],
      states: noState,
      tsIso,
      window,
    });
    const id = withRealId.surfaced[0]!.id;
    const brief = composeBrief({
      readings: [reading({ findings: [dropped], source: "run-journal" })],
      states: foldSeenLedger({ rows: rows.map((row) => ({ ...row, id })) }),
      tsIso,
      window,
    });
    expect(brief.surfaced).toStrictEqual([]);
    expect(brief.suppressed).toBe(1);
  });
});

describe("heartbeatFor", () => {
  it("builds a row the frozen schema accepts", () => {
    const brief = composeBrief({
      readings: [reading({ findings: [finding()], rowsRead: 3, source: "run-journal" })],
      states: noState,
      tsIso,
      window,
    });
    expect(heartbeatSchema.safeParse(heartbeatFor({ brief })).success).toBe(true);
  });

  it("writes a row for a run that found nothing at all", () => {
    const brief = composeBrief({ readings: [], states: noState, tsIso, window });
    const row = heartbeatFor({ brief });
    expect(row.surfaced).toBe(0);
    expect(row.candidates).toBe(0);
    expect(heartbeatSchema.safeParse(row).success).toBe(true);
  });
});

describe("renderBriefLines", () => {
  it("leads each finding with its measured cost, then the pattern and what happened, the evidence beneath", () => {
    const brief = composeBrief({
      readings: [
        reading({
          findings: [finding({ consequence: "3 runs were dropped", summary: "the thing that happened" })],
          source: "run-journal",
        }),
      ],
      states: noState,
      tsIso,
      window,
    });
    const lines = renderBriefLines({ brief });
    expect(lines[4]).toMatch(/^1\. \[[0-9a-f]{12}\] 3 runs were dropped$/);
    expect(lines[5]).toBe("     ONE-OFF — once this window, seen on 1 day");
    expect(lines[6]).toBe("     what happened: the thing that happened");
    expect(lines[9]).toBe("       - one piece of evidence");
  });

  it("holds a finding with no measured cost, says so under could-not-verify, and does not call the pass quiet", () => {
    const brief = composeBrief({
      readings: [reading({ findings: [finding({ consequence: undefined })], source: "run-journal" })],
      states: noState,
      tsIso,
      window,
    });
    expect(brief.surfaced).toStrictEqual([]);
    expect(brief.heldUnmeasured).toBe(1);
    expect(brief.seenRows.map((row) => row.disposition)).toStrictEqual(["backlogged"]);
    expect(brief.couldNotVerify).toContain(
      "1 candidate finding could not state a measured cost to you or the fleet, so it was held in the backlog rather than put in front of you to grade",
    );
    expect(brief.couldNotVerify.some((line) => line.startsWith("no confirmable friction"))).toBe(false);
  });

  it("always renders the could-not-verify heading", () => {
    const lines = renderBriefLines({ brief: composeBrief({ readings: [], states: noState, tsIso, window }) });
    expect(lines).toContain("  COULD NOT VERIFY:");
    expect(lines[0]).toBe("reflect brief: 0 surfaced of 0 candidates, 0 in the backlog");
  });

  it("shows its arithmetic so a reader can check the rank", () => {
    const brief = composeBrief({
      readings: [reading({ findings: [finding({ cost: 2, impact: 3, safety: 4 })], source: "run-journal" })],
      states: noState,
      tsIso,
      window,
    });
    expect(renderBriefLines({ brief })[7]).toContain(
      "fleet ordering, not a grade: 6.00 = impact 3 (3 before recurrence) x safety 4 / cost 2",
    );
  });

  it("bounds a long cross-reference list rather than printing a wall", () => {
    // Six of sixty carry the shared vocabulary — exactly the document-frequency ceiling, so they still
    // count — and the renderer must then say "and 3 more" rather than printing all six.
    const covering: readonly CoverageSource[] = Array.from({ length: 60 }, (_, index) => ({
      id: `doc-${String(index)}`,
      text: index < 6 ? "sprocket calibration widget" : `unrelated${String(index)} vocabulary distinct phrasing`,
    }));
    const brief = composeBrief({
      coverage: { board: covering, memory: [] },
      readings: [
        reading({ findings: [finding({ classKey: "sprocket-calibration", locus: "widget" })], source: "run-journal" }),
      ],
      states: noState,
      tsIso,
      window,
    });
    const line = renderBriefLines({ brief }).find((one) => one.includes("already on the board"))!;
    expect(line).toContain("and 3 more");
  });
});

describe("mineSubstrates and readCoverage", () => {
  it("runs one collector per source, in the order a brief prints them", () => {
    const paths = reflectPaths({ claudeHome: "/claude", home: "/state", reader: fakeReader({ files: {} }) });
    const readings = mineSubstrates({
      doorFriction: ok([]),
      ownerJudgement: { directives: [], kind: "loaded" },
      paths,
      reader: fakeReader({ files: {} }),
      window,
    });
    expect(readings.map((one) => one.source)).toStrictEqual([...REFLECT_SOURCES]);
  });

  it("reads the board and every discovered memory corpus", () => {
    const files = {
      "/claude/projects/alpha/memory/known-thing.md": "a known thing",
      "/state/handovers/a-doc.md": "a doc",
    };
    const reader = fakeReader({ files });
    const paths = reflectPaths({ claudeHome: "/claude", home: "/state", reader });
    const coverage = readCoverage({ paths, reader });
    expect(coverage.board.map((one) => one.id)).toStrictEqual(["a-doc"]);
    expect(coverage.memory.map((one) => one.id)).toStrictEqual(["known-thing"]);
  });
});
