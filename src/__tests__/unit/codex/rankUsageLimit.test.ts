/**
 * The Codex ranking under the owner's per-plan usage limit and the NOT MEASURED monthly-spend allowance.
 *
 * Split from `rank.test.ts`; both build their observations with `rankFixtures.ts`.
 */
import { describe, expect, it } from "vitest";

import { CODEX_MONTHLY_SPEND_NOT_MEASURED, type UsageLimitPercent } from "../../../plans/usageLimit.js";
import { gauge, NOW, OBSERVED, observation, rankCodexPlans, weeklyAt, window } from "./rankFixtures.js";

describe("the owner's usage limit — a weekly ceiling no flag crosses", () => {
  const RESET = "2026-09-29T12:00:00.000Z";

  /** The aliases one weekly reading on a row with the given limit leaves ranked, and the exclusion kinds. */
  function judged({ percent, usageLimitPercent }: { percent: number; usageLimitPercent: UsageLimitPercent }): {
    ranked: readonly string[];
    excluded: readonly string[];
  } {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [weeklyAt({ alias: "codex-limited", percent, usageLimitPercent })],
    });
    return {
      excluded: ranking.excluded.map((exclusion) => exclusion.kind),
      ranked: ranking.ranked.map((destination) => destination.alias),
    };
  }

  it("excludes a week at exactly 30% on a 30 row as usage-limit, saying it is the owner's limit and no cap evidence", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [weeklyAt({ alias: "codex-limited", percent: 30, usageLimitPercent: 30 })],
    });

    expect(ranking.ranked).toEqual([]);
    expect(ranking.deferredUnmeasured).toEqual([]);
    expect(ranking.excluded).toEqual([
      {
        destination: { alias: "codex-limited", codexHome: "/homes/codex-limited" },
        kind: "usage-limit",
        reason:
          `weekly window at 30% used, at this plan's 30% usage limit (it resets ${RESET}) — the owner's own ` +
          "limit, not provider cap evidence, and no --force crosses it",
      },
    ]);
  });

  it("compares the raw, unrounded percentage with >=, so 29.9999999 ranks and 30.0000001 does not", () => {
    expect(judged({ percent: 29.9999999, usageLimitPercent: 30 })).toEqual({ excluded: [], ranked: ["codex-limited"] });
    expect(judged({ percent: 30.0000001, usageLimitPercent: 30 })).toEqual({ excluded: ["usage-limit"], ranked: [] });
  });

  it("ranks the same 30% reading once only the limit moves to 40, and excludes it at 40", () => {
    expect(judged({ percent: 30, usageLimitPercent: 40 })).toEqual({ excluded: [], ranked: ["codex-limited"] });
    expect(judged({ percent: 39.99, usageLimitPercent: 40 })).toEqual({ excluded: [], ranked: ["codex-limited"] });
    expect(judged({ percent: 40, usageLimitPercent: 40 })).toEqual({ excluded: ["usage-limit"], ranked: [] });
  });

  it("leaves a 100 row to the house bar, so 99% there is near-cap and never relabelled usage-limit", () => {
    expect(judged({ percent: 98.99, usageLimitPercent: 100 })).toEqual({ excluded: [], ranked: ["codex-limited"] });
    expect(judged({ percent: 99, usageLimitPercent: 100 })).toEqual({ excluded: ["near-cap"], ranked: [] });
  });

  it("never applies the weekly limit to the five-hour window", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [
        observation({
          alias: "codex-burst",
          gauge: gauge({
            windows: [
              window({ usedPercent: 10 }),
              window({
                label: "five-hour",
                resetAtIso: "2026-09-22T14:00:00.000Z",
                slot: "secondary",
                usedPercent: 30,
                windowMinutes: 300,
              }),
            ],
          }),
          usageLimitPercent: 30,
        }),
      ],
    });

    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-burst"]);
    expect(ranking.excluded).toEqual([]);
  });

  it("runs the level line to the effective ceiling, so a 30 row half a week in is near its line, not far behind", () => {
    // Both weeks are half spent (reset 3.5 days out). The 30 row's line stands at 15, so 14% is 1 behind; the 100
    // row's at 49.5, so 40% is 9.5 behind. Run to 99, the 30 row's line would also stand at 49.5 — 35.5 behind —
    // and it would take the spawn until its limit itself caught it.
    const reset = "2026-09-26T00:00:00.000Z";
    const limited = observation({
      alias: "codex-thirty",
      gauge: gauge({ windows: [window({ resetAtIso: reset, usedPercent: 14 })] }),
      usageLimitPercent: 30,
    });
    const whole = observation({
      alias: "codex-whole",
      gauge: gauge({ windows: [window({ resetAtIso: reset, usedPercent: 40 })] }),
    });

    const ranking = rankCodexPlans({ nowIso: NOW, observations: [limited, whole] });

    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-whole", "codex-thirty"]);
  });

  it("keeps an UNDATED weekly reading at the limit out, and one whose reset has passed until a fresh read", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [
        // Built by hand: `window()` defaults an undefined reset back to a real one.
        observation({
          alias: "codex-undated",
          gauge: gauge({
            windows: [
              { label: "weekly", resetAtIso: undefined, slot: "primary", usedPercent: 30, windowMinutes: 10080 },
            ],
          }),
          usageLimitPercent: 30,
        }),
        observation({
          alias: "codex-reopened",
          gauge: gauge({ windows: [window({ resetAtIso: "2026-09-22T11:30:00.000Z", usedPercent: 30 })] }),
          usageLimitPercent: 30,
        }),
      ],
    });

    expect(ranking.excluded.map((exclusion) => [exclusion.destination.alias, exclusion.kind])).toEqual([
      ["codex-undated", "usage-limit"],
      ["codex-reopened", "usage-limit"],
    ]);
    expect(ranking.excluded[0]!.reason).toContain("(its reset is unread)");
    expect(ranking.excluded[1]!.reason).toBe(
      "weekly window unread, so nothing shows it under this plan's 30% usage limit — the owner's own limit, " +
        "and no --force crosses it; a fresh Codex reading reopens it",
    );
    expect(ranking.ranked).toEqual([]);
  });

  it("excludes a monthly-spend row reading 0% as not-measured, never ranked and never deferred", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [
        observation({
          alias: "codex-monthly",
          allowance: "monthly-spend",
          gauge: gauge({ windows: [window({ usedPercent: 0 })] }),
        }),
      ],
    });

    expect(ranking.ranked).toEqual([]);
    expect(ranking.deferredUnmeasured).toEqual([]);
    expect(ranking.basis).toBe("no-eligible-destination");
    expect(ranking.excluded).toEqual([
      {
        destination: { alias: "codex-monthly", codexHome: "/homes/codex-monthly" },
        kind: "not-measured",
        reason: CODEX_MONTHLY_SPEND_NOT_MEASURED,
      },
    ]);
  });

  it("ranks the exclusions paused, not-measured, signed-out, usage-limit, near-cap, quota-refused", () => {
    const spent = gauge({ windows: [window({ usedPercent: 100 })] });
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [
        observation({
          alias: "codex-a",
          allowance: "monthly-spend",
          paused: { reason: "card expired", sinceIso: OBSERVED },
        }),
        observation({ alias: "codex-b", allowance: "monthly-spend", live: "signed-out" }),
        observation({ alias: "codex-c", gauge: spent, live: "signed-out", usageLimitPercent: 30 }),
        observation({ alias: "codex-d", gauge: spent, refuse: "weekly window at 100%", usageLimitPercent: 30 }),
        observation({ alias: "codex-e", gauge: spent, refuse: "weekly window at 100%" }),
        observation({ alias: "codex-f", refuse: "weekly window at 100%", usageLimitPercent: 100 }),
        observation({ alias: "codex-g", refuse: "weekly window at 100%", usageLimitPercent: 30 }),
      ],
    });

    expect(ranking.excluded.map((exclusion) => [exclusion.destination.alias, exclusion.kind])).toEqual([
      ["codex-a", "paused"],
      ["codex-b", "not-measured"],
      ["codex-c", "signed-out"],
      ["codex-d", "usage-limit"],
      ["codex-e", "near-cap"],
      ["codex-f", "quota-refused"],
      ["codex-g", "usage-limit"],
    ]);
  });

  it("holds a limited row with no weekly reading at its limit, where a 100 row ranks weekly-unmeasured", () => {
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [
        observation({ alias: "codex-limited", usageLimitPercent: 30 }),
        observation({ alias: "codex-full", usageLimitPercent: 100 }),
      ],
    });

    expect(ranking.excluded).toEqual([
      {
        destination: { alias: "codex-limited", codexHome: "/homes/codex-limited" },
        kind: "usage-limit",
        reason:
          "weekly window unread, so nothing shows it under this plan's 30% usage limit — the owner's own limit, " +
          "and no --force crosses it; a fresh Codex reading reopens it",
      },
    ]);
    expect(ranking.deferredUnmeasured).toEqual(["codex-full"]);
  });

  it("holds a limited row read only from the rollout log under its limit, where a 100 row on it ranks", () => {
    const rollout29 = gauge({ windows: [window({ usedPercent: 29 })] });
    const ranking = rankCodexPlans({
      nowIso: NOW,
      observations: [
        observation({ alias: "codex-limited", gauge: rollout29, readFrom: "rollout", usageLimitPercent: 30 }),
        observation({ alias: "codex-full", gauge: rollout29, readFrom: "rollout", usageLimitPercent: 100 }),
      ],
    });

    expect(ranking.excluded).toEqual([
      {
        destination: { alias: "codex-limited", codexHome: "/homes/codex-limited" },
        kind: "usage-limit",
        reason:
          "weekly window read only from the rollout log, at 29%, which cannot show it is still under this plan's " +
          "30% usage limit — the owner's own limit, and no --force crosses it; a live Codex reading reopens it",
      },
    ]);
    expect(ranking.ranked.map((destination) => destination.alias)).toEqual(["codex-full"]);
  });
});
