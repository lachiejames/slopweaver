/**
 * `sweepStrandedStagings` on its own, over stagings written by hand: which prefix a staging goes to, when a
 * receipt is and is not written, how a throw or a refusing transport is reported, and the order of the sends.
 * `runSweepOnly` and the credentials leg are in `backupRunSweep.test.ts`.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err } from "../../../lib/result.js";
import { BACKUP_FILES, blobObjectName, FILES_MANIFEST, SUPABASE_PROJECT_ID } from "../../../store/backup/plan.js";
import { receiptPath } from "../../../store/backup/receipts.js";
import { stagingRoot } from "../../../store/backup/staging.js";
import { sweepStrandedStagings } from "../../../store/backup/sweep.js";
import { StagingSweepErrors } from "../../../store/backup/sweepErrors.js";
import type { BackupTransport } from "../../../store/backup/transport.js";
import { BackupUploadErrors } from "../../../store/backup/uploadErrors.js";

import { destinationAt } from "./backupRunNights.js";
import {
  besideHome,
  ENCRYPTION,
  removeSandboxHomes,
  sandboxHome,
  sha256Of,
  underKey,
  writeFailure,
} from "./backupRunWorld.js";
import { directoryTransport } from "./directoryTransport.js";

afterEach(() => {
  removeSandboxHomes();
});

/**
 * Where a staging's receipt for the destination beside the home is written.
 *
 * @param home the sandbox home
 * @param directory the staging directory
 * @returns the receipt's path
 */
function receiptFile({ home, directory }: { home: string; directory: string }): string {
  return receiptPath({ directory, id: destinationAt({ root: besideHome({ home }) }).id });
}

