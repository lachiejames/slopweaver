/**
 * A monthly-spend Codex row is NOT MEASURED, so the fleet read never asks its store anything: it is left out of the
 * one live batch and its sign-in filing, carries a skipped rollout scan, and still appears in the snapshot so every
 * ranking can say why it is excluded (`src/codex/fleetRead.ts` § `snapshotOf`). The exclusion applies before the
 * batch probes the row, never after.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ReadCodexAccountsLive } from "../../../codex/accountLive.js";
import { readCodexFleetSnapshot } from "../../../codex/fleetRead.js";
import type { CodexSignInPort } from "../../../codex/signInPort.js";
import { ok, unwrap } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryCodexFleetCapPort } from "../../codexFleetCapFixture.js";
import { liveReaderFrom } from "../../codexLiveFake.js";
import { memoryPlanRegisterPort } from "../../planRegisterFixture.js";

const NOW = "2026-09-22T12:00:00.000Z";

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

describe("the Codex fleet read never probes a monthly-spend row", () => {
  it("asks the live batch and the sign-in filing for the weekly rows only, and still observes every row", async () => {
    const home = temp({ prefix: "codex-monthly-read-" });
    const weeklyStore = temp({ prefix: "codex-weekly-" });
    const monthlyStore = temp({ prefix: "codex-monthly-" });
    const path = stateHomePaths({ home }).plansJson;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        rows: [
          { alias: "codex-one", allowance: { kind: "monthly-spend" }, provider: "codex", storeDir: monthlyStore },
          { alias: "codex-two", provider: "codex", storeDir: weeklyStore },
        ],
        version: 1,
      }),
      "utf8",
    );
    const asked: string[] = [];
    const inner = liveReaderFrom();
    const recordingReader: ReadCodexAccountsLive = (request) => {
      asked.push(...request.codexHomes);
      return inner(request);
    };
    const filed: string[] = [];
    const recordingSignIns: CodexSignInPort = {
      read: () => Promise.resolve(ok([])),
      record: ({ observed }) => {
        filed.push(...observed.map(({ alias }) => alias));
        return Promise.resolve(ok([]));
      },
    };

    const snapshot = unwrap(
      await readCodexFleetSnapshot({
        fleetCap: memoryCodexFleetCapPort(),
        home,
        nowIso: NOW,
        port: memoryPlanRegisterPort(),
        readLive: recordingReader,
        signInPort: recordingSignIns,
      }),
    );

    expect(asked).toEqual([weeklyStore]);
    expect(filed).toEqual(["codex-two"]);
    expect(snapshot.observations.map((observation) => observation.plan.alias)).toEqual(["codex-one", "codex-two"]);
    const monthly = snapshot.observations[0]!;
    expect(monthly.live).toEqual({
      codexHome: monthlyStore,
      kind: "unreadable",
      readAtIso: NOW,
      reason: "not probed: a monthly-spend plan is NOT MEASURED",
    });
    expect(monthly.scanSkippedReason).toBe("not probed: a monthly-spend plan is NOT MEASURED");
    expect(monthly.scan.filesRead).toBe(0);
  });
});
