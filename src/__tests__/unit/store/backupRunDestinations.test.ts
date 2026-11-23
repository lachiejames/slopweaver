/**
 * One night sent to a LIST of destinations — this Mac's folder and the SSD — over fakes: staged once, sent in list
 * order, one receipt each, and one destination failing, throwing or being unplugged never stopping the next. Then
 * the sweep that sends a returned SSD what it missed, from the night's retained frozen copies, and the prune that
 * waits for every destination a staging owes. One destination is `backupRunBackup.test.ts`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, type Result, unwrap } from "../../../lib/result.js";
import { keyFingerprint } from "../../../store/backup/objectCrypto.js";
import { NO_PROTECTION } from "../../../store/backup/protectedPaths.js";
import { readReceipt } from "../../../store/backup/receipts.js";
import { type BackupReport, type BackupTarget, type DestinationOutcome, runBackup } from "../../../store/backup/run.js";
import { stagedDirectoryNames, stagingRoot } from "../../../store/backup/staging.js";
import {
  type DestinationSweep,
  type DestinationSweepOutcome,
  runSweepOnly,
  type SweepTarget,
} from "../../../store/backup/sweepRun.js";
import type { BackupTransport } from "../../../store/backup/transport.js";
import type { VolumePin } from "../../../store/backup/volumePin.js";

import { destinationAt, idsOf, nightTarget, sweepTarget } from "./backupRunNights.js";
import {
  besideHome,
  FAKE_STACK,
  KEY,
  removeSandboxHomes,
  STORE_URL,
  sandboxHome,
  storedPlaintext,
  writeFailure,
} from "./backupRunWorld.js";
import { directoryTransport } from "./directoryTransport.js";

afterEach(() => {
  removeSandboxHomes();
});

const NOW = "2026-11-07T03:00:00.000Z";
const TONIGHT = "2026-11-07T03-00-00-000Z";
const PREFIX = `slopweaver/${TONIGHT}/`;
const PASSWORD = "abcdefghijklmnopqrstuvwxyz";

/**
 * The two destinations of a test: this Mac's folder beside the home, then the SSD beside that.
 *
 * @param home the sandbox home
 * @returns both roots, in list order
 */
function twoRoots({ home }: { home: string }): { mac: string; ssd: string } {
  return { mac: besideHome({ home }), ssd: join(dirname(home), "ssd") };
}

/**
 * The SSD's pin, for a night it is out.
 *
 * @param root the SSD's destination root
 * @returns a pin naming a volume that is not mounted
 */
function pinFor({ root }: { root: string }): VolumePin {
  return { mountPoint: "/Volumes/Backup SSD", root, volumeName: "Backup SSD", volumeUuid: "0000-FIXTURE" };
}

/**
 * One night to both destinations, owing both.
 *
 * @param home the sandbox home
 * @param mac this Mac's target
 * @param ssd the SSD's target
 * @param nowIso the night's instant
 * @returns the run's report
 */
function bothNight({
  home,
  mac,
  ssd,
  nowIso = NOW,
}: {
  home: string;
  mac: BackupTarget;
  ssd: BackupTarget;
  nowIso?: string;
}): Promise<Result<BackupReport>> {
  const owes = [mac.destination, ssd.destination];
  return runBackup({
    deps: FAKE_STACK,
    home,
    key: KEY,
    masterPassword: null,
    nowIso,
    obligations: owes.map((destination) => destination.id),
    owes,
    protection: NO_PROTECTION,
    storeUrl: STORE_URL,
    targets: [mac, ssd],
  });
}

/**
 * A transport whose manifest write always fails, so that destination gets everything but the manifest.
 *
 * @param root the destination directory
 * @returns the transport
 */
function manifestRefused({ root }: { root: string }): BackupTransport & { readonly uploaded: string[] } {
  const inner = directoryTransport({ root });
  return {
    ...inner,
    upload: async (args) =>
      args.objectName.endsWith("/manifest.json")
        ? err(writeFailure({ objectName: args.objectName, path: args.path, root }))
        : inner.upload(args),
  };
}

/**
 * A failed destination's lines, throwing when it did not fail.
 *
 * @param outcome the destination's outcome
 * @returns its failure lines
 */
function failedLines({ outcome }: { outcome: DestinationOutcome }): readonly string[] {
  if (outcome.status !== "failed") {
    throw new Error(`expected ${outcome.destination.root} to have failed, it was ${outcome.status}`);
  }
  return outcome.errors;
}

