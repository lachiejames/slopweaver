import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { findingId, REFLECT_SOURCES } from "../../../reflect/finding.js";
import {
  type GradeInput,
  gradeDistributionBySource,
  gradeHistoryLine,
  planGrade,
  recordGrade,
} from "../../../reflect/grades.js";
import { prepareCandidates } from "../../../reflect/rank.js";
import { foldSeenLedger, parseSeenRows, recordSeen, reflectLedgerDir, type SeenRow } from "../../../reflect/seen.js";

// Every fixture home this file has minted, so `afterEach` can remove them.
/** The instant the prepared run below takes as "now". */
const RUN_TS = "2026-09-16T06:30:00.000Z";

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const SIGNAL = { classKey: "donewhen-probe-named-a-flag", locus: "handover amend", source: "run-journal" } as const;
const ID = findingId({ signal: SIGNAL });

const sighting = (over: Partial<SeenRow> = {}): SeenRow => ({
  ...SIGNAL,
  disposition: "surfaced",
  id: ID,
  occurrences: 6,
  tsIso: "2026-09-14T06:30:00.000Z",
  ...over,
});

const input = (over: Partial<GradeInput> = {}): GradeInput => ({
  grade: "keep",
  id: ID,
  tsIso: "2026-09-15T09:00:00.000Z",
  ...over,
});

const homeWith = ({ rows }: { rows: readonly SeenRow[] }): string => {
  const home = mkdtempSync(join(tmpdir(), "reflect-grades-"));
  fixtureDirs.push(home);
  unwrap(recordSeen({ home, rows }));
  return home;
};

describe("planGrade", () => {
  it("copies the finding's identity from the fold and records no occurrences, because a grade is not a sighting", () => {
    const plan = unwrap(
      planGrade({ input: input({ why: "worth it" }), states: foldSeenLedger({ rows: [sighting()] }) }),
    );
    expect(plan.row).toStrictEqual({
      ...SIGNAL,
      disposition: "keep",
      id: ID,
      occurrences: 0,
      tsIso: "2026-09-15T09:00:00.000Z",
      why: "worth it",
    });
    expect(plan.priorSurfacings).toBe(1);
    expect(plan.stillDropped).toBe(false);
  });

  it("carries what closed it", () => {
    const plan = unwrap(
      planGrade({ input: input({ closedBy: "#740" }), states: foldSeenLedger({ rows: [sighting()] }) }),
    );
    expect(plan.row.closedBy).toBe("#740");
  });

  it("refuses an id the ledger has never seen, and says where ids come from", () => {
    const plan = planGrade({ input: input({ id: "000000000000" }), states: foldSeenLedger({ rows: [sighting()] }) });
    expect(plan._unsafeUnwrapErr()[0]).toContain("no finding 000000000000");
    expect(plan._unsafeUnwrapErr()[0]).toContain("reflect brief");
  });

  it("names a keep on a dropped finding as still dropped rather than implying it revived", () => {
    const rows = [sighting(), sighting({ disposition: "drop", occurrences: 0 })];
    expect(unwrap(planGrade({ input: input(), states: foldSeenLedger({ rows }) })).stillDropped).toBe(true);
  });

  it("does not call a second drop still dropped — it is the same word again", () => {
    const rows = [sighting(), sighting({ disposition: "drop", occurrences: 0 })];
    expect(unwrap(planGrade({ input: input({ grade: "drop" }), states: foldSeenLedger({ rows }) })).stillDropped).toBe(
      false,
    );
  });
});

