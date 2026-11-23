/**
 * One door per destination, through the verb's own seams: a night and a sweep over a LIST of local destinations,
 * the door ledger in memory, the Keychain read counted, the drive reads faked and the stack the fake one. Every write
 * lands under a sandbox home and its sibling folders.
 *
 * What is proven here: each reachable destination writes its own door record; a refused first door does not stop the
 * second; a destination's root is made only inside a door that passed; a drive that is out enters no door; and a
 * sweep with every drive out reads neither the key nor the master password. Under the owner's protected paths: a
 * protected destination is refused before its door while the next is still written, and a protected staging root or
 * an unreadable registry holds the whole run before anything is read.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DoorFinding, DoorGate } from "../../../../../admit/types.js";
import { parseStoreBackupArgs } from "../../../../../cli/commands/store/backupCore.js";
import { type NightSeams, reportNight } from "../../../../../cli/commands/store/backupRun.js";
import { reportSweepOnly } from "../../../../../cli/commands/store/backupSweepRun.js";
import type { ReadSealing } from "../../../../../cli/commands/store/backupTargets.js";
import type { DriveProbes } from "../../../../../cli/commands/store/writeDestination.js";
import { EXIT_ERROR, EXIT_OK } from "../../../../../cli/exitCodes.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import type { ProtectedPath } from "../../../../../protectedPaths/registry.js";
import { destinationId } from "../../../../../store/backup/destinationConfig.js";
import { readLastOutcome } from "../../../../../store/backup/lastOutcome.js";
import { keyFingerprint } from "../../../../../store/backup/objectCrypto.js";
import { NO_PROTECTION, type ReadBackupProtection } from "../../../../../store/backup/protectedPaths.js";
import { BackupProtectionErrors } from "../../../../../store/backup/protectedPathsErrors.js";
import { stagingRoot } from "../../../../../store/backup/staging.js";
import { writeVolumePins } from "../../../../../store/backup/volumePins.js";
import { type MemoryDoorLedger, memoryDoorLedger } from "../../../../doorLedgerFixture.js";
import { FAKE_STACK, KEY, removeSandboxHomes, STORE_URL, sandboxHome } from "../../../store/backupRunWorld.js";

afterEach(() => {
  removeSandboxHomes();
});

const NOW = "2026-11-08T03:00:00.000Z";
const SSD_ROOT = "/Volumes/FixtureDrive/backups";
/** What every backup door record is labelled. */
const ACTION = "verb:store.backup";

/** No external drive is ever mounted: every pinned destination is out, and a folder on this Mac is just a folder. */
const NOTHING_MOUNTED: DriveProbes = {
  deviceOf: () => null,
  deviceUnder: () => null,
  identityOf: ({ path }) => (path === "/Volumes" ? { dev: -1, ino: -1 } : null),
  readVolume: () => ok(null),
};

/** A run's seams, and what they saw. */
interface World {
  readonly seams: NightSeams;
  readonly ledger: MemoryDoorLedger;
  /** How many times the key and master password were read. */
  readonly sealed: () => number;
}

/**
 * Seams over an in-memory ledger, the test key and the fake stack, with the gates given.
 *
 * @param gates the door's gates, none by default
 * @param readProtection the protected-path read, an empty registry by default
 * @returns the world
 */
function world({
  gates = [],
  readProtection = () => ok(NO_PROTECTION),
}: { gates?: readonly DoorGate[]; readProtection?: ReadBackupProtection } = {}): World {
  const ledger = memoryDoorLedger();
  let reads = 0;
  const sealing: ReadSealing = () => {
    reads += 1;
    return ok({ key: { fingerprint: keyFingerprint({ key: KEY }), key: KEY }, masterPassword: null });
  };
  return {
    ledger,
    sealed: () => reads,
    seams: { deps: FAKE_STACK, door: { gates, ledger: ledger.port }, probes: NOTHING_MOUNTED, readProtection, sealing },
  };
}

/**
 * Remember a list of destinations for the home, one per line.
 *
 * @param home the sandbox home
 * @param roots the destinations, in order
 */
function remember({ home, roots }: { home: string; roots: readonly string[] }): void {
  mkdirSync(join(home, "secrets"), { recursive: true });
  writeFileSync(join(home, "secrets", "store-backup-directory"), roots.map((root) => `${root}\n`).join(""));
}

/**
 * Two folders beside the home, neither made yet.
 *
 * @param home the sandbox home
 * @returns their roots
 */
function twoFolders({ home }: { home: string }): readonly [string, string] {
  return [join(dirname(home), "first"), join(dirname(home), "second")];
}

/**
 * A gate holding the write to one destination.
 *
 * @param root the destination it holds
 * @returns the gate
 */
function holding({ root }: { root: string }): DoorGate {
  const finding: DoorFinding = {
    code: "TEST_HOLD",
    correction: "nothing — a test hold",
    severity: "hold",
    summary: "held",
  };
  return (request) => (request.artifact["destinationId"] === destinationId({ root }) ? [finding] : []);
}

