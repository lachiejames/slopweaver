/**
 * Which Codex plans a Recovery check may open on, over a real register and real store directories in temp homes and a
 * live read answered from a table: a signed-in plan is the one candidate, and a signed-out one is excluded with the
 * login command that fixes it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readCodexRecoveryEvidence } from "../../../fleet/recoveryCodex.js";
import { codexLoginCommand } from "../../../plans/login.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryCodexFleetCapPort } from "../../codexFleetCapFixture.js";
import { liveReaderFrom } from "../../codexLiveFake.js";
import { memoryCodexSignInPort } from "../../codexSignInFixture.js";
import { weeklyLine } from "../../codexWeeklyLineFixture.js";
import { memoryPlanRegisterPort } from "../../planRegisterFixture.js";

const NOW = "2026-11-25T10:00:00.000Z";

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

/** A Codex home whose one rollout file reads `percent` of the weekly window used. */
function codexHomeAt({ percent }: { percent: number }): string {
  const store = temp({ prefix: "recovery-codex-home-" });
  const dayDir = join(store, "sessions", "2026", "11", "25");
  mkdirSync(dayDir, { recursive: true });
  writeFileSync(
    join(dayDir, "rollout-2026-11-25T09-00-00-aaaa.jsonl"),
    `${weeklyLine({ observedIso: "2026-11-25T09:00:00.000Z", percent })}\n`,
    "utf8",
  );
  return store;
}

/** A state home whose plan register file holds `text`. */
function homeHolding({ text }: { text: string }): string {
  const home = temp({ prefix: "recovery-codex-state-" });
  const path = stateHomePaths({ home }).plansJson;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
  return home;
}

describe("readCodexRecoveryEvidence", () => {
  it("offers the signed-in plan and excludes the signed-out one with its login command", async () => {
    const live = codexHomeAt({ percent: 10 });
    const out = codexHomeAt({ percent: 10 });
    const home = homeHolding({
      text: JSON.stringify({
        rows: [
          { alias: "codex-live", provider: "codex", storeDir: live },
          { alias: "codex-out", provider: "codex", storeDir: out },
        ],
        version: 1,
      }),
    });
    const readLive = liveReaderFrom({
      byHome: {
        [live]: {
          accountId: "acct-live",
          codexHome: live,
          email: "live@example.com",
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
                  resetAtIso: "2026-12-02T10:00:00.000Z",
                  slot: "primary",
                  usedPercent: 10,
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
        [out]: { codexHome: out, kind: "signed-out", readAtIso: NOW },
      },
    });
    const evidence = await readCodexRecoveryEvidence({
      fleetCap: memoryCodexFleetCapPort(),
      home,
      nowIso: NOW,
      port: memoryPlanRegisterPort(),
      readLive,
      signInPort: memoryCodexSignInPort(),
    });
    expect(evidence.candidates).toEqual([{ alias: "codex-live", codexHome: live, vendor: "codex" }]);
    expect(evidence.excluded.map((exclusion) => [exclusion.alias, exclusion.signInCommand])).toEqual([
      ["codex-out", codexLoginCommand({ codexHome: out })],
    ]);
    expect(evidence.excluded[0]!.reason).toContain("signed-out: ");
  });

  it("says the plans could not be read when the register does not decode, and offers none", async () => {
    const home = homeHolding({ text: "not a register" });
    const evidence = await readCodexRecoveryEvidence({
      fleetCap: memoryCodexFleetCapPort(),
      home,
      nowIso: NOW,
      port: memoryPlanRegisterPort(),
      readLive: liveReaderFrom(),
      signInPort: memoryCodexSignInPort(),
    });
    expect(evidence.candidates).toEqual([]);
    expect(evidence.unreadable).toBeDefined();
  });
});
