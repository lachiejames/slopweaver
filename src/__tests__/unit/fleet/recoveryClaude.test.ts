/**
 * Which Claude plans a Recovery check may open on, over a real register in a temp home and probe seams that are plain
 * functions: the plan that answered is the one candidate, and every other plan is excluded with why, a refused login
 * naming the sign-in that fixes it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ClaudeRotationErrors } from "../../../claude/errors.js";
import type { ProbeRepairDeps } from "../../../claude/probeRepair.js";
import type { ClaudeProbeResult } from "../../../claude/probeStore.js";
import { readClaudeRecoveryEvidence } from "../../../fleet/recoveryClaude.js";
import { err, ok } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryClaudePlanProbesPort } from "../../claudePlanProbesFixture.js";
import { memoryPlanRegisterPort } from "../../planRegisterFixture.js";

const NOW = "2026-11-25T10:00:00.000Z";
const ALIVE = "2026-11-25T18:00:00.000Z";

const dirs: string[] = [];

/** A throwaway directory this file removes after every test. */
function temp({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/** A state home whose plan register holds exactly `rows`. */
function homeWith({ rows }: { rows: readonly Record<string, unknown>[] }): string {
  const home = temp({ prefix: "recovery-claude-" });
  const path = stateHomePaths({ home }).plansJson;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ rows, version: 1 }), "utf8");
  return home;
}

/** A plan's token, alive for hours, so nothing is ever refreshed. */
const life = ({ alias }: { alias: string }): ClaudeProbeResult["life"] => ({
  alias,
  expiresAtIso: ALIVE,
  hasCredential: true,
  hasRefreshToken: true,
  refreshExpiresAtIso: "2026-12-25T00:00:00.000Z",
});

/** Seams where `answering` reads, `rejected` is refused with hours of life left, and every other plan is unreachable. */
const seams = ({ answering, rejected }: { answering: string; rejected: string }): ProbeRepairDeps => ({
  nowIso: () => NOW,
  probe: async ({ alias }): Promise<ClaudeProbeResult> => {
    if (alias === answering) {
      const gauge = {
        alias,
        fiveHour: { resetAtIso: ALIVE, status: "allowed" as const, utilization: 0.2 },
        observedAtIso: NOW,
        sevenDay: { resetAtIso: ALIVE, status: "allowed" as const, utilization: 0.3 },
      };
      return { life: life({ alias }), outcome: { alias, gauge }, reading: ok(gauge) };
    }
    if (alias === rejected) {
      return {
        life: life({ alias }),
        outcome: { alias, problem: "refused" },
        reading: err(ClaudeRotationErrors.credentialRejected({ alias, status: 401 })),
      };
    }
    return {
      life: life({ alias }),
      outcome: { alias, problem: "no answer" },
      reading: err(ClaudeRotationErrors.probeTransportFailed({ alias })),
    };
  },
  readLife: ({ account }) => life({ alias: account.alias }),
  refresh: () => {
    throw new Error("a plan with hours of life left is never refreshed");
  },
});

describe("readClaudeRecoveryEvidence", () => {
  it("offers the plan that answered and excludes the rest, naming a sign-in only for the refused login", async () => {
    const stores = {
      four: temp({ prefix: "plan-four-" }),
      one: temp({ prefix: "plan-one-" }),
      three: temp({ prefix: "plan-three-" }),
      two: temp({ prefix: "plan-two-" }),
    };
    const home = homeWith({
      rows: [
        { alias: "plan-one", provider: "claude", storeDir: stores.one },
        { alias: "plan-two", provider: "claude", storeDir: stores.two },
        { alias: "plan-three", provider: "claude", storeDir: stores.three },
        {
          alias: "plan-four",
          paused: { reason: "the subscription lapsed", sinceIso: "2026-11-01T00:00:00.000Z" },
          provider: "claude",
          storeDir: stores.four,
        },
      ],
    });
    const evidence = await readClaudeRecoveryEvidence({
      deps: seams({ answering: "plan-one", rejected: "plan-three" }),
      home,
      port: memoryPlanRegisterPort(),
      probesPort: memoryClaudePlanProbesPort(),
      storeExists: () => true,
    });
    expect(evidence.candidates).toEqual([{ alias: "plan-one", storeDir: stores.one, vendor: "claude" }]);
    expect(evidence.excluded.map((exclusion) => [exclusion.alias, exclusion.signInCommand])).toEqual([
      ["plan-two", undefined],
      ["plan-three", "slopweaver claude signin --plan plan-three"],
      ["plan-four", undefined],
    ]);
    expect(evidence.excluded[0]!.reason).toBe("no answer");
    expect(evidence.excluded[2]!.reason).toBe("paused: the subscription lapsed");
    expect(evidence.unreadable).toBe(undefined);
  });

  it("says no plan is registered when the register holds no Claude row", async () => {
    const home = homeWith({ rows: [] });
    const evidence = await readClaudeRecoveryEvidence({
      deps: seams({ answering: "none", rejected: "none" }),
      home,
      port: memoryPlanRegisterPort(),
      probesPort: memoryClaudePlanProbesPort(),
      storeExists: () => true,
    });
    expect(evidence).toEqual({ candidates: [], excluded: [], vendor: "claude" });
  });
});