describe("recordGrade", () => {
  it("appends exactly one grade row to the seen ledger", () => {
    const home = homeWith({ rows: [sighting()] });
    unwrap(recordGrade({ home, input: input({ closedBy: "#740", grade: "adjust" }) }));
    const rows = parseSeenRows({ text: readFileSync(join(reflectLedgerDir({ home }), "seen.jsonl"), "utf8") });
    expect(rows.map((row) => row.disposition)).toStrictEqual(["surfaced", "adjust"]);
    expect(rows[1]!.closedBy).toBe("#740");
  });

  it("writes nothing for an unknown id", () => {
    const home = homeWith({ rows: [sighting()] });
    expect(recordGrade({ home, input: input({ id: "000000000000" }) })._unsafeUnwrapErr()[0]).toContain("no finding");
    const rows = parseSeenRows({ text: readFileSync(join(reflectLedgerDir({ home }), "seen.jsonl"), "utf8") });
    expect(rows).toHaveLength(1);
  });

  it("makes a written drop stick: the miner's own candidate preparation never proposes it again", () => {
    const home = homeWith({ rows: [sighting()] });
    unwrap(recordGrade({ home, input: input({ grade: "drop" }) }));
    const states = foldSeenLedger({
      rows: parseSeenRows({ text: readFileSync(join(reflectLedgerDir({ home }), "seen.jsonl"), "utf8") }),
    });
    const finding = {
      ...SIGNAL,
      consequence: "a measured cost",
      cost: 1,
      coveredBy: [],
      evidence: [],
      firstSeenIso: "2026-09-16T06:00:00.000Z",
      impact: 3,
      lastSeenIso: "2026-09-16T06:10:00.000Z",
      knownBy: [],
      occurrences: 4,
      refutedBy: [],
      safety: 1,
      summary: "a probe named a flag that does not exist",
    };
    expect(prepareCandidates({ tsIso: RUN_TS, findings: [finding], states })).toStrictEqual([]);
  });

  it("moves the per-source grade line the next brief prints", () => {
    const home = homeWith({ rows: [sighting()] });
    unwrap(recordGrade({ home, input: input({ grade: "drop" }) }));
    const states = foldSeenLedger({
      rows: parseSeenRows({ text: readFileSync(join(reflectLedgerDir({ home }), "seen.jsonl"), "utf8") }),
    });
    expect(gradeDistributionBySource({ states })[0]).toStrictEqual({
      adjust: 0,
      drop: 1,
      keep: 0,
      source: "run-journal",
    });
  });
});

describe("gradeDistributionBySource", () => {
  it("reports every source, zeros included, so a silent collector is visible", () => {
    expect(gradeDistributionBySource({ states: foldSeenLedger({ rows: [] }) })).toHaveLength(REFLECT_SOURCES.length);
  });

  it("counts findings under their latest grade, not rows", () => {
    const rows = [
      sighting({ disposition: "adjust" }),
      sighting({ disposition: "keep" }),
      sighting({ disposition: "drop", id: "other", source: "dev-gate" }),
    ];
    const tally = gradeDistributionBySource({ states: foldSeenLedger({ rows }) });
    expect(tally[0]).toStrictEqual({ adjust: 0, drop: 0, keep: 1, source: "run-journal" });
    expect(tally[2]).toStrictEqual({ adjust: 0, drop: 1, keep: 0, source: "dev-gate" });
  });
});

describe("gradeHistoryLine", () => {
  it("prints nothing for a finding the owner has never graded", () => {
    const line = gradeHistoryLine({
      closedAtIso: undefined,
      closedBy: undefined,
      grade: undefined,
      lastSightingIso: "2026-09-16T06:30:00.000Z",
    });
    expect(line).toBeUndefined();
  });

  it("prints the bare grade when nothing closed it", () => {
    const line = gradeHistoryLine({
      closedAtIso: undefined,
      closedBy: undefined,
      grade: "adjust",
      lastSightingIso: "2026-09-16T06:30:00.000Z",
    });
    expect(line).toBe("     history: graded adjust");
  });

  it("calls a sighting after the closing grade a regression", () => {
    const line = gradeHistoryLine({
      closedAtIso: "2026-09-15T09:00:00.000Z",
      closedBy: "#740",
      grade: "keep",
      lastSightingIso: "2026-09-16T06:30:00.000Z",
    });
    expect(line).toBe(
      "     history: graded keep; closed by #740 at 2026-09-15T09:00:00.000Z — SEEN AGAIN since, read it as a regression",
    );
  });

  it("does not call it a regression when the closure is not older than the sighting", () => {
    const line = gradeHistoryLine({
      closedAtIso: "2026-09-16T06:30:00.000Z",
      closedBy: "#740",
      grade: "keep",
      lastSightingIso: "2026-09-16T06:30:00.000Z",
    });
    expect(line).toBe("     history: graded keep; closed by #740 at 2026-09-16T06:30:00.000Z");
  });
});
