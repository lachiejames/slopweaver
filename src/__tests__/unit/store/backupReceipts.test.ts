/**
 * Per-destination receipts, what a staging owes, and what pruning may let go of — over real staging directories
 * in a throwaway root.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { type ConfiguredDestination, configuredDestination } from "../../../store/backup/destinationConfig.js";
import { FILES_MANIFEST } from "../../../store/backup/plan.js";
import {
  lastUploadsOnDisk,
  readReceipt,
  receiptPath,
  SINGLE_UPLOAD_RECEIPT_FILE,
  writeReceipt,
} from "../../../store/backup/receipts.js";
import { isStranded, isUnfinished, pruneStaging } from "../../../store/backup/staging.js";
import {
  pruneObligations,
  STAGING_DESTINATIONS_FILE,
  stagingObligation,
  writeStagingDestinations,
} from "../../../store/backup/stagingDestinations.js";

const MAC = unwrap(configuredDestination({ address: "/Users/someone/backups" }));
const SSD = unwrap(configuredDestination({ address: "/Volumes/FixtureDrive/backups" }));
const ONE_OFF = unwrap(configuredDestination({ address: "/Users/someone/one-off" }));

const minted: string[] = [];

afterEach(() => {
  minted.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/**
 * A throwaway staging root.
 *
 * @returns the root
 */
function stagingRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), "backup-receipts-"));
  minted.push(root);
  return root;
}

/**
 * One staging directory under `root`, finished (carrying `files.json`) unless told otherwise.
 *
 * @param root the staging root
 * @param name the staging's instant name
 * @param finished whether it carries the completeness marker
 * @returns the staging directory
 */
function staging({ root, name, finished = true }: { root: string; name: string; finished?: boolean }): string {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  if (finished) {
    writeFileSync(join(directory, FILES_MANIFEST), "{}");
  }
  return directory;
}

/**
 * Write a well-formed per-destination receipt.
 *
 * @param directory the staging directory
 * @param destination the destination it reached
 * @param uploadedAtIso when
 */
function received({
  directory,
  destination,
  uploadedAtIso = "2026-11-08T03:00:00.000Z",
}: {
  directory: string;
  destination: ConfiguredDestination;
  uploadedAtIso?: string;
}): void {
  writeReceipt({
    destination,
    directory,
    receipt: {
      destination: destination.root,
      encryption: { keyFingerprint: "FIXTURE", scheme: "fixture" },
      objects: [],
      prefix: "slopweaver/2026-11-08T03-00-00-000Z/",
      uploadedAtIso,
    },
  });
}

/**
 * Write a single `upload-receipt.json` naming `destination` in its own field.
 *
 * @param directory the staging directory
 * @param destination what its `destination` field says
 */
function singleReceipt({ directory, destination }: { directory: string; destination: string }): void {
  writeFileSync(
    join(directory, SINGLE_UPLOAD_RECEIPT_FILE),
    JSON.stringify({ destination, prefix: "slopweaver/x/", uploadedAtIso: "2026-11-01T03:00:00.000Z" }),
  );
}

describe("a per-destination receipt", () => {
  it("lives at a path keyed by the destination's stable id, one per destination", () => {
    expect(receiptPath({ directory: "/s", id: MAC.id })).toBe(`/s/receipts/${MAC.id}.json`);
    expect(receiptPath({ directory: "/s", id: SSD.id })).not.toBe(receiptPath({ directory: "/s", id: MAC.id }));
  });

  it("counts for the destination it was written for and no other", () => {
    const directory = staging({ name: "2026-11-08T03-00-00-000Z", root: stagingRootDir() });
    received({ destination: MAC, directory });
    expect(readReceipt({ directory, id: MAC.id })).toEqual({
      destination: MAC.root,
      prefix: "slopweaver/2026-11-08T03-00-00-000Z/",
      uploadedAtIso: "2026-11-08T03:00:00.000Z",
    });
    expect(readReceipt({ directory, id: SSD.id })).toBeNull();
  });

  it("counts for nobody when it is truncated, or names another root than its file's id", () => {
    const directory = staging({ name: "2026-11-08T03-00-00-000Z", root: stagingRootDir() });
    mkdirSync(join(directory, "receipts"));
    writeFileSync(receiptPath({ directory, id: MAC.id }), '{"destination":');
    writeFileSync(
      receiptPath({ directory, id: SSD.id }),
      JSON.stringify({ destination: MAC.root, prefix: "p/", uploadedAtIso: "2026-11-08T03:00:00.000Z" }),
    );
    expect(readReceipt({ directory, id: MAC.id })).toBeNull();
    expect(readReceipt({ directory, id: SSD.id })).toBeNull();
  });
});

