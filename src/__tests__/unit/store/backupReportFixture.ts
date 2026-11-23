/**
 * Report values for the backup verbs' pure tests: a destination at a root, what one destination was sent, and a
 * night over a list of destination outcomes. No Docker, no filesystem.
 */
import { NO_CHUNKS } from "../../../store/backup/chunkPlan.js";
import { type ConfiguredDestination, destinationId } from "../../../store/backup/destinationConfig.js";
import type { BackupReport, DestinationOutcome } from "../../../store/backup/run.js";
import type { DestinationSendReport } from "../../../store/backup/sendStaging.js";
import type { VolumePin } from "../../../store/backup/volumePin.js";

/**
 * A configured destination at a root.
 *
 * @param root the destination root
 * @returns the destination
 */
export function destinationFixture({ root }: { root: string }): ConfiguredDestination {
  return { address: root, id: destinationId({ root }), root };
}

/** This Mac's own folder. */
export const MAC = destinationFixture({ root: "/Users/someone/backups" });

/** The pinned SSD's folder. */
export const SSD = destinationFixture({ root: "/Volumes/FixtureDrive/backups" });

/** The SSD's pin. */
export const SSD_PIN: VolumePin = {
  mountPoint: "/Volumes/FixtureDrive",
  root: SSD.root,
  volumeName: "FixtureDrive",
  volumeUuid: "00000000-0000-4000-8000-0000000000A1",
};

/** A night's manifest. */
export const MANIFEST = {
  createdAtIso: "2026-09-14T03:00:00.000Z",
  database: "postgres",
  dump: { bytes: 282464403, chunked: null, sha256: "1ce0c19a87cf5c60466f5ac2fca0ee2cc4dde08b1e30af44582f479e73212d9a" },
  extensions: [],
  pgDumpVersion: "pg_dump (PostgreSQL) 17.6",
  project: "slopweaver",
  schemas: ["public"],
  secrets: null,
  storage: { bytes: 2048, sha256: "d31df497b8e4e16c29949797c81791c607b5a909ae889a33ddb22573b46bdc26" },
  vault: null,
  version: 1 as const,
};

/**
 * What one destination was sent.
 *
 * @param root the destination root the receipt names
 * @param keyWrap what became of the wrap there
 * @param prefix the object prefix the receipt records
 * @returns the send report
 */
export function sentFixture({
  root,
  keyWrap = { objectName: "slopweaver/keys/fp-0123abcd.wrap", state: "written" },
  prefix = "slopweaver/x/",
}: {
  root: string;
  keyWrap?: DestinationSendReport["keyWrap"];
  prefix?: string;
}): DestinationSendReport {
  return {
    dumpChunks: NO_CHUNKS,
    files: { bytes: 9024, chunks: NO_CHUNKS, count: 33, uploaded: 2, uploadedBytes: 1024, vanished: 0 },
    keyWrap,
    receipt: {
      destination: root,
      encryption: { keyFingerprint: "fp-0123abcd", scheme: "aes-256-gcm-stream-v1" },
      objects: [
        {
          bytes: 282464403,
          name: "slopweaver/x/store.dump",
          sha256: "1d1af6c4bd2e7e9b7e4e3c0d3f39f1b2c5a7d9e0f1a2b3c4d5e6f708192a3b4c",
        },
      ],
      prefix,
      uploadedAtIso: "2026-09-14T03:01:00.000Z",
    },
  };
}

/**
 * A night's report over the given destinations.
 *
 * @param destinations what became of each
 * @param stranded what each destination still lacks
 * @param vanished how many files went missing mid-read
 * @param skippedProtectedPaths what the owner's protection withheld from the walk
 * @returns the report
 */
export function nightFixture({
  destinations,
  stranded = [],
  vanished = 0,
  skippedProtectedPaths = [],
}: {
  destinations: readonly DestinationOutcome[];
  stranded?: BackupReport["stranded"];
  vanished?: number;
  skippedProtectedPaths?: BackupReport["files"]["skippedProtectedPaths"];
}): BackupReport {
  return {
    destinations,
    directory: "/home/backups/store/x",
    files: { bytes: 9024, count: 33, skippedProtectedPaths, vanished },
    manifest: MANIFEST,
    pruned: [],
    released: [],
    stranded,
    unremoved: [],
  };
}
