/**
 * A PAUSED weekly-window Codex row is still read: the fleet read asks its store in the one live batch and files its
 * sign-in observation, because a pause is often "until this is signed in" and that read is what keeps the login line
 * and the `codex-plan-signed-out` card current (`src/codex/fleetCap.ts`, an owner ruling). The paused-plan notice
 * says so (`src/plans/render.ts` § `pausedEffect`); this pins the behaviour that sentence describes, and
 * `fleetReadMonthlySpend.test.ts` is its falsifier — a monthly-spend row is asked nothing.
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

describe("the Codex fleet read still reads a paused weekly row", () => {
  it("asks the live batch and the sign-in filing for the paused row beside the unpaused one", async () => {
    const home = temp({ prefix: "codex-paused-read-" });
    const pausedStore = temp({ prefix: "codex-paused-" });
    const liveStore = temp({ prefix: "codex-live-" });
    const path = stateHomePaths({ home }).plansJson;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        rows: [
          {
            alias: "codex-one",
            paused: { reason: "not signed in yet", sinceIso: "2026-09-21T00:00:00.000Z" },
            provider: "codex",
            storeDir: pausedStore,
          },
          { alias: "codex-two", provider: "codex", storeDir: liveStore },
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

    expect(asked).toEqual([pausedStore, liveStore]);
    expect(filed).toEqual(["codex-one", "codex-two"]);
    const paused = snapshot.observations[0]!;
    expect(paused.plan.paused).toEqual({ reason: "not signed in yet", sinceIso: "2026-09-21T00:00:00.000Z" });
    expect(paused.live.codexHome).toBe(pausedStore);
    expect(paused.scanSkippedReason).toBe(undefined);
  });
});
