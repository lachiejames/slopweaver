/**
 * The fleet read files each store's sign-in observation, and a filing that fails — a store outage, a refused alias,
 * a port that throws — is a warning, never a failed read: the routing read is how Codex keeps working, and the
 * signed-out card is only one read late (`src/codex/fleetRead.ts` § `fileCodexSignIns`).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readCodexFleetSnapshot } from "../../../codex/fleetRead.js";
import { CodexSignInErrors } from "../../../codex/signInErrors.js";
import type { CodexSignInPort } from "../../../codex/signInPort.js";
import { ok, unwrap } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryCodexFleetCapPort } from "../../codexFleetCapFixture.js";
import { liveReaderFrom } from "../../codexLiveFake.js";
import { unavailableCodexSignInPort } from "../../codexSignInFixture.js";
import { memoryPlanRegisterPort } from "../../planRegisterFixture.js";

const NOW = "2026-09-22T12:00:00.000Z";

const dirs: string[] = [];

/** A throwaway directory this file removes after every test. */
function temp({ prefix }: { prefix: string }): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A state home whose register carries two Codex plans, each over its own empty store. */
function homeWithTwoPlans(): string {
  const home = temp({ prefix: "codex-signin-filing-" });
  const path = stateHomePaths({ home }).plansJson;
  mkdirSync(dirname(path), { recursive: true });
  const rows = ["codex-one", "codex-two"].map((alias) => ({
    alias,
    provider: "codex",
    storeDir: temp({ prefix: `${alias}-` }),
  }));
  writeFileSync(path, JSON.stringify({ rows, version: 1 }), "utf8");
  return home;
}

/** The aliases one fleet read observed, read over `signInPort`. */
async function observedAliases({ signInPort }: { signInPort: CodexSignInPort }): Promise<readonly string[]> {
  const snapshot = unwrap(
    await readCodexFleetSnapshot({
      fleetCap: memoryCodexFleetCapPort(),
      home: homeWithTwoPlans(),
      nowIso: NOW,
      port: memoryPlanRegisterPort(),
      readLive: liveReaderFrom(),
      signInPort,
    }),
  );
  return snapshot.observations.map((observation) => observation.plan.alias);
}

afterEach(() => {
  dirs.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("filing the sign-in observations never fails the fleet read", () => {
  it("still reads every plan when the store is unreachable", async () => {
    expect(await observedAliases({ signInPort: unavailableCodexSignInPort() })).toEqual(["codex-one", "codex-two"]);
  });

  it("still reads every plan when the store refuses one alias's write", async () => {
    const refusing: CodexSignInPort = {
      read: () => Promise.resolve(ok([])),
      record: ({ observed }) =>
        Promise.resolve(
          ok(
            observed.map(({ alias }) => ({
              alias,
              error: CodexSignInErrors.aliasInvalid({ alias }),
              kind: "refused" as const,
            })),
          ),
        ),
    };

    expect(await observedAliases({ signInPort: refusing })).toEqual(["codex-one", "codex-two"]);
  });

  it("still reads every plan when filing throws", async () => {
    const throwing: CodexSignInPort = {
      read: () => Promise.resolve(ok([])),
      record: () => Promise.reject(new Error("the connection reset mid-write")),
    };

    expect(await observedAliases({ signInPort: throwing })).toEqual(["codex-one", "codex-two"]);
  });
});
