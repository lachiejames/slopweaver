/**
 * `codex quota clear`'s mark, read by the fleet route over REAL temp homes.
 *
 * The defect it holds down: an UNSCOPED spend cap in a store's own rollout log (a `task_complete`, no
 * `limit_id`) kept a plan out of routing while its live read showed 0% weekly use, and the clear the refusal
 * names deleted no cache and changed nothing. Each home is a `mkdtempSync` directory removed in `afterEach`,
 * and nothing reads the operator's own `~/.codex`.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { assessCodexFleet } from "../../../codex/fleetAssessment.js";
import { readCodexFleetSnapshot } from "../../../codex/fleetRead.js";
import { writeCodexQuotaCache, writeCodexQuotaClearMark } from "../../../codex/quotaCache.js";
import { unwrap } from "../../../lib/result.js";
import type { RegisteredPlan } from "../../../plans/types.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryCodexFleetCapPort } from "../../codexFleetCapFixture.js";
import { liveReaderFrom } from "../../codexLiveFake.js";
import { REAL_SPEND_CAP_TASK_COMPLETE_LINE } from "../../codexRolloutLines.js";
import { memoryCodexSignInPort } from "../../codexSignInFixture.js";
import { weeklyLine } from "../../codexWeeklyLineFixture.js";
import { memoryPlanRegisterPort } from "../../planRegisterFixture.js";

const NOW = "2026-09-22T12:00:00.000Z";
const MODEL = "gpt-6-astra";
const DEADLINE_AT_MS = 1_790_000_016_000;

const dirs: string[] = [];

/** A throwaway directory this file removes after every test. */
function temp({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A Codex home whose one rollout file carries `lines`, in the day directory `recentSessionDayDirs` walks. */
function codexHomeWith({ lines }: { lines: readonly string[] }): string {
  const store = temp({ prefix: "codex-cleared-home-" });
  const dayDir = join(store, "sessions", "2026", "09", "22");
  mkdirSync(dayDir, { recursive: true });
  writeFileSync(join(dayDir, "rollout-2026-09-22T11-00-00-cccc.jsonl"), `${lines.join("\n")}\n`, "utf8");
  return store;
}

/** A state home whose register carries exactly `rows`. */
function homeWith({ rows }: { rows: readonly Omit<RegisteredPlan, "allowance" | "usageLimitPercent">[] }): string {
  const home = temp({ prefix: "codex-cleared-state-" });
  const path = stateHomePaths({ home }).plansJson;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ rows, version: 1 }), "utf8");
  return home;
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("a clear mark over unscoped quota evidence", () => {
  it("routes a plan reading 0% live again once a clear mark covers its unscoped rollout-log spend cap", async () => {
    const store = codexHomeWith({
      lines: [REAL_SPEND_CAP_TASK_COMPLETE_LINE, weeklyLine({ observedIso: "2026-09-22T11:00:00.000Z", percent: 0 })],
    });
    const alias = "codex-spend-capped";
    const home = homeWith({ rows: [{ alias, provider: "codex", storeDir: store }] });
    const readLive = liveReaderFrom({
      byHome: {
        [store]: {
          accountId: "acct-capped",
          codexHome: store,
          email: "capped@example.com",
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
          ordinaryUsageAllowed: true,
          planType: "pro",
          readAtIso: NOW,
          resetCreditsAvailable: 0,
        },
      },
    });
    const selection = async (): Promise<unknown> =>
      assessCodexFleet({
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
      }).selection;

    expect(await selection()).toEqual({ kind: "none", reason: "nothing eligible: no-eligible-destination" });
    writeCodexQuotaClearMark({ alias, clearedAtIso: "2026-09-22T11:30:00.000Z", home });
    expect(await selection()).toEqual({ destination: { alias, codexHome: store }, kind: "selected" });
  });

  // The deadline branch decides without the shared wrapper, so it reads the clear mark itself: an unscoped cached
  // cap refuses under a deadline until `codex quota clear` records a mark after it.
  it("honours a clear mark under a deadline, where the quota decision skips the shared reader", async () => {
    const alias = "codex-cleared";
    const store = codexHomeWith({ lines: [weeklyLine({ observedIso: "2026-09-22T11:00:00.000Z", percent: 10 })] });
    const home = homeWith({ rows: [{ alias, provider: "codex", storeDir: store }] });
    writeCodexQuotaCache({ alias, evidence: { kind: "usage-limit", observedAtIso: "2026-09-22T08:00:00.000Z" }, home });
    const refusing = async (): Promise<readonly boolean[]> =>
      unwrap(
        await readCodexFleetSnapshot({
          deadlineAtMs: DEADLINE_AT_MS,
          fleetCap: memoryCodexFleetCapPort(),
          home,
          nowIso: NOW,
          port: memoryPlanRegisterPort(),
          readLive: liveReaderFrom(),
          signInPort: memoryCodexSignInPort(),
        }),
      ).observations.map((observation) => observation.quota.refuse);

    expect(await refusing()).toEqual([true]);
    writeCodexQuotaClearMark({ alias, clearedAtIso: "2026-09-22T09:00:00.000Z", home });
    expect(await refusing()).toEqual([false]);
  });
});