/**
 * A swept destination's report, throwing when it was not swept.
 *
 * @param outcome the destination's sweep outcome
 * @returns what its sweep did
 */
function sweptReport({ outcome }: { outcome: DestinationSweepOutcome }): DestinationSweep {
  if (outcome.status !== "swept") {
    throw new Error(`expected ${outcome.destination.root} to have been swept, it was ${outcome.status}`);
  }
  return outcome.report;
}

describe("a night to a list of destinations", () => {
  it("stages once and sends each destination in list order, manifest last, with its own receipt", async () => {
    const home = sandboxHome();
    const { mac, ssd } = twoRoots({ home });
    const macTransport = directoryTransport({ root: mac });
    const ssdTransport = directoryTransport({ root: ssd });
    const report = unwrap(
      await bothNight({
        home,
        mac: nightTarget({ root: mac, transport: macTransport }),
        ssd: nightTarget({ root: ssd, transport: ssdTransport }),
      }),
    );
    expect(report.destinations.map((outcome) => [outcome.destination.root, outcome.status])).toEqual([
      [mac, "succeeded"],
      [ssd, "succeeded"],
    ]);
    expect(stagedDirectoryNames({ root: stagingRoot({ home }) })).toEqual([TONIGHT]);
    expect(macTransport.uploaded.at(-1)).toBe(`${PREFIX}manifest.json`);
    expect(ssdTransport.uploaded.at(-1)).toBe(`${PREFIX}manifest.json`);
    expect(ssdTransport.uploaded).toEqual(macTransport.uploaded);
    // The same files.json reached both: frozen once, never rewritten by a send.
    const macFiles = await storedPlaintext({ objectName: `${PREFIX}files.json`, root: mac });
    const ssdFiles = await storedPlaintext({ objectName: `${PREFIX}files.json`, root: ssd });
    expect(ssdFiles.equals(macFiles)).toBe(true);
    expect(macFiles.equals(readFileSync(join(report.directory, "files.json")))).toBe(true);
    const [macId, ssdId] = idsOf({ roots: [mac, ssd] });
    expect(readReceipt({ directory: report.directory, id: macId! })!.destination).toBe(mac);
    expect(readReceipt({ directory: report.directory, id: ssdId! })!.destination).toBe(ssd);
    expect(report.released).toEqual([TONIGHT]);
  });

  it("sends the SSD when this Mac's folder fails, and keeps the frozen copies the folder still lacks", async () => {
    const home = sandboxHome();
    const { mac, ssd } = twoRoots({ home });
    const report = unwrap(
      await bothNight({
        home,
        mac: nightTarget({ root: mac, transport: manifestRefused({ root: mac }) }),
        ssd: nightTarget({ root: ssd }),
      }),
    );
    expect(report.destinations.map((outcome) => outcome.status)).toEqual(["failed", "succeeded"]);
    const [macId, ssdId] = idsOf({ roots: [mac, ssd] });
    expect(readReceipt({ directory: report.directory, id: macId! })).toBeNull();
    expect(readReceipt({ directory: report.directory, id: ssdId! })!.prefix).toBe(PREFIX);
    expect(report.released).toEqual([]);
    expect(report.pruned).toEqual([]);
  });

  it("names the SSD failed after this Mac's folder succeeded, and the folder's receipt stands", async () => {
    const home = sandboxHome();
    const { mac, ssd } = twoRoots({ home });
    const report = unwrap(
      await bothNight({
        home,
        mac: nightTarget({ root: mac }),
        ssd: nightTarget({ root: ssd, transport: manifestRefused({ root: ssd }) }),
      }),
    );
    expect(report.destinations.map((outcome) => outcome.status)).toEqual(["succeeded", "failed"]);
    expect(failedLines({ outcome: report.destinations[1]! }).join(" ")).toContain(`${PREFIX}manifest.json`);
    expect(readReceipt({ directory: report.directory, id: idsOf({ roots: [mac] })[0]! })!.prefix).toBe(PREFIX);
    expect(report.released).toEqual([]);
  });

  it("turns a destination that throws into its own failure, and still sends the next", async () => {
    const home = sandboxHome();
    const { mac, ssd } = twoRoots({ home });
    const throwing: BackupTarget = {
      destination: destinationAt({ root: mac }),
      kind: "reachable",
      send: async () => {
        throw new Error("fixture door exploded");
      },
    };
    const report = unwrap(await bothNight({ home, mac: throwing, ssd: nightTarget({ root: ssd }) }));
    expect(report.destinations[0]).toEqual({
      destination: destinationAt({ root: mac }),
      errors: [`writing to ${mac} threw: fixture door exploded`],
      status: "failed",
    });
    expect(report.destinations[1]!.status).toBe("succeeded");
  });

  it("records an unplugged SSD as out, sends this Mac's folder, and lands the key wrap first at each destination", async () => {
    const home = sandboxHome();
    const { mac, ssd } = twoRoots({ home });
    const macTransport = directoryTransport({ root: mac });
    const owes = [destinationAt({ root: mac }), destinationAt({ root: ssd })];
    const report = unwrap(
      await runBackup({
        deps: FAKE_STACK,
        home,
        key: KEY,
        masterPassword: PASSWORD,
        nowIso: NOW,
        obligations: owes.map((destination) => destination.id),
        owes,
        protection: NO_PROTECTION,
        storeUrl: STORE_URL,
        targets: [
          nightTarget({ masterPassword: PASSWORD, root: mac, transport: macTransport }),
          { destination: owes[1]!, kind: "not-plugged-in", pin: pinFor({ root: ssd }) },
        ],
      }),
    );
    expect(report.destinations.map((outcome) => outcome.status)).toEqual(["succeeded", "drive-not-plugged-in"]);
    expect(macTransport.uploaded[0]).toBe(`slopweaver/keys/${keyFingerprint({ key: KEY })}.wrap`);
    // Tonight is the SSD's to get later, so its frozen copies stay.
    expect(report.released).toEqual([]);

    // The SSD comes back: the sweep sends it tonight's staging — the night's files from the retained snapshot,
    // its key wrap before any of it — and nothing again to the folder that already holds it.
    const ssdTransport = directoryTransport({ root: ssd });
    const sentToMac = macTransport.uploaded.length;
    const swept = await runSweepOnly({
      home,
      obligations: owes.map((destination) => destination.id),
      targets: [
        sweepTarget({ home, masterPassword: PASSWORD, root: mac, transport: macTransport }),
        sweepTarget({ home, masterPassword: PASSWORD, root: ssd, transport: ssdTransport }),
      ],
    });
    const [macSweep, ssdSweep] = swept.destinations;
    expect(sweptReport({ outcome: macSweep! }).sweep.recovered).toEqual([]);
    expect(macTransport.uploaded.length).toBe(sentToMac);
    expect(sweptReport({ outcome: ssdSweep! }).sweep.recovered.map((one) => [one.prefix, one.filesMissing])).toEqual([
      [PREFIX, []],
    ]);
    expect(ssdTransport.uploaded[0]).toBe(`slopweaver/keys/${keyFingerprint({ key: KEY })}.wrap`);
    expect(ssdTransport.uploaded.filter((name) => name.startsWith("slopweaver/blobs/"))).toHaveLength(2);
    expect(swept.released).toEqual([TONIGHT]);
  });
});