/**
 * Each door record's action and decision, in order. The ledger never records an artifact — no target id is stored —
 * so which destination a record is about is its place in list order, and the holding gate, which keys on the
 * request's `destinationId`, is what proves each request names its own destination.
 *
 * @param ledger the in-memory ledger
 * @returns one `[action, status]` per record
 */
function doors({ ledger }: { ledger: MemoryDoorLedger }): readonly (readonly [unknown, unknown])[] {
  return ledger.records().map((record) => [record["action"], record["status"]] as const);
}

describe("a night over a list of destinations", () => {
  const args = unwrap(parseStoreBackupArgs({ rest: [] }));

  it("sends each reachable destination through its own door and records one attempt each", async () => {
    const home = sandboxHome();
    const [first, second] = twoFolders({ home });
    remember({ home, roots: [first, second] });
    const { seams, ledger, sealed } = world();
    expect(await reportNight({ args, home, nowIso: NOW, seams, storeSelection: STORE_URL })).toBe(EXIT_OK);
    expect(doors({ ledger })).toEqual([
      [ACTION, "pass"],
      [ACTION, "pass"],
    ]);
    expect(sealed()).toBe(1);
    const outcome = readLastOutcome({ home }) as Extract<
      ReturnType<typeof readLastOutcome>,
      { status: "destinations" }
    >;
    expect(outcome.destinations.map((attempt) => [attempt.root, attempt.status])).toEqual([
      [first, "succeeded"],
      [second, "succeeded"],
    ]);
  });

  it("does not let a refused first door stop the second, and makes no root behind the refused one", async () => {
    const home = sandboxHome();
    const [first, second] = twoFolders({ home });
    remember({ home, roots: [first, second] });
    const { seams, ledger } = world({ gates: [holding({ root: first })] });
    expect(await reportNight({ args, home, nowIso: NOW, seams, storeSelection: STORE_URL })).toBe(EXIT_ERROR);
    expect(doors({ ledger })).toEqual([
      [ACTION, "hold"],
      [ACTION, "pass"],
    ]);
    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(true);
    const outcome = readLastOutcome({ home }) as Extract<
      ReturnType<typeof readLastOutcome>,
      { status: "destinations" }
    >;
    expect(outcome.destinations.map((attempt) => attempt.status)).toEqual(["failed", "succeeded"]);
  });

  it("opens no door for a pinned drive that is out, and still writes the folder beside it", async () => {
    const home = sandboxHome();
    const [first] = twoFolders({ home });
    remember({ home, roots: [SSD_ROOT, first] });
    unwrap(
      writeVolumePins({
        home,
        pins: [
          {
            mountPoint: "/Volumes/FixtureDrive",
            root: SSD_ROOT,
            volumeName: "FixtureDrive",
            volumeUuid: "00000000-0000-4000-8000-0000000000A1",
          },
        ],
      }).mapErr((error) => [error.message]),
    );
    const { seams, ledger } = world();
    expect(await reportNight({ args, home, nowIso: NOW, seams, storeSelection: STORE_URL })).toBe(EXIT_OK);
    expect(doors({ ledger })).toEqual([[ACTION, "pass"]]);
    const outcome = readLastOutcome({ home }) as Extract<
      ReturnType<typeof readLastOutcome>,
      { status: "destinations" }
    >;
    expect(outcome.destinations.map((attempt) => [attempt.label, attempt.status])).toEqual([
      ["FixtureDrive", "drive-not-plugged-in"],
      ["this Mac", "succeeded"],
    ]);
  });
});

/**
 * A protected-path read holding the given entries.
 *
 * @param entries what the owner protects
 * @returns the reader
 */
function protects({ entries }: { entries: readonly ProtectedPath[] }): ReadBackupProtection {
  return () => ok({ entries });
}

/**
 * One no-access entry, as the owner's registry would hold it.
 *
 * @param path the protected path
 * @returns the entry
 */
function noAccess({ path }: { path: string }): ProtectedPath {
  return { addedIso: "2026-11-01T00:00:00.000Z", mode: "no-access", path, why: "fixture: kept from every session" };
}

