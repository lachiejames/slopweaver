import { describe, expect, it } from "vitest";

import { LEAD_CEILING, MAX_DETECTIVES, planWave } from "../../../detective/fanout.js";
import { orderCells, type ProbeCell, type ProbeReport } from "../../../store/probe/result.js";
import type { ProbeShape } from "../../../store/probe/shapes.js";

/** One cell of a ladder, built from just the per-source counts a test cares about. */
const cell = ({
  shape,
  bySource,
}: {
  shape: ProbeShape;
  bySource: readonly { source: string; rows: number }[];
}): ProbeCell => ({
  bySource,
  ids: null,
  indexed: true,
  rows: bySource.reduce((total, count) => total + count.rows, 0),
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

describe("planWave", () => {
  it("always spawns the discovery detective, even when the probe found nothing anywhere", () => {
    const wave = planWave({
      probe: report({ rows: [{ cells: [cell({ bySource: [], shape: "exact" })], subject: "x" }] }),
    });
    expect(wave.detectives).toBe(1);
    expect(wave.leads[0]?.keyword).toBe(null);
    expect(wave.leads[0]?.source).toBe(null);
  });

  it("makes ONE lead per (keyword, source), never one per shape", () => {
    const wave = planWave({
      probe: report({
        rows: [
          {
            cells: [
              cell({ bySource: [{ rows: 3, source: "github" }], shape: "exact" }),
              cell({ bySource: [{ rows: 9, source: "github" }], shape: "alnum" }),
              cell({ bySource: [{ rows: 11, source: "github" }], shape: "wild-both" }),
            ],
            subject: "17000",
          },
        ],
      }),
    });
    expect(wave.detectives).toBe(2);
    expect(wave.leads.filter((lead) => lead.source === "github")).toHaveLength(1);
  });

  it("starts each lead at the NARROWEST shape that found rows in its own source", () => {
    const wave = planWave({
      probe: report({
        rows: [
          {
            cells: [
              cell({ bySource: [{ rows: 3, source: "github" }], shape: "exact" }),
              cell({
                bySource: [
                  { rows: 9, source: "github" },
                  { rows: 4, source: "slack" },
                ],
                shape: "alnum",
              }),
            ],
            subject: "17000",
          },
        ],
      }),
    });
    const github = wave.leads.find((lead) => lead.source === "github");
    const slack = wave.leads.find((lead) => lead.source === "slack");
    expect(github?.startShape).toBe("exact");
    expect(github?.rows).toBe(3);
    expect(slack?.startShape).toBe("alnum");
    expect(slack?.rows).toBe(4);
  });

  it("derives four detectives from three positive leads plus discovery", () => {
    const wave = planWave({
      probe: report({
        rows: [
          {
            cells: [
              cell({
                bySource: [
                  { rows: 3, source: "github" },
                  { rows: 4, source: "slack" },
                  { rows: 5, source: "linear" },
                ],
                shape: "exact",
              }),
            ],
            subject: "17000",
          },
        ],
      }),
    });
    expect(wave.detectives).toBe(4);
  });

  it("derives eight detectives from seven positive leads plus discovery", () => {
    const wave = planWave({
      probe: report({
        rows: [1, 2, 3, 4, 5, 6, 7].map((index) => ({
          cells: [cell({ bySource: [{ rows: index, source: `source-${String(index)}` }], shape: "exact" })],
          subject: `term-${String(index)}`,
        })),
      }),
    });
    expect(wave.detectives).toBe(8);
  });

  it("holds the wave at the ceiling and DEFERS the rest rather than dropping them", () => {
    const wave = planWave({
      probe: report({
        rows: Array.from({ length: 40 }, (_unused, index) => ({
          cells: [cell({ bySource: [{ rows: 1, source: `source-${String(index)}` }], shape: "exact" })],
          subject: `term-${String(index)}`,
        })),
      }),
    });
    expect(wave.detectives).toBe(MAX_DETECTIVES);
    expect(wave.deferred).toHaveLength(11);
  });

  it("narrows to the caller's own remaining capacity when it is smaller than the ceiling", () => {
    const wave = planWave({
      probe: report({
        rows: Array.from({ length: 10 }, (_unused, index) => ({
          cells: [cell({ bySource: [{ rows: 1, source: `source-${String(index)}` }], shape: "exact" })],
          subject: `term-${String(index)}`,
        })),
      }),
      slots: 3,
    });
    expect(wave.detectives).toBe(3);
    expect(wave.deferred).toHaveLength(8);
  });

  it("keeps a cell above the lead ceiling OUT of the wave and says how to split it", () => {
    const wave = planWave({
      probe: report({
        rows: [
          {
            cells: [cell({ bySource: [{ rows: LEAD_CEILING + 1, source: "slack" }], shape: "wild-both" })],
            subject: "datadog",
          },
        ],
      }),
    });
    expect(wave.detectives).toBe(1);
    expect(wave.tooWide).toHaveLength(1);
    expect(wave.tooWide[0]?.why).toContain("store groups");
  });

  it("names the probed cell's own keyword, source and shape in a too-wide lead's split command", () => {
    const wave = planWave({
      probe: report({
        rows: [
          {
            cells: [cell({ bySource: [{ rows: LEAD_CEILING + 1, source: "linear" }], shape: "exact" })],
            subject: "sso",
          },
        ],
      }),
    });
    expect(wave.tooWide[0]!.why).toBe(
      `${String(LEAD_CEILING + 1)} linear record(s) — too wide to read; split it first with ` +
        '`slopweaver store groups --term "sso" --shape exact --facet container`',
    );
  });

  it("spends a scarce slot on the source with most to read, not on a one-record lead", () => {
    const wave = planWave({
      probe: report({
        rows: [
          {
            cells: [
              cell({
                bySource: [
                  { rows: 1, source: "github" },
                  { rows: 1, source: "gmail" },
                  { rows: 17, source: "slack" },
                ],
                shape: "exact",
              }),
            ],
            subject: "barten",
          },
        ],
      }),
      slots: 2,
    });
    expect(wave.leads.map((lead) => lead.source)).toEqual([null, "slack"]);
  });

  it("covers every source once before taking a second lead from any of them", () => {
    const wave = planWave({
      probe: report({
        rows: [
          {
            cells: [
              cell({
                bySource: [
                  { rows: 1, source: "slack" },
                  { rows: 2, source: "linear" },
                ],
                shape: "exact",
              }),
            ],
            subject: "alpha",
          },
          {
            cells: [
              cell({
                bySource: [
                  { rows: 3, source: "slack" },
                  { rows: 4, source: "linear" },
                ],
                shape: "exact",
              }),
            ],
            subject: "beta",
          },
        ],
      }),
    });
    const sources = wave.leads.slice(1).map((lead) => lead.source);
    expect(sources).toEqual(["linear", "slack", "linear", "slack"]);
  });
});
