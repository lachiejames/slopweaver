/**
 * Opening the visible session that investigates a Codex burn anomaly, with the cmux spawn replaced by a typed
 * opener fake: the plan is a Claude Code research session on Opus at high effort in the current checkout,
 * named from the episode and titled for Codex, carrying the episode's evidence as its pickup; a session that
 * came up is the receipt, and one that did not — failed with a workspace possibly standing, or thrown — is
 * DRAWDOWN_SPAWN_FAILED saying which.
 */
import { describe, expect, it } from "vitest";

import type { VisibleSessionPlan } from "../../../cmux/plan.js";
import type { CodexDrawdownEpisode } from "../../../codex/drawdownAnomaly.js";
import { CodexDrawdownErrors } from "../../../codex/drawdownErrors.js";
import {
  type InvestigationSessionOpener,
  spawnCodexDrawdownInvestigation,
} from "../../../codex/drawdownInvestigation.js";
import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";

const EPISODE: CodexDrawdownEpisode = {
  episodeId: "ep-7f3a",
  observedAtIso: "2026-10-13T01:00:00.000Z",
  triggers: [
    {
      accountScope: "acct-1",
      baselinePercentPointsPerHour: 1.5,
      currentPercentPointsPerHour: 6,
      fromIso: "2026-10-13T00:00:00.000Z",
      limitId: "primary",
      ratio: 4,
      resetAtIso: "2026-10-13T05:00:00.000Z",
      seriesId: "acct-1/primary/300",
      toIso: "2026-10-13T01:00:00.000Z",
      windowMinutes: 300,
    },
  ],
};

const ARGS = {
  branch: "main",
  episode: EPISODE,
  nowIso: "2026-10-13T01:00:05.000Z",
  repoRoot: "/repo/slopweaver",
};

describe("spawnCodexDrawdownInvestigation", () => {
  it("plans a Claude Code research session on Opus at high effort, named from the episode and titled for Codex", async () => {
    const plans: VisibleSessionPlan[] = [];
    const openSession: InvestigationSessionOpener = async ({ plan }) => {
      plans.push(plan);
      return ok({ workspaceRef: "workspace:3" });
    };

    await spawnCodexDrawdownInvestigation({ ...ARGS, openSession });

    expect(plans).toHaveLength(1);
    const { pickupCommand, ...rest } = plans[0]!;
    expect(rest).toEqual({
      baseBranch: undefined,
      branch: "main",
      cwd: "/repo/slopweaver",
      driver: "claude",
      effort: "high",
      host: "claude-code",
      model: "opus",
      repoRoot: "/repo/slopweaver",
      respondingToHandle: undefined,
      sessionName: "drawdown-ep-7f3a",
      spawnedAt: "2026-10-13T01:00:05.000Z",
      template: "research",
      workspaceName: "drawdown-ep-7f3a",
      workspaceTitle: "Codex drawdown anomaly: ep-7f3a",
      worktreeExists: true,
    });
    expect(pickupCommand.split("\n")[0]).toBe(
      "Codex burn anomaly at 2026-10-13T01:00:00.000Z: acct-1/primary 300-minute window at 6.00 points/h, " +
        "4.0x its normal 1.50 (2026-10-13T00:00:00.000Z … 2026-10-13T01:00:00.000Z).",
    );
  });

  it("answers the episode and the workspace it came up in", async () => {
    const openSession: InvestigationSessionOpener = async () => ok({ workspaceRef: "workspace:3" });

    expect(unwrap(await spawnCodexDrawdownInvestigation({ ...ARGS, openSession }))).toEqual({
      episodeId: "ep-7f3a",
      workspaceRef: "workspace:3",
    });
  });

  it("is DRAWDOWN_SPAWN_FAILED naming the workspace that may still be standing when the session failed to boot", async () => {
    const openSession: InvestigationSessionOpener = async () =>
      err({ reason: "pickup was not accepted", workspaceRef: "workspace:7" });

    const error = unwrapErr(await spawnCodexDrawdownInvestigation({ ...ARGS, openSession }));

    expect(error.code).toBe("DRAWDOWN_SPAWN_FAILED");
    expect(error.message).toBe("pickup was not accepted (workspace workspace:7)");
    expect(error).toEqual(
      CodexDrawdownErrors.spawnFailed({ cause: "pickup was not accepted (workspace workspace:7)" }),
    );
  });

  it("is DRAWDOWN_SPAWN_FAILED carrying the thrown message when opening the session throws", async () => {
    const openSession: InvestigationSessionOpener = async () => {
      throw new Error("cmux socket refused");
    };

    const error = unwrapErr(await spawnCodexDrawdownInvestigation({ ...ARGS, openSession }));

    expect(error.code).toBe("DRAWDOWN_SPAWN_FAILED");
    expect(error.message).toBe("the investigation could not be spawned: cmux socket refused");
  });
});