describe("sweepStrandedStagings on its own", () => {
  /** A finished staging directory holding two known payloads and a manifest that describes them. */
  function stageByHand({
    root,
    name,
    manifest = {},
    files = [],
  }: {
    root: string;
    name: string;
    manifest?: { createdAtIso?: string; project?: string };
    files?: readonly { bytes: number; relativePath: string; sha256: string }[];
  }): string {
    const directory = join(root, name);
    const dump = "PGDMP fake dump bytes";
    const tar = "fake tar bytes";
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, FILES_MANIFEST),
      JSON.stringify({ createdAtIso: "2026-09-20T05:49:58.043Z", files, roots: ["corpus"], version: 1 }),
    );
    writeFileSync(join(directory, BACKUP_FILES.dump), dump);
    writeFileSync(join(directory, BACKUP_FILES.storage), tar);
    writeFileSync(
      join(directory, BACKUP_FILES.manifest),
      JSON.stringify({
        // The instant the directory is named for, as `runBackup` names it.
        createdAtIso: name.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d\d\d)Z$/, "T$1:$2:$3.$4Z"),
        database: "postgres",
        dump: { bytes: dump.length, sha256: sha256Of({ bytes: Buffer.from(dump) }) },
        extensions: [],
        pgDumpVersion: "pg_dump (PostgreSQL) 17.6",
        project: SUPABASE_PROJECT_ID,
        schemas: ["public"],
        secrets: null,
        storage: { bytes: tar.length, sha256: sha256Of({ bytes: Buffer.from(tar) }) },
        version: 1,
        ...manifest,
      }),
    );
    return directory;
  }

  it("sends a stranded staging under its OWN prefix and writes its receipt", async () => {
    const home = sandboxHome();
    const root = stagingRoot({ home });
    const stranded = stageByHand({ name: "2026-09-20T05-49-58-043Z", root });
    const destination = besideHome({ home });
    const transport = directoryTransport({ root: destination });
    const report = await sweepStrandedStagings({
      destination: destinationAt({ root: destination }),
      encryption: ENCRYPTION,
      root,
      transport: underKey({ inner: transport }),
    });
    expect(report.recovered.map((staging) => staging.prefix)).toEqual(["slopweaver/2026-09-20T05-49-58-043Z/"]);
    expect(report.unrecoverable).toEqual([]);
    expect(report.unfinished).toEqual([]);
    expect(transport.uploaded).toEqual([
      "slopweaver/2026-09-20T05-49-58-043Z/files.json",
      "slopweaver/2026-09-20T05-49-58-043Z/store.dump",
      "slopweaver/2026-09-20T05-49-58-043Z/storage.tar",
      "slopweaver/2026-09-20T05-49-58-043Z/manifest.json",
    ]);
    const receipt = JSON.parse(readFileSync(receiptFile({ directory: stranded, home }), "utf8")) as {
      destination: string;
      encryption: unknown;
    };
    expect(receipt.destination).toBe(destination);
    expect(receipt.encryption).toEqual(ENCRYPTION);
  });

  it("names every object its files.json names that the destination lacks, before the receipt lets the pruner go", async () => {
    const home = sandboxHome();
    const root = stagingRoot({ home });
    const lost = "c".repeat(64);
    const stranded = stageByHand({
      files: [{ bytes: 9, relativePath: "knowledge/lessons.jsonl", sha256: lost }],
      name: "2026-09-20T05-49-58-043Z",
      root,
    });
    const report = await sweepStrandedStagings({
      destination: destinationAt({ root: besideHome({ home }) }),
      encryption: ENCRYPTION,
      root,
      transport: underKey({ inner: directoryTransport({ root: besideHome({ home }) }) }),
    });
    expect(report.recovered.map((staging) => staging.filesMissing)).toEqual([
      [blobObjectName({ project: SUPABASE_PROJECT_ID, sha256: lost })],
    ]);
    expect(existsSync(receiptFile({ directory: stranded, home }))).toBe(true);
  });

  it("writes no receipt when files.json changes on disk between its upload and the check", async () => {
    const home = sandboxHome();
    const root = stagingRoot({ home });
    const stranded = stageByHand({
      files: [{ bytes: 9, relativePath: "knowledge/lessons.jsonl", sha256: "c".repeat(64) }],
      name: "2026-09-20T05-49-58-043Z",
      root,
    });
    const inner = directoryTransport({ root: besideHome({ home }) });
    // Once files.json has landed, something rewrites the local copy to name nothing at all.
    const rewriting: BackupTransport = {
      ...inner,
      upload: async (args) => {
        const landed = await inner.upload(args);
        if (args.objectName.endsWith(FILES_MANIFEST)) {
          writeFileSync(
            join(stranded, FILES_MANIFEST),
            JSON.stringify({ createdAtIso: "2026-09-20T05:49:58.043Z", files: [], roots: ["corpus"], version: 1 }),
          );
        }
        return landed;
      },
    };
    const report = await sweepStrandedStagings({
      destination: destinationAt({ root: besideHome({ home }) }),
      encryption: ENCRYPTION,
      root,
      transport: underKey({ inner: rewriting }),
    });
    expect(report.recovered).toEqual([]);
    expect(report.unrecoverable.map((staging) => staging.error.code)).toEqual(["STAGING_FILES_UNCHECKED"]);
    expect(existsSync(receiptFile({ directory: stranded, home }))).toBe(false);
  });

  it("turns a THROW out of a recovery into a report line, because tonight's backup is already in the destination", async () => {
    const home = sandboxHome();
    const root = stagingRoot({ home });
    const stranded = stageByHand({ name: "2026-09-20T05-49-58-043Z", root });
    const inner = directoryTransport({ root: besideHome({ home }) });
    // The staging is made read-only under the sweep once its objects are sent, so the receipt write — which
    // fails loud by design — throws. That throw, not a transport failure, is what the sweep has to contain.
    const lockingUp: BackupTransport = {
      ...inner,
      upload: async (args) => {
        const landed = await inner.upload(args);
        if (args.objectName.endsWith(BACKUP_FILES.manifest)) {
          chmodSync(stranded, 0o500);
        }
        return landed;
      },
    };
    const report = await sweepStrandedStagings({
      destination: destinationAt({ root: besideHome({ home }) }),
      encryption: ENCRYPTION,
      root,
      transport: underKey({ inner: lockingUp }),
    });
    chmodSync(stranded, 0o700);
    expect(report.recovered).toEqual([]);
    expect(report.unrecoverable.map((staging) => [staging.directory, staging.error.code])).toEqual([
      [stranded, "STAGING_RECOVERY_THREW"],
    ]);
    expect(existsSync(receiptFile({ directory: stranded, home }))).toBe(false);
  });

  it("writes no receipt when an upload reports an object other than the one it was asked to write", async () => {
    const home = sandboxHome();
    const root = stagingRoot({ home });
    const stranded = stageByHand({ name: "2026-09-20T05-49-58-043Z", root });
    const inner = directoryTransport({ root: besideHome({ home }) });
    const misplacing: BackupTransport = {
      ...inner,
      upload: async (args) =>
        args.objectName.endsWith(BACKUP_FILES.dump)
          ? inner.upload({ ...args, objectName: "elsewhere/store.dump" })
          : inner.upload(args),
    };
    const report = await sweepStrandedStagings({
      destination: destinationAt({ root: besideHome({ home }) }),
      encryption: ENCRYPTION,
      root,
      transport: underKey({ inner: misplacing }),
      uploadRetry: { isRetryable: () => true, minTimeoutMs: 0, randomize: false, retries: 0 },
    });
    expect(report.unrecoverable.map((staging) => staging.error)).toEqual([
      StagingSweepErrors.uploadFailed({
        directory: stranded,
        problems: [
          BackupUploadErrors.stagedFileMisplaced({
            landed: "elsewhere/store.dump",
            objectName: "slopweaver/2026-09-20T05-49-58-043Z/store.dump",
          }).message,
        ],
      }),
    ]);
    expect(existsSync(receiptFile({ directory: stranded, home }))).toBe(false);
  });

  it("writes no receipt for a staged dump altered at the same length after its manifest measured it", async () => {
    const home = sandboxHome();
    const root = stagingRoot({ home });
    const stranded = stageByHand({ name: "2026-09-20T05-49-58-043Z", root });
    const altered = Buffer.from("PGDMP FAKE DUMP BYTES");
    writeFileSync(join(stranded, BACKUP_FILES.dump), altered);
    const report = await sweepStrandedStagings({
      destination: destinationAt({ root: besideHome({ home }) }),
      encryption: ENCRYPTION,
      root,
      transport: underKey({ inner: directoryTransport({ root: besideHome({ home }) }) }),
      uploadRetry: { isRetryable: () => true, minTimeoutMs: 0, randomize: false, retries: 0 },
    });
    expect(report.unrecoverable.map((staging) => staging.error)).toEqual([
      StagingSweepErrors.uploadFailed({
        directory: stranded,
        problems: [
          BackupUploadErrors.stagedFileAltered({
            objectName: "slopweaver/2026-09-20T05-49-58-043Z/store.dump",
            recorded: sha256Of({ bytes: Buffer.from("PGDMP fake dump bytes") }),
            sent: sha256Of({ bytes: altered }),
          }).message,
        ],
      }),
    ]);
    expect(existsSync(receiptFile({ directory: stranded, home }))).toBe(false);
  });

  it("writes no receipt when the staged manifest is rewritten after the sweep parsed it", async () => {
    const home = sandboxHome();
    const root = stagingRoot({ home });
    const stranded = stageByHand({ name: "2026-09-20T05-49-58-043Z", root });
    const manifestPath = join(stranded, BACKUP_FILES.manifest);
    const parsed = readFileSync(manifestPath);
    const rewritten = Buffer.from(parsed.toString("utf8").replace('"database":"postgres"', '"database":"other"'));
    const inner = directoryTransport({ root: besideHome({ home }) });
    // The dump is sent against the manifest as parsed; the rewrite lands before the manifest itself goes last.
    const rewriting: BackupTransport = {
      ...inner,
      upload: async (args) => {
        if (args.objectName.endsWith(BACKUP_FILES.dump)) {
          writeFileSync(manifestPath, rewritten);
        }
        return inner.upload(args);
      },
    };
    const report = await sweepStrandedStagings({
      destination: destinationAt({ root: besideHome({ home }) }),
      encryption: ENCRYPTION,
      root,
      transport: underKey({ inner: rewriting }),
      uploadRetry: { isRetryable: () => true, minTimeoutMs: 0, randomize: false, retries: 0 },
    });
    expect(report.unrecoverable.map((staging) => staging.error)).toEqual([
      StagingSweepErrors.uploadFailed({
        directory: stranded,
        problems: [
          BackupUploadErrors.stagedFileAltered({
            objectName: "slopweaver/2026-09-20T05-49-58-043Z/manifest.json",
            recorded: sha256Of({ bytes: parsed }),
            sent: sha256Of({ bytes: rewritten }),
          }).message,
        ],
      }),
    ]);
    expect(existsSync(receiptFile({ directory: stranded, home }))).toBe(false);
  });

  it("reports a staged upload the transport keeps refusing as unsendable, having retried it", async () => {
    const home = sandboxHome();
    const root = stagingRoot({ home });
    const stranded = stageByHand({ name: "2026-09-20T05-49-58-043Z", root });
    const attempts: string[] = [];
    const destination = besideHome({ home });
    const down: BackupTransport = {
      ...directoryTransport({ root: destination }),
      upload: async (args) => {
        attempts.push(args.objectName);
        return err(writeFailure({ objectName: args.objectName, path: args.path, root: destination }));
      },
    };
    const report = await sweepStrandedStagings({
      destination: destinationAt({ root: destination }),
      encryption: ENCRYPTION,
      root,
      transport: underKey({ inner: down }),
      uploadRetry: { isRetryable: () => true, minTimeoutMs: 0, randomize: false, retries: 2 },
    });
    expect(report.unrecoverable.map((staging) => [staging.directory, staging.error.code])).toEqual([
      [stranded, "STAGING_UPLOAD_FAILED"],
    ]);
    expect(attempts).toEqual([
      "slopweaver/2026-09-20T05-49-58-043Z/files.json",
      "slopweaver/2026-09-20T05-49-58-043Z/files.json",
      "slopweaver/2026-09-20T05-49-58-043Z/files.json",
    ]);
  });

  it("retries a staged upload whose session failed, and the staging still lands", async () => {
    const home = sandboxHome();
    const root = stagingRoot({ home });
    const stranded = stageByHand({ name: "2026-09-20T05-49-58-043Z", root });
    const destination = besideHome({ home });
    const inner = directoryTransport({ root: destination });
    let failedOnce = false;
    const flaky: BackupTransport = {
      ...inner,
      upload: async (args) => {
        if (!failedOnce && args.objectName.endsWith(BACKUP_FILES.dump)) {
          failedOnce = true;
          return err(writeFailure({ objectName: args.objectName, path: args.path, root: destination }));
        }
        return inner.upload(args);
      },
    };
    const report = await sweepStrandedStagings({
      destination: destinationAt({ root: destination }),
      encryption: ENCRYPTION,
      root,
      transport: underKey({ inner: flaky }),
      uploadRetry: { isRetryable: () => true, minTimeoutMs: 0, randomize: false, retries: 2 },
    });
    expect(report.recovered.map((staging) => staging.directory)).toEqual([stranded]);
    expect(report.unrecoverable).toEqual([]);
    expect(inner.uploaded).toHaveLength(4);
  });

  it("sends the NEWEST stranded staging first", async () => {
    const home = sandboxHome();
    const root = stagingRoot({ home });
    stageByHand({ name: "2026-09-20T05-49-58-043Z", root });
    stageByHand({ name: "2026-09-23T23-54-47-061Z", root });
    const report = await sweepStrandedStagings({
      destination: destinationAt({ root: besideHome({ home }) }),
      encryption: ENCRYPTION,
      root,
      transport: underKey({ inner: directoryTransport({ root: besideHome({ home }) }) }),
    });
    expect(report.recovered.map((staging) => [staging.directory, staging.prefix])).toEqual([
      [join(root, "2026-09-23T23-54-47-061Z"), "slopweaver/2026-09-23T23-54-47-061Z/"],
      [join(root, "2026-09-20T05-49-58-043Z"), "slopweaver/2026-09-20T05-49-58-043Z/"],
    ]);
  });

  it("refuses a staging whose manifest names another project, and writes it no receipt", async () => {
    const home = sandboxHome();
    const root = stagingRoot({ home });
    const foreign = stageByHand({ manifest: { project: "elsewhere" }, name: "2026-09-20T05-49-58-043Z", root });
    const report = await sweepStrandedStagings({
      destination: destinationAt({ root: besideHome({ home }) }),
      encryption: ENCRYPTION,
      root,
      transport: underKey({ inner: directoryTransport({ root: besideHome({ home }) }) }),
    });
    expect(report.unrecoverable.map((staging) => staging.error)).toEqual([
      StagingSweepErrors.misnamed({ directory: foreign, prefix: "elsewhere/2026-09-20T05-49-58-043Z/" }),
    ]);
    expect(existsSync(receiptFile({ directory: foreign, home }))).toBe(false);
    expect(existsSync(join(home, "destination", "elsewhere"))).toBe(false);
  });

  it("refuses a staging whose manifest names another night's instant, and writes it no receipt", async () => {
    const home = sandboxHome();
    const root = stagingRoot({ home });
    const misnamed = stageByHand({
      manifest: { createdAtIso: "2026-09-20T05:49:58.043Z" },
      name: "2026-09-23T23-54-47-061Z",
      root,
    });
    const report = await sweepStrandedStagings({
      destination: destinationAt({ root: besideHome({ home }) }),
      encryption: ENCRYPTION,
      root,
      transport: underKey({ inner: directoryTransport({ root: besideHome({ home }) }) }),
    });
    expect(report.unrecoverable.map((staging) => staging.error)).toEqual([
      StagingSweepErrors.misnamed({ directory: misnamed, prefix: "slopweaver/2026-09-20T05-49-58-043Z/" }),
    ]);
    expect(existsSync(receiptFile({ directory: misnamed, home }))).toBe(false);
    expect(existsSync(join(home, "destination", "slopweaver"))).toBe(false);
  });

  it("sends nothing on a second pass, because the receipt it wrote excludes it", async () => {
    const home = sandboxHome();
    const root = stagingRoot({ home });
    stageByHand({ name: "2026-09-20T05-49-58-043Z", root });
    const destination = besideHome({ home });
    const transport = directoryTransport({ root: destination });
    const swept = {
      destination: destinationAt({ root: destination }),
      encryption: ENCRYPTION,
      root,
      transport: underKey({ inner: transport }),
    } as const;
    await sweepStrandedStagings(swept);
    const second = await sweepStrandedStagings(swept);
    expect(second.recovered).toEqual([]);
    expect(transport.uploaded).toHaveLength(4);
  });
});
