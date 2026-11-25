import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { ownProcessStart } from "../../../admit/lockHolder.js";
import { STEP_TIMEOUT_MS } from "../../../codexPlugin/checkout.js";
import { performFleetSync, type SyncDeps } from "../../../codexPlugin/sync.js";
import { syncLockPath } from "../../../codexPlugin/syncLock.js";
import { copyingAdd, disposeTemplate, type Fleet, fleetDeps, homesOf, makeFleet } from "./fleetFixture.js";

let fleet: Fleet;

beforeEach(() => {
  fleet = makeFleet();
});

afterEach(() => {
  rmSync(fleet.root, { force: true, recursive: true });
});

afterAll(disposeTemplate);

/** When a fixture's earlier-build `sync.lock` was made, pinned by `utimesSync`, in seconds and in milliseconds. */
const PLACED_S = 1_700_000_000;
const PLACED_MS = PLACED_S * 1000;
/** The bound an earlier build broke its `sync.lock` at: four step timeouts. */
const DIRECTORY_LOCK_BOUND_MS = 4 * STEP_TIMEOUT_MS;
/** When a fixture holder took the operation lock. */
const HELD_ISO = "2026-11-01T00:00:00.000Z";
const HELD_MS = Date.parse(HELD_ISO);

/** The empty `sync.lock` directory an earlier build took, made at {@link PLACED_S}. */
function directoryLock(): void {
  const lock = join(fleet.paths.exportRoot, "sync.lock");
  mkdirSync(lock, { recursive: true });
  utimesSync(lock, PLACED_S, PLACED_S);
}

/** A holder's record in the plugin-sync operation lock, taken at {@link HELD_ISO}. */
function holderRecord({ pid, start }: { pid: number; start: string }): void {
  const lock = syncLockPath({ paths: fleet.paths });
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, `${String(pid)}-fixture`), JSON.stringify({ acquiredAtIso: HELD_ISO, pid, start }));
}

/** A foreground run over both fixture homes at `nowMs`, counting every add. */
function runAt({ nowMs, adds = [] }: { nowMs: number; adds?: string[] }): ReturnType<typeof performFleetSync> {
  const deps: SyncDeps = fleetDeps({ codexAdd: copyingAdd({ adds, userHome: fleet.paths.userHome }), nowMs });
  return performFleetSync({
    deps,
    homes: homesOf({ fleet }),
    mainCheckouts: [fleet.paths.checkout],
    paths: fleet.paths,
    scope: "install-every-home",
  });
}

describe("codex plugin-sync's one lock across the fleet", () => {
  it("releases the lock once every home is done", () => {
    const adds: string[] = [];
    const outcome = runAt({ adds, nowMs: 0 });
    expect([outcome.did, adds.length, existsSync(syncLockPath({ paths: fleet.paths }))]).toEqual(["synced", 2, false]);
  });

  // Removing it could remove the live lock an earlier build had just re-taken by breaking the stale one.
  it("ignores an earlier build's sync.lock older than that build's bound, leaves it in place, and syncs", () => {
    directoryLock();
    const outcome = runAt({ nowMs: PLACED_MS + DIRECTORY_LOCK_BOUND_MS + 1 });
    expect([outcome.did, existsSync(join(fleet.paths.exportRoot, "sync.lock"))]).toEqual(["synced", true]);
  });

  it("stands down while an earlier build's sync.lock is within that build's bound", () => {
    directoryLock();
    const outcome = runAt({ nowMs: PLACED_MS + DIRECTORY_LOCK_BOUND_MS });
    expect(outcome).toEqual({
      did: "busy",
      why: `an earlier build's plugin-sync holds ${join(fleet.paths.exportRoot, "sync.lock")}`,
    });
  });

  // A lock dated after now was no run's fresh take, so waiting on it would wait as long as the clock lags.
  it("ignores an earlier build's sync.lock dated in the future, leaves it in place, and syncs", () => {
    directoryLock();
    const outcome = runAt({ nowMs: PLACED_MS - 1 });
    expect([outcome.did, existsSync(join(fleet.paths.exportRoot, "sync.lock"))]).toEqual(["synced", true]);
  });

  it("refuses, removing nothing, a sync.lock that is not the directory an earlier build made", () => {
    mkdirSync(fleet.paths.exportRoot, { recursive: true });
    writeFileSync(join(fleet.paths.exportRoot, "sync.lock"), "someone's file\n");
    const outcome = runAt({ nowMs: 0 });
    expect(outcome).toMatchObject({ did: "failed", error: { code: "SYNC_LOCK_UNAVAILABLE" } });
    expect(readFileSync(join(fleet.paths.exportRoot, "sync.lock"), "utf8")).toBe("someone's file\n");
  });

  // That build's lock was always an empty directory, so a full one is somebody else's, not a holder.
  it("refuses, removing nothing, a recent sync.lock directory that is not empty", () => {
    directoryLock();
    writeFileSync(join(fleet.paths.exportRoot, "sync.lock", "sentinel.txt"), "kept\n");
    utimesSync(join(fleet.paths.exportRoot, "sync.lock"), PLACED_S, PLACED_S);
    const outcome = runAt({ nowMs: PLACED_MS });
    expect(outcome).toMatchObject({ did: "failed", error: { code: "SYNC_LOCK_UNAVAILABLE" } });
    expect(readFileSync(join(fleet.paths.exportRoot, "sync.lock", "sentinel.txt"), "utf8")).toBe("kept\n");
  });

  it("takes over at once, at any age, a lock whose holder is no longer running", () => {
    holderRecord({ pid: 2_147_483_646, start: "Thu Jan  1 00:00:00 1970" });
    const outcome = runAt({ nowMs: HELD_MS + 1 });
    expect([outcome.did, existsSync(syncLockPath({ paths: fleet.paths }))]).toEqual(["synced", false]);
  });

  // The old lock broke a live run past four step timeouts; this one never ages a holder the kernel still answers for.
  it("stands down for a live holder however long it has held the lock, adding into no home", () => {
    holderRecord({ pid: process.pid, start: ownProcessStart()! });
    const adds: string[] = [];
    const outcome = runAt({ adds, nowMs: HELD_MS + 100 * DIRECTORY_LOCK_BOUND_MS });
    expect([outcome.did, adds, existsSync(syncLockPath({ paths: fleet.paths }))]).toEqual(["busy", [], true]);
  });

  it("reports a lock it cannot read as a failure, never as another run being busy", () => {
    mkdirSync(syncLockPath({ paths: fleet.paths }), { recursive: true });
    writeFileSync(join(syncLockPath({ paths: fleet.paths }), "not-a-record"), "{");
    const outcome = runAt({ nowMs: 0 });
    expect(outcome).toMatchObject({ did: "failed", error: { code: "SYNC_LOCK_UNAVAILABLE" } });
  });
});