describe("pruning a list of destinations", () => {
  it("keeps a night the SSD was out for until the SSD holds it, then lets it go", async () => {
    const home = sandboxHome();
    const { mac, ssd } = twoRoots({ home });
    const out: BackupTarget = {
      destination: destinationAt({ root: ssd }),
      kind: "not-plugged-in",
      pin: pinFor({ root: ssd }),
    };
    unwrap(await bothNight({ home, mac: nightTarget({ root: mac }), nowIso: "2026-11-06T03:00:00.000Z", ssd: out }));
    const second = unwrap(await bothNight({ home, mac: nightTarget({ root: mac }), ssd: nightTarget({ root: ssd }) }));
    // The 6th is owed to the SSD, so neither the prune nor the release touches it.
    expect(second.pruned).toEqual([]);
    expect(second.stranded.map((one) => [one.destination.root, one.names])).toEqual([
      [mac, []],
      [ssd, ["2026-11-06T03-00-00-000Z"]],
    ]);
    const targets: SweepTarget[] = [sweepTarget({ home, root: mac }), sweepTarget({ home, root: ssd })];
    const swept = await runSweepOnly({ home, obligations: idsOf({ roots: [mac, ssd] }), targets });
    expect(swept.released).toEqual(["2026-11-06T03-00-00-000Z"]);
    expect(swept.pruned).toEqual(["2026-11-06T03-00-00-000Z"]);
    expect(stagedDirectoryNames({ root: stagingRoot({ home }) })).toEqual([TONIGHT]);
  });
});
