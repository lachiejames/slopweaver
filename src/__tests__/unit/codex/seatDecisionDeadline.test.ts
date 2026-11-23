/**
 * {@link decideCodexSeat}'s `deadlineAtMs` reaches the fleet read, so a caller its parent kills at a fixed instant
 * — the console's `codex quota show --routed` poll — routes through the BOUNDED read: the live batch is asked to end
 * before the deadline and no fleet-cap record is filed (the rollout scan is skipped the same way, `fleetRead.ts`).
 * Bounding only the live reader left the route's scan and filing unbounded.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ReadCodexAccountsLive } from "../../../codex/accountLive.js";
import { decideCodexSeat } from "../../../codex/seatDecision.js";
import type { CodexSignInPort } from "../../../codex/signInPort.js";
import { ok } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { memoryCodexFleetCapPort, memoryCodexFleetCapStore } from "../../codexFleetCapFixture.js";
import { liveReaderFrom } from "../../codexLiveFake.js";
import { memoryPlanRegisterPort } from "../../planRegisterFixture.js";

const NOW = "2026-11-06T00:00:00.000Z";

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

/** A sign-in port that files nothing anywhere. */
const SIGN_INS: CodexSignInPort = {
  read: () => Promise.resolve(ok([])),
  record: () => Promise.resolve(ok([])),
};

/**
 * Route once over a one-row register, recording the deadline the live batch was asked for and whether the fleet
 * read opened its cap store to file a record.
 */
async function routeOnce({ deadlineAtMs }: { deadlineAtMs: number | undefined }): Promise<{
  readonly asked: readonly (number | undefined)[];
  readonly capOpened: number;
}> {
  const home = temp({ prefix: "seat-deadline-" });
  const store = temp({ prefix: "seat-deadline-store-" });
  const path = stateHomePaths({ home }).plansJson;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ rows: [{ alias: "codex-one", provider: "codex", storeDir: store }], version: 1 }),
    "utf8",
  );
  const asked: (number | undefined)[] = [];
  const inner = liveReaderFrom();
  const readLive: ReadCodexAccountsLive = (request) => {
    asked.push(request.deadlineAtMs);
    return inner(request);
  };
  const capStore = memoryCodexFleetCapStore();
  await decideCodexSeat({
    ...(deadlineAtMs === undefined ? {} : { deadlineAtMs }),
    allowRefusing: false,
    fleetCap: memoryCodexFleetCapPort({ store: capStore }),
    home,
    nowIso: NOW,
    port: memoryPlanRegisterPort(),
    readLive,
    requestedAlias: undefined,
    signInPort: SIGN_INS,
  });
  return { asked, capOpened: capStore.opened };
}

describe("decideCodexSeat under a caller deadline", () => {
  it("asks the live batch to end before the deadline and files no fleet-cap record", async () => {
    expect(await routeOnce({ deadlineAtMs: 60_000 })).toStrictEqual({ asked: [58_000], capOpened: 0 });
  });

  it("with no deadline, leaves the batch unbounded and files the fleet-cap record", async () => {
    expect(await routeOnce({ deadlineAtMs: undefined })).toStrictEqual({ asked: [undefined], capOpened: 1 });
  });
});
