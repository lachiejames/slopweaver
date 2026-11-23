/*
 * The fleet assessed where the live read and the register disagree with the logs, or hold too little to rank: a
 * stale rollout line beside a live one, a signed-out store, account drift, a fresh home, one destination, none.
 */
import { describe, expect, it } from "vitest";

import { assessCodexFleet } from "../../../../codex/fleetAssessment.js";
import { readCodexFleetSnapshot } from "../../../../codex/fleetRead.js";
import { renderCodexFleet } from "../../../../codex/fleetRender.js";
import { unwrap } from "../../../../lib/result.js";
import { memoryCodexFleetCapPort } from "../../../codexFleetCapFixture.js";
import { liveReaderFrom } from "../../../codexLiveFake.js";
import { memoryCodexSignInPort } from "../../../codexSignInFixture.js";
import { memoryPlanRegisterPort } from "../../../planRegisterFixture.js";
import { codexHomeAtWeekly, homeWith, MODEL, NOW, temp, useRouteRunHomes } from "./harness.js";

useRouteRunHomes();

describe("assessing the Codex fleet over real homes", () => {
  // The incident: the owner reset `~/.codex`, whose rollout log still said 100% days later, while its own
  // app-server read 0%; and `~/.codex-one`, never signed in, ranked first and failed the pass with a 401.
  it("ranks on the LIVE reading over a stale rollout line, and excludes a store the live read found signed out", async () => {
    const reset = codexHomeAtWeekly({ percent: 100 });
    const unsigned = temp({ prefix: "codex-route-unsigned-" });
    const home = homeWith({
      rows: [
        { alias: "codex-unsigned", provider: "codex", storeDir: unsigned },
        { alias: "codex-reset", provider: "codex", storeDir: reset },
      ],
    });
    const readLive = liveReaderFrom({
      byHome: {
        [reset]: {
          accountId: "acct-reset",
          codexHome: reset,
          email: "reset@example.com",
          gauges: [
            {
              credits: undefined,
              limitId: "codex",
              observedAtIso: NOW,
              planType: "pro",
              reached: undefined,
              reachedType: undefined,
              windows: [
                {
                  label: "weekly",
                  resetAtIso: "2026-09-29T12:00:00.000Z",
                  slot: "primary",
                  usedPercent: 0,
                  windowMinutes: 10080,
                },
              ],
            },
          ],
          kind: "signed-in",
          ordinaryUsageAllowed: undefined,
          planType: "pro",
          readAtIso: NOW,
          resetCreditsAvailable: 1,
        },
        [unsigned]: { codexHome: unsigned, kind: "signed-out", readAtIso: NOW },
      },
    });

    const assessment = assessCodexFleet({
      requestedModel: MODEL,
      snapshot: unwrap(
        await readCodexFleetSnapshot({
          fleetCap: memoryCodexFleetCapPort(),
          home,
          nowIso: NOW,
          port: memoryPlanRegisterPort(),
          readLive,
          signInPort: memoryCodexSignInPort(),
        }),
      ),
    });

    expect(assessment.selection).toEqual({ destination: { alias: "codex-reset", codexHome: reset }, kind: "selected" });
    expect(assessment.rows.map((row) => [row.alias, row.liveState, row.gaugeSource, row.weeklyUsedPercent])).toEqual([
      ["codex-unsigned", "signed-out", "none", null],
      ["codex-reset", "signed-in", "live", 0],
    ]);
    expect(assessment.rows[1]!.liveEmail).toBe("reset@example.com");
    expect(assessment.rows[0]!.disposition).toBe("excluded (signed-out)");
    expect(assessment.advisories).toEqual([
      `codex-unsigned: not signed in — run mkdir -p ${unsigned} && CODEX_HOME=${unsigned} codex login`,
      "codex-reset: 1 free usage-limit reset(s) held — redeem one at a limit with slopweaver codex reset --plan codex-reset",
    ]);
    const lines = renderCodexFleet({ assessment, full: true });
    expect(lines).toContain("      signed in as reset@example.com (live) · 1 free reset(s) unused");
    expect(lines).toContain("      NOT signed in (live)");
    expect(lines.filter((line) => line.includes("ACCOUNT DRIFT"))).toEqual([]);
    // The console voice reads this text, so an eligible row says when its week comes back too.
    expect(lines).toContain("  codex-reset — week 0% (resets 2026-09-29T12:00:00.000Z), live reading, read 0s ago");
  });

  it("says when a row's cached address and its store's live sign-in disagree, and names the verb that fixes it", async () => {
    const store = temp({ prefix: "codex-route-drift-" });
    const home = homeWith({
      rows: [{ alias: "codex-ambient", email: "old@example.com", provider: "codex", storeDir: store }],
    });
    const readLive = liveReaderFrom({
      byHome: {
        [store]: {
          accountId: "acct-new",
          codexHome: store,
          email: "new@example.com",
          gauges: [],
          kind: "signed-in",
          ordinaryUsageAllowed: undefined,
          planType: "business",
          readAtIso: NOW,
          resetCreditsAvailable: 0,
        },
      },
    });

    const assessment = assessCodexFleet({
      requestedModel: MODEL,
      snapshot: unwrap(
        await readCodexFleetSnapshot({
          fleetCap: memoryCodexFleetCapPort(),
          home,
          nowIso: NOW,
          port: memoryPlanRegisterPort(),
          readLive,
          signInPort: memoryCodexSignInPort(),
        }),
      ),
    });

    expect(renderCodexFleet({ assessment, full: true }).filter((line) => line.includes("ACCOUNT DRIFT"))).toEqual([
      "      ACCOUNT DRIFT: the row says old@example.com, the store is signed in as new@example.com — run slopweaver plans sync-accounts",
    ]);
  });

  it("says a home nobody has run a turn on has NO reading, never zero", async () => {
    const fresh = temp({ prefix: "codex-route-fresh-" });
    const home = homeWith({ rows: [{ alias: "codex-fresh", provider: "codex", storeDir: fresh }] });

    const assessment = assessCodexFleet({
      requestedModel: MODEL,
      snapshot: unwrap(
        await readCodexFleetSnapshot({
          fleetCap: memoryCodexFleetCapPort(),
          home,
          nowIso: NOW,
          port: memoryPlanRegisterPort(),
          readLive: liveReaderFrom(),
          signInPort: memoryCodexSignInPort(),
        }),
      ),
    });

    const row = assessment.rows[0]!;
    expect(row.weeklyUsedPercent).toBeNull();
    expect(row.gauge).toBeNull();
    expect(row.dispositionReason).toBe(
      "no usable weekly observation; no standing refusal found; deferred behind measured destinations",
    );
    expect(assessment.weeklyMeasured).toBe(0);
    expect(assessment.ranking.basis).toBe("weekly-unmeasured");
    expect(renderCodexFleet({ assessment, full: true })).toContain(
      "  codex-fresh — week unread, none reading, no dated reading",
    );
  });

  it("refuses to call a one-destination fleet balanced, and says what it could not compare", async () => {
    const home = homeWith({
      rows: [{ alias: "codex-only", provider: "codex", storeDir: codexHomeAtWeekly({ percent: 30 }) }],
    });

    const assessment = assessCodexFleet({
      requestedModel: MODEL,
      snapshot: unwrap(
        await readCodexFleetSnapshot({
          fleetCap: memoryCodexFleetCapPort(),
          home,
          nowIso: NOW,
          port: memoryPlanRegisterPort(),
          readLive: liveReaderFrom(),
          signInPort: memoryCodexSignInPort(),
        }),
      ),
    });

    expect(assessment.weeklySpread.kind).toBe("not-applicable");
    expect(assessment.insteadDo).toBeNull();
  });

  it("points at `plans add` when the register carries no Codex row at all", async () => {
    const home = homeWith({ rows: [{ alias: "plan-one", provider: "claude", storeDir: "/stores/plan-one" }] });

    const assessment = assessCodexFleet({
      requestedModel: MODEL,
      snapshot: unwrap(
        await readCodexFleetSnapshot({
          fleetCap: memoryCodexFleetCapPort(),
          home,
          nowIso: NOW,
          port: memoryPlanRegisterPort(),
          readLive: liveReaderFrom(),
          signInPort: memoryCodexSignInPort(),
        }),
      ),
    });

    expect(assessment.destinations).toBe(0);
    expect(assessment.selection).toEqual({ kind: "none", reason: "nothing eligible: no-eligible-destination" });
    expect(assessment.insteadDo).toContain("plans add --provider codex");
  });
});
