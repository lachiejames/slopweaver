/** The velocity and friction documents turned into the tick's velocity and friction observations. */
import { describe, expect, it } from "vitest";

import { unwrapErr } from "../../../../lib/result.js";
import { draftTickSources } from "../../../../supervisor/tickDraftSources.js";
import { CAPTURED, diagnosticOf, factsOf, redirected, STARTED, sourcesWith } from "../tickDraftSourcesFixture.js";

describe("draftTickSources — velocity and friction", () => {
  it("takes today's landed count from the producer's own UTC bucket", () => {
    const capture = redirected({
      path: "velocity.json",
      value: {
        caution: '"faster does not necessarily equal better"',
        docsLandedByDay: [
          { dayKey: "2026-09-11", landed: 8 },
          { dayKey: "2026-09-12", landed: 31 },
        ],
        docsLandedTotal: 39,
      },
    });
    const sources = sourcesWith({ capture, kind: "velocity" });

    expect(factsOf({ observation: sources.velocity })).toStrictEqual({
      caution: '"faster does not necessarily equal better"',
      docsLandedToday: 31,
    });
  });

  it("is unavailable — not zero — when the window has no bucket for the tick's own UTC day", () => {
    const capture = redirected({
      path: "velocity.json",
      value: { caution: "c", docsLandedByDay: [{ dayKey: "2026-09-11", landed: 8 }] },
    });
    const sources = sourcesWith({ capture, kind: "velocity" });

    expect(sources.velocity.status).toBe("unavailable");
    expect(diagnosticOf({ observation: sources.velocity })).toBe(
      "the report has no 2026-09-12 bucket (its days are UTC), so today's landed count is unknown",
    );
  });

  it("carries the friction review's date, null included", () => {
    const capture = redirected({
      path: "friction.json",
      value: { hasGap: false, isStale: false, latestReportDate: null, marked: false, publishedDate: null },
    });
    const sources = sourcesWith({ capture, kind: "friction" });

    expect(factsOf({ observation: sources.friction })).toStrictEqual({
      hasGap: false,
      isStale: false,
      newestReport: null,
    });
  });

  // The reading: the producer had been dead for seventeen days and `hasGap` was false, so
  // `isStale` is the only field carrying the fact the briefing needs. A mapper that dropped it would leave
  // the tick reporting the same false green the verb used to.
  it("carries a stale producer alongside a closed gap", () => {
    const capture = redirected({
      path: "friction.json",
      value: {
        hasGap: false,
        isStale: true,
        latestReportDate: "2026-09-03",
        marked: false,
        publishedDate: "2026-09-03",
      },
    });
    const sources = sourcesWith({ capture, kind: "friction" });

    expect(factsOf({ observation: sources.friction })).toStrictEqual({
      hasGap: false,
      isStale: true,
      newestReport: "2026-09-03",
    });
  });

  it("refuses a friction document that does not say whether the producer is alive", () => {
    const capture = redirected({
      path: "friction.json",
      value: { hasGap: false, latestReportDate: "2026-09-03", marked: false, publishedDate: "2026-09-03" },
    });
    const refusal = unwrapErr(
      draftTickSources({ capturedIso: CAPTURED, captures: { friction: capture }, startedIso: STARTED }),
    );

    expect(refusal.some((line) => line.includes("--friction friction.json"))).toBe(true);
  });
});
