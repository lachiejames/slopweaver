import { describe, expect, it } from "vitest";

import { type FrictionFinding, findingId, type ReflectSource } from "../../../reflect/finding.js";
import { byRank, PER_SOURCE_CAP, prepareCandidates, rankFindings, SURFACE_CAP } from "../../../reflect/rank.js";
import { foldSeenLedger, type SeenRow, type SeenState } from "../../../reflect/seen.js";

const finding = (over: Partial<FrictionFinding> = {}): FrictionFinding => ({
  classKey: "a-class",
  consequence: "a measured cost",
  cost: 2,
  coveredBy: [],
  evidence: [],
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

/** N findings of one source, each with its own class so each gets its own id. */
const spread = ({ source, count, impact = 3 }: { source: ReflectSource; count: number; impact?: number }) =>
  Array.from({ length: count }, (_, index) => finding({ classKey: `${source}-${String(index)}`, impact, source }));

const noState: ReadonlyMap<string, SeenState> = new Map();

/** The instant every prepared run here takes as "now" — a day after the recurrence fixtures end. */
const RUN_TS = "2026-08-27T06:30:00.000Z";

describe("prepareCandidates", () => {
  it("gives a first sighting a day count of one", () => {
    const [candidate] = prepareCandidates({ tsIso: RUN_TS, findings: [finding()], states: noState });
    expect(candidate!.daysSeen).toBe(1);
  });

  it("scores impact times safety over cost", () => {
    const [candidate] = prepareCandidates({
      tsIso: RUN_TS,
      findings: [finding({ cost: 2, impact: 3, safety: 4 })],
      states: noState,
    });
    expect(candidate!.score).toBe(6);
  });

  it("carries the pre-recurrence impact separately from the lifted one", () => {
    const [candidate] = prepareCandidates({
      tsIso: RUN_TS,
      findings: [finding({ impact: 3, occurrences: 4 })],
      states: noState,
    });
    expect(candidate!.baseImpact).toBe(3);
    expect(candidate!.finding.impact).toBe(4);
  });

  it("REFUSES a finding a drop already ended, terminally", () => {
    const dropped = finding();
    const id = findingId({ signal: dropped });
    const rows: readonly SeenRow[] = [
      {
        classKey: "a-class",
        disposition: "surfaced",
        id,
        locus: "a locus",
        occurrences: 1,
        source: "run-journal",
        tsIso: "2026-08-26T01:00:00.000Z",
      },
      {
        classKey: "a-class",
        disposition: "drop",
        id,
        locus: "a locus",
        occurrences: 1,
        source: "run-journal",
        tsIso: "2026-08-26T02:00:00.000Z",
      },
      {
        classKey: "a-class",
        disposition: "surfaced",
        id,
        locus: "a locus",
        occurrences: 1,
        source: "run-journal",
        tsIso: "2026-08-27T01:00:00.000Z",
      },
    ];
    expect(prepareCandidates({ tsIso: RUN_TS, findings: [dropped], states: foldSeenLedger({ rows }) })).toHaveLength(0);
  });

  it("carries the persisted recurrence into the lift", () => {
    const recurring = finding({ impact: 2 });
    const id = findingId({ signal: recurring });
    const rows: readonly SeenRow[] = ["2026-08-24", "2026-08-25", "2026-08-26"].map((day) => ({
      classKey: "a-class",
      disposition: "backlogged" as const,
      id,
      locus: "a locus",
      occurrences: 1,
      source: "run-journal" as const,
      tsIso: `${day}T01:00:00.000Z`,
    }));
    const [candidate] = prepareCandidates({ tsIso: RUN_TS, findings: [recurring], states: foldSeenLedger({ rows }) });
    expect(candidate!.daysSeen).toBe(4);
    expect(candidate!.finding.impact).toBe(3);
  });

  it("counts today once when this morning's run already sighted it — a second brief the same day is not a second day", () => {
    const recurring = finding({ impact: 2 });
    const id = findingId({ signal: recurring });
    const rows: readonly SeenRow[] = ["2026-08-26T01:00:00.000Z", "2026-08-27T06:30:00.000Z"].map((tsIso) => ({
      classKey: "a-class",
      disposition: "backlogged" as const,
      id,
      locus: "a locus",
      occurrences: 1,
      source: "run-journal" as const,
      tsIso,
    }));
    const [candidate] = prepareCandidates({
      findings: [recurring],
      states: foldSeenLedger({ rows }),
      tsIso: "2026-08-27T15:00:00.000Z",
    });
    expect(candidate!.daysSeen).toBe(2);
  });

  it("counts today once even when today's sighting was appended BEFORE yesterday's — date order, not file order", () => {
    const recurring = finding({ impact: 2 });
    const id = findingId({ signal: recurring });
    const rows: readonly SeenRow[] = ["2026-08-27T00:01:00.000Z", "2026-08-26T23:59:00.000Z"].map((tsIso) => ({
      classKey: "a-class",
      disposition: "backlogged" as const,
      id,
      locus: "a locus",
      occurrences: 1,
      source: "run-journal" as const,
      tsIso,
    }));
    const [candidate] = prepareCandidates({
      findings: [recurring],
      states: foldSeenLedger({ rows }),
      tsIso: "2026-08-27T15:00:00.000Z",
    });
    expect(candidate!.daysSeen).toBe(2);
  });

  it("still counts today when the only row dated today is a GRADE, which is not a sighting", () => {
    const recurring = finding({ impact: 2 });
    const id = findingId({ signal: recurring });
    const rows: readonly SeenRow[] = [
      {
        classKey: "a-class",
        disposition: "surfaced",
        id,
        locus: "a locus",
        occurrences: 1,
        source: "run-journal",
        tsIso: "2026-08-26T06:30:00.000Z",
      },
      {
        classKey: "a-class",
        disposition: "keep",
        id,
        locus: "a locus",
        occurrences: 1,
        source: "run-journal",
        tsIso: "2026-08-27T02:00:00.000Z",
      },
    ];
    const [candidate] = prepareCandidates({
      findings: [recurring],
      states: foldSeenLedger({ rows }),
      tsIso: "2026-08-27T06:30:00.000Z",
    });
    expect(candidate!.daysSeen).toBe(2);
  });
});

describe("byRank", () => {
  it("orders by score descending", () => {
    const candidates = prepareCandidates({
      tsIso: RUN_TS,
      findings: [
        finding({ classKey: "low", cost: 5, impact: 1, safety: 1 }),
        finding({ classKey: "high", cost: 1, impact: 5, safety: 5 }),
      ],
      states: noState,
    });
    expect(byRank({ candidates }).map((one) => one.finding.classKey)).toStrictEqual(["high", "low"]);
  });

  it("breaks a tie on the content-hash id, not on input order", () => {
    const candidates = prepareCandidates({
      tsIso: RUN_TS,
      findings: [finding({ classKey: "alpha" }), finding({ classKey: "beta" })],
      states: noState,
    });
    const forwards = byRank({ candidates }).map((one) => one.id);
    const backwards = byRank({ candidates: candidates.toReversed() }).map((one) => one.id);
    expect(forwards).toStrictEqual(backwards);
    expect(forwards).toStrictEqual([...forwards].toSorted((a, b) => a.localeCompare(b)));
  });
});

describe("rankFindings", () => {
  it("surfaces at most the cap and backlogs the rest", () => {
    const candidates = prepareCandidates({
      tsIso: RUN_TS,
      findings: [
        ...spread({ count: 4, source: "run-journal" }),
        ...spread({ count: 4, source: "dev-gate" }),
        ...spread({ count: 4, source: "pain-points" }),
      ],
      states: noState,
    });
    const selection = rankFindings({ candidates });
    expect(selection.surfaced).toHaveLength(SURFACE_CAP);
    expect(selection.backlog).toHaveLength(7);
  });

  it("never lets one collector take more than its share, even when it is the only one", () => {
    const candidates = prepareCandidates({
      tsIso: RUN_TS,
      findings: spread({ count: 9, source: "run-journal" }),
      states: noState,
    });
    const selection = rankFindings({ candidates });
    expect(selection.surfaced).toHaveLength(PER_SOURCE_CAP);
    expect(selection.backlog).toHaveLength(7);
    expect(selection.heldBySource).toStrictEqual([{ held: 7, source: "run-journal" }]);
  });

  it("lets a quiet substrate through that a noisy one would otherwise have crowded out", () => {
    const candidates = prepareCandidates({
      tsIso: RUN_TS,
      findings: [
        ...spread({ count: 20, impact: 5, source: "run-journal" }),
        finding({ classKey: "quiet", impact: 1, safety: 1, source: "pain-points" }),
      ],
      states: noState,
    });
    const selection = rankFindings({ candidates });
    expect(selection.surfaced.map((one) => one.finding.source)).toStrictEqual([
      "run-journal",
      "run-journal",
      "pain-points",
    ]);
  });

  it("keeps the backlog in rank order rather than re-sorting what the share held back", () => {
    const candidates = prepareCandidates({
      tsIso: RUN_TS,
      findings: [
        ...spread({ count: 3, impact: 5, source: "run-journal" }),
        finding({ classKey: "mid", impact: 2, safety: 2, source: "dev-gate" }),
      ],
      states: noState,
    });
    const selection = rankFindings({ candidates, cap: 2, perSourceCap: 1 });
    const ranked = byRank({ candidates }).map((one) => one.id);
    const surfaced = new Set(selection.surfaced.map((one) => one.id));
    expect(selection.backlog.map((one) => one.id)).toStrictEqual(ranked.filter((id) => !surfaced.has(id)));
    expect(selection.heldBySource).toStrictEqual([{ held: 2, source: "run-journal" }]);
  });

  it("reports no held source when the cap alone decided", () => {
    const candidates = prepareCandidates({
      tsIso: RUN_TS,
      findings: [finding({ classKey: "a", source: "run-journal" }), finding({ classKey: "b", source: "dev-gate" })],
      states: noState,
    });
    expect(rankFindings({ candidates }).heldBySource).toStrictEqual([]);
  });

  it("returns an empty selection for a day with nothing to say", () => {
    const selection = rankFindings({ candidates: [] });
    expect(selection.surfaced).toStrictEqual([]);
    expect(selection.backlog).toStrictEqual([]);
    expect(selection.heldBySource).toStrictEqual([]);
    expect(selection.heldUnmeasured).toBe(0);
  });
});

describe("rankFindings: a finding that cannot state its cost is never put in front of the owner", () => {
  const prepared = ({ findings }: { findings: readonly FrictionFinding[] }) =>
    prepareCandidates({ findings, states: noState, tsIso: RUN_TS });

  it("holds an unmeasured finding in the backlog however high it ranks, and counts it", () => {
    const candidates = prepared({
      findings: [
        finding({ classKey: "loud", consequence: undefined, impact: 5, safety: 5 }),
        finding({ classKey: "measured", impact: 1, safety: 1 }),
      ],
    });
    const selection = rankFindings({ candidates });
    expect(selection.surfaced.map((one) => one.finding.classKey)).toStrictEqual(["measured"]);
    expect(selection.backlog.map((one) => one.finding.classKey)).toStrictEqual(["loud"]);
    expect(selection.heldUnmeasured).toBe(1);
  });

  it("treats a blank consequence as none", () => {
    const selection = rankFindings({ candidates: prepared({ findings: [finding({ consequence: "  " })] }) });
    expect(selection.surfaced).toStrictEqual([]);
    expect(selection.heldUnmeasured).toBe(1);
  });

  it("lets a held finding take no slot of its source's share, so a measured one from that source still surfaces", () => {
    const candidates = prepared({
      findings: [
        ...Array.from({ length: PER_SOURCE_CAP }, (_, index) =>
          finding({ classKey: `held-${String(index)}`, consequence: undefined, impact: 5 }),
        ),
        finding({ classKey: "measured", impact: 1 }),
      ],
    });
    expect(rankFindings({ candidates }).surfaced.map((one) => one.finding.classKey)).toStrictEqual(["measured"]);
  });
});