describe("a night under the owner's protected paths", () => {
  const args = unwrap(parseStoreBackupArgs({ rest: [] }));

  it("refuses a protected destination before its door, makes no root there, and still writes the next", async () => {
    const home = sandboxHome();
    const [first, second] = twoFolders({ home });
    remember({ home, roots: [first, second] });
    const { seams, ledger } = world({ readProtection: protects({ entries: [noAccess({ path: first })] }) });
    expect(await reportNight({ args, home, nowIso: NOW, seams, storeSelection: STORE_URL })).toBe(EXIT_ERROR);
    expect(doors({ ledger })).toEqual([[ACTION, "pass"]]);
    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(true);
    const outcome = readLastOutcome({ home }) as Extract<
      ReturnType<typeof readLastOutcome>,
      { status: "destinations" }
    >;
    expect(outcome.destinations.map((attempt) => [attempt.root, attempt.status])).toEqual([
      [first, "failed"],
      [second, "succeeded"],
    ]);
  });

  it("holds the whole night when the staging root is protected: no door, no key read, no last.json", async () => {
    const home = sandboxHome();
    const [first] = twoFolders({ home });
    remember({ home, roots: [first] });
    const { seams, ledger, sealed } = world({
      readProtection: protects({ entries: [noAccess({ path: stagingRoot({ home }) })] }),
    });
    expect(await reportNight({ args, home, nowIso: NOW, seams, storeSelection: STORE_URL })).toBe(EXIT_ERROR);
    expect(ledger.records()).toEqual([]);
    expect(sealed()).toBe(0);
    expect(existsSync(stagingRoot({ home }))).toBe(false);
    expect(readLastOutcome({ home })).toBe("absent");
  });

  it("holds the whole night on a registry that does not parse, and a --local-only night too", async () => {
    const home = sandboxHome();
    const [first] = twoFolders({ home });
    remember({ home, roots: [first] });
    const malformed: ReadBackupProtection = () =>
      err(BackupProtectionErrors.malformed({ file: "/fixture/protected-paths.json", why: "fixture" }));
    const { seams, ledger, sealed } = world({ readProtection: malformed });
    expect(await reportNight({ args, home, nowIso: NOW, seams, storeSelection: STORE_URL })).toBe(EXIT_ERROR);
    const localOnly = unwrap(parseStoreBackupArgs({ rest: ["--local-only"] }));
    expect(await reportNight({ args: localOnly, home, nowIso: NOW, seams, storeSelection: STORE_URL })).toBe(
      EXIT_ERROR,
    );
    expect(ledger.records()).toEqual([]);
    expect(sealed()).toBe(0);
    expect(existsSync(stagingRoot({ home }))).toBe(false);
    expect(existsSync(first)).toBe(false);
  });

  it("records a night held on its secrets folder as failed, so --status reads it red", async () => {
    const home = sandboxHome();
    const [first] = twoFolders({ home });
    remember({ home, roots: [first] });
    const secret = join(home, "secrets", "fixture-token");
    const { seams, ledger } = world({ readProtection: protects({ entries: [noAccess({ path: secret })] }) });
    expect(await reportNight({ args, home, nowIso: NOW, seams, storeSelection: STORE_URL })).toBe(EXIT_ERROR);
    expect(ledger.records()).toEqual([]);
    const outcome = readLastOutcome({ home }) as Extract<ReturnType<typeof readLastOutcome>, { status: "failed" }>;
    expect(outcome.status).toBe("failed");
    expect(outcome.errors[0]).toContain(
      `HELD: the credentials leg's source ${join(home, "secrets")} reaches ${secret}`,
    );
  });
});

describe("a sweep under the owner's protected paths", () => {
  it("refuses a protected destination and exits non-zero, opening no door for it", async () => {
    const home = sandboxHome();
    const [first, second] = twoFolders({ home });
    remember({ home, roots: [first, second] });
    const { seams, ledger } = world({ readProtection: protects({ entries: [noAccess({ path: first })] }) });
    expect(await reportSweepOnly({ home, json: false, keepLocal: 1, override: null, seams })).toBe(EXIT_ERROR);
    expect(doors({ ledger })).toEqual([[ACTION, "pass"]]);
    expect(existsSync(first)).toBe(false);
  });

  it("holds a sweep whose staging root is protected even when every drive is out", async () => {
    const home = sandboxHome();
    remember({ home, roots: [SSD_ROOT] });
    const { seams, ledger, sealed } = world({
      readProtection: protects({ entries: [noAccess({ path: stagingRoot({ home }) })] }),
    });
    expect(await reportSweepOnly({ home, json: false, keepLocal: 1, override: null, seams })).toBe(EXIT_ERROR);
    expect(ledger.records()).toEqual([]);
    expect(sealed()).toBe(0);
  });
});

describe("a sweep over a list of destinations", () => {
  it("reads neither the key nor the master password when every drive is out, opens no door, and exits zero", async () => {
    const home = sandboxHome();
    remember({ home, roots: [SSD_ROOT] });
    unwrap(
      writeVolumePins({
        home,
        pins: [
          {
            mountPoint: "/Volumes/FixtureDrive",
            root: SSD_ROOT,
            volumeName: "FixtureDrive",
            volumeUuid: "00000000-0000-4000-8000-0000000000A1",
          },
        ],
      }).mapErr((error) => [error.message]),
    );
    const { seams, ledger, sealed } = world();
    expect(await reportSweepOnly({ home, json: false, keepLocal: 1, override: null, seams })).toBe(EXIT_OK);
    expect(sealed()).toBe(0);
    expect(ledger.records()).toEqual([]);
    expect(readLastOutcome({ home })).toBe("absent");
  });

  it("reads them once for two reachable destinations, through one door each, and leaves last.json alone", async () => {
    const home = sandboxHome();
    const [first, second] = twoFolders({ home });
    remember({ home, roots: [first, second] });
    const { seams, ledger, sealed } = world();
    expect(await reportSweepOnly({ home, json: false, keepLocal: 1, override: null, seams })).toBe(EXIT_OK);
    expect(sealed()).toBe(1);
    expect(doors({ ledger })).toEqual([
      [ACTION, "pass"],
      [ACTION, "pass"],
    ]);
    expect(readLastOutcome({ home })).toBe("absent");
  });
});
