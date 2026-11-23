/** {@link renderSpendReport} and {@link spendFindingAsk} — the seat's text and the board row's one line. */
import { describe, expect, it } from "vitest";

import { measured, unmeasurable } from "../../../measurement/status.js";
import { zeroRefusals } from "../../../sessions/spendFold.js";
import { renderSpendReport, spendFindingAsk } from "../../../sessions/spendRender.js";
import { spendReport } from "../../../sessions/spendReport.js";
import type { SpendSignal } from "../../../sessions/spendSignal.js";

/** A one-day report: an Opus 5.5 seat and a Fable chair that refused twice, four changes landed. */
const report = spendReport({
  days: ["2026-09-27"],
  landings: measured({ value: [{ day: "2026-09-27", landed: 4 }] }),
  observedAtIso: "2026-09-28T05:30:00.000Z",
  repos: ["o/r"],
  transcripts: [
    {
      contextFloor: 1_000,
      cwd: "/w/acme",
      path: "/p/a.jsonl",
      refusals: zeroRefusals(),
      seat: "handover-seat",
      unreadable: 0,
      usage: [
        {
          day: "2026-09-27",
          model: "claude-opus-5-5",
          totals: { cacheCreationTokens: 0, cacheReadTokens: 100_000, inputTokens: 0, outputTokens: 1_000, turns: 10 },
        },
      ],
    },
    {
      contextFloor: 1_000,
      cwd: "/w/acme",
      path: "/p/b.jsonl",
      refusals: { ...zeroRefusals(), python: 2 },
      seat: "chair",
      unreadable: 1,
      usage: [
        {
          day: "2026-09-27",
          model: "claude-fable-5-1",
          totals: { cacheCreationTokens: 0, cacheReadTokens: 100_000, inputTokens: 0, outputTokens: 1_000, turns: 2 },
        },
      ],
    },
  ],
});

const steady: SpendSignal = { because: "moved 1.0%", carried: [], post: [], trend: "steady" };

describe("renderSpendReport", () => {
  const lines = renderSpendReport({ report, signal: steady });

  it("heads with the window, the draw and the cost of a landed change", () => {
    expect(lines.slice(0, 3)).toEqual([
      "token pass 2026-09-27..2026-09-27 UTC · 2 transcripts · 12 turns · 57.5ku (" + report.rateCard.id + ")",
      "14.4ku per landed change (4 landed, 57.5ku drawn)",
      "trend: steady — moved 1.0%",
    ]);
  });

  it("names the refusals by class and the unreadable spend", () => {
    expect(lines).toContain("gate refusals: 2 (python 2)");
    expect(lines.at(-1)).toBe("1 usage line(s) could not be read — that spend is missing above.");
  });

  it("says a landed change was not measured, and why", () => {
    const unmeasured = renderSpendReport({
      report: { ...report, drains: [], landingCost: unmeasurable({ why: "rate limited" }) },
      signal: steady,
    });
    expect(unmeasured[1]).toBe("units per landed change NOT MEASURED — rate limited");
    expect(unmeasured).toContain("  none priced");
  });

  it("names no classes when nothing was refused", () => {
    expect(renderSpendReport({ report: { ...report, refusals: zeroRefusals() }, signal: steady })).toContain(
      "gate refusals: 0",
    );
  });
});

describe("spendFindingAsk", () => {
  it("leads with a realised trend, then each drain to post", () => {
    const drain = report.drains.find((entry) => entry.key === "refusals")!;
    const signal: SpendSignal = {
      because: "units per landed change fell 30.0%",
      carried: [],
      post: [drain],
      trend: "win",
    };
    expect(spendFindingAsk({ report, signal })).toBe(
      "Token pass: 14.4ku per landed change (4 landed, 57.5ku drawn): units per landed change fell 30.0%. " +
        `16.7% of the window's draw: ${drain.what}. Fix: ${drain.fix}.`,
    );
  });
});