describe("a single upload-receipt.json", () => {
  it("counts only for the root its own destination field names, spelled as a path or a file:// URL", () => {
    const directory = staging({ name: "2026-11-01T03-00-00-000Z", root: stagingRootDir() });
    singleReceipt({ destination: `file://${MAC.root}`, directory });
    expect(readReceipt({ directory, id: MAC.id })!.prefix).toBe("slopweaver/x/");
    expect(readReceipt({ directory, id: SSD.id })).toBeNull();
  });

  it("counts for nobody when it says unreported, a relative path, or does not parse", () => {
    const root = stagingRootDir();
    const unreported = staging({ name: "a", root });
    singleReceipt({ destination: "unreported", directory: unreported });
    const relative = staging({ name: "b", root });
    singleReceipt({ destination: "backups", directory: relative });
    const truncated = staging({ name: "c", root });
    writeFileSync(join(truncated, SINGLE_UPLOAD_RECEIPT_FILE), "{");
    expect([unreported, relative, truncated].map((directory) => readReceipt({ directory, id: MAC.id }))).toEqual([
      null,
      null,
      null,
    ]);
    expect([unreported, relative, truncated].map((directory) => isStranded({ destination: MAC, directory }))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("loses to a valid per-destination receipt, and a read deletes neither", () => {
    const directory = staging({ name: "2026-11-08T03-00-00-000Z", root: stagingRootDir() });
    singleReceipt({ destination: MAC.root, directory });
    received({ destination: MAC, directory });
    expect(readReceipt({ directory, id: MAC.id })!.prefix).toBe("slopweaver/2026-11-08T03-00-00-000Z/");
    expect(existsSync(join(directory, SINGLE_UPLOAD_RECEIPT_FILE))).toBe(true);
  });
});

describe("which stagings a destination still lacks", () => {
  it("strands one staging for the SSD while it is complete for this Mac", () => {
    const directory = staging({ name: "2026-11-08T03-00-00-000Z", root: stagingRootDir() });
    writeStagingDestinations({ destinations: [MAC, SSD], directory });
    received({ destination: MAC, directory });
    expect(isStranded({ destination: MAC, directory })).toBe(false);
    expect(isStranded({ destination: SSD, directory })).toBe(true);
  });

  it("never strands a staging for a destination added after it was made", () => {
    const directory = staging({ name: "2026-11-08T03-00-00-000Z", root: stagingRootDir() });
    writeStagingDestinations({ destinations: [MAC], directory });
    expect(isStranded({ destination: SSD, directory })).toBe(false);
    expect(stagingObligation({ directory })).toEqual({ ids: [MAC.id], kind: "recorded" });
  });

  it("reads an unfinished staging as unfinished even when it holds a receipt, and strands it for nobody", () => {
    const directory = staging({ finished: false, name: "2026-11-08T03-00-00-000Z", root: stagingRootDir() });
    received({ destination: MAC, directory });
    expect(isUnfinished({ directory })).toBe(true);
    expect(isStranded({ destination: SSD, directory })).toBe(false);
  });
});

describe("pruning against every destination a staging owes", () => {
  it("waits for every owed destination, keeps the newest eligible copies, and keeps every owed one", () => {
    const root = stagingRootDir();
    const names = ["2026-11-05T03-00-00-000Z", "2026-11-06T03-00-00-000Z", "2026-11-07T03-00-00-000Z"];
    const [oldest, middle, newest] = names.map((name) => staging({ name, root }));
    [oldest!, middle!, newest!].forEach((directory) => {
      writeStagingDestinations({ destinations: [MAC, SSD], directory });
      received({ destination: MAC, directory });
    });
    received({ destination: SSD, directory: oldest! });
    received({ destination: SSD, directory: newest! });
    const obligations = pruneObligations({ active: [MAC, SSD], remembered: [MAC, SSD] });
    expect(pruneStaging({ keep: 1, obligations, root })).toEqual(["2026-11-05T03-00-00-000Z"]);
    expect([oldest!, middle!, newest!].map((directory) => existsSync(directory))).toEqual([false, true, true]);
  });

  it("keeps a copy whose receipt is missing, truncated, or whose staging record does not parse", () => {
    const root = stagingRootDir();
    const missing = staging({ name: "2026-11-01T03-00-00-000Z", root });
    writeStagingDestinations({ destinations: [MAC], directory: missing });
    const truncated = staging({ name: "2026-11-02T03-00-00-000Z", root });
    writeStagingDestinations({ destinations: [MAC], directory: truncated });
    mkdirSync(join(truncated, "receipts"));
    writeFileSync(receiptPath({ directory: truncated, id: MAC.id }), "{");
    const unreadable = staging({ name: "2026-11-03T03-00-00-000Z", root });
    writeFileSync(join(unreadable, STAGING_DESTINATIONS_FILE), "{");
    received({ destination: MAC, directory: unreadable });
    expect(pruneStaging({ keep: 0, obligations: [MAC.id], root })).toEqual([]);
  });

  it("never lets a one-run override release a staging still owed to the remembered SSD", () => {
    const root = stagingRootDir();
    const owed = staging({ name: "2026-11-06T03-00-00-000Z", root });
    writeStagingDestinations({ destinations: [MAC, SSD], directory: owed });
    received({ destination: MAC, directory: owed });
    const oneOff = staging({ name: "2026-11-07T03-00-00-000Z", root });
    writeStagingDestinations({ destinations: [ONE_OFF], directory: oneOff });
    received({ destination: ONE_OFF, directory: oneOff });
    const obligations = pruneObligations({ active: [ONE_OFF], remembered: [MAC, SSD] });
    expect(obligations).toEqual([MAC.id, SSD.id, ONE_OFF.id]);
    expect(pruneStaging({ keep: 0, obligations, root })).toEqual(["2026-11-07T03-00-00-000Z"]);
    expect(existsSync(owed)).toBe(true);
  });

  it("lifts a removed destination's obligation, and reads an unrecorded staging as owing every configured one", () => {
    const root = stagingRootDir();
    const recorded = staging({ name: "2026-11-06T03-00-00-000Z", root });
    writeStagingDestinations({ destinations: [MAC, SSD], directory: recorded });
    received({ destination: MAC, directory: recorded });
    const unrecorded = staging({ name: "2026-11-05T03-00-00-000Z", root });
    singleReceipt({ destination: MAC.root, directory: unrecorded });
    expect(pruneStaging({ keep: 0, obligations: [MAC.id, SSD.id], root })).toEqual([]);
    expect(pruneStaging({ keep: 0, obligations: [MAC.id], root })).toEqual([
      "2026-11-05T03-00-00-000Z",
      "2026-11-06T03-00-00-000Z",
    ]);
  });
});

describe("the last write to each destination", () => {
  it("is read independently per destination off the newest staging holding its receipt", () => {
    const root = stagingRootDir();
    const older = staging({ name: "2026-11-06T03-00-00-000Z", root });
    received({ destination: MAC, directory: older, uploadedAtIso: "2026-11-06T03:00:00.000Z" });
    received({ destination: SSD, directory: older, uploadedAtIso: "2026-11-06T03:00:00.000Z" });
    const newer = staging({ name: "2026-11-07T03-00-00-000Z", root });
    received({ destination: MAC, directory: newer, uploadedAtIso: "2026-11-07T03:00:00.000Z" });
    const uploads = lastUploadsOnDisk({ destinations: [MAC, SSD, ONE_OFF], stagings: [older, newer] });
    expect(uploads.map((entry) => entry.upload?.uploadedAtIso)).toEqual([
      "2026-11-07T03:00:00.000Z",
      "2026-11-06T03:00:00.000Z",
      undefined,
    ]);
    expect(uploads.map((entry) => entry.upload?.directory)).toEqual([newer, older, undefined]);
  });
});
