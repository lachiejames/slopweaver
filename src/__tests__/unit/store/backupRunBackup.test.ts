/**
 * The backup orchestration over fakes — a stack that writes known bytes and a transport that lands
 * objects in a directory. No Docker, no Keychain, no clock: every effect is a seam handed in, and the backup
 * key is a fixed test key, so what lands in the destination is ciphertext a test opens with that same key.
 * This file holds `runBackup` to ONE destination and the last-outcome record; a list of destinations is
 * `backupRunDestinations.test.ts`, and the shared fakes are in `backupRunWorld.ts`.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, type Result, unwrap, unwrapErr } from "../../../lib/result.js";
import { NO_CHUNKS } from "../../../store/backup/chunkPlan.js";
import { BackupErrors } from "../../../store/backup/errors.js";
import { LOCAL_ONLY_WHY, readLastOutcome, recordLastOutcome } from "../../../store/backup/lastOutcome.js";
import { keyFingerprint, OBJECT_OVERHEAD_BYTES } from "../../../store/backup/objectCrypto.js";
import { BACKUP_FILES, FILES_MANIFEST } from "../../../store/backup/plan.js";
import { NO_PROTECTION } from "../../../store/backup/protectedPaths.js";
import { readReceipt } from "../../../store/backup/receipts.js";
import { verifyBackupDirectory } from "../../../store/backup/restoreSource.js";
import { type BackupDeps, type BackupReport, type BackupTarget, runBackup } from "../../../store/backup/run.js";
import { BackupSendErrors } from "../../../store/backup/sendErrors.js";
import { stagingRoot } from "../../../store/backup/staging.js";
import { runSweepOnly } from "../../../store/backup/sweepRun.js";
import type { BackupTransport } from "../../../store/backup/transport.js";

import { destinationAt, idsOf, nightTarget, sweepTarget } from "./backupRunNights.js";
import {
  besideHome,
  blobFor,
  ENCRYPTION,
  FAKE_STACK,
  FAKE_VAULT_BYTES,
  KEY,
  plantObject,
  removeSandboxHomes,
  STORE_URL,
  sandboxHome,
  sha256Of,
  storedPlaintext,
} from "./backupRunWorld.js";
import { directoryTransport } from "./directoryTransport.js";

afterEach(() => {
  removeSandboxHomes();
});

const NOW = "2026-09-14T03:00:00.000Z";

/**
 * One night to the targets given, owing exactly their destinations.
 *
 * @param home the sandbox home
 * @param targets the night's destinations, in order
 * @param nowIso the night's instant, when not {@link NOW}
 * @param key the backup key, when not the test key
 * @param deps the stack, when not the fake one
 * @returns the run's report
 */
function night({
  home,
  targets,
  nowIso = NOW,
  key = KEY,
  deps = FAKE_STACK,
}: {
  home: string;
  targets: readonly BackupTarget[];
  nowIso?: string;
  key?: Buffer | null;
  deps?: BackupDeps;
}): Promise<Result<BackupReport>> {
  const owes = targets.map((target) => target.destination);
  return runBackup({
    deps,
    home,
    key,
    masterPassword: null,
    nowIso,
    obligations: owes.map((destination) => destination.id),
    owes,
    protection: NO_PROTECTION,
    storeUrl: STORE_URL,
    targets,
  });
}

/**
 * The one destination's send report, failing the test when it did not succeed.
 *
 * @param report the run's report
 * @returns the first destination's send report
 */
function sentTo({ report }: { report: BackupReport }) {
  const outcome = report.destinations[0]!;
  expect(outcome.status).toBe("succeeded");
  return (outcome as Extract<typeof outcome, { status: "succeeded" }>).report;
}

describe("runBackup to one destination", () => {
  it("stages dump, tar, Vault and manifest, and uploads them encrypted with the manifest last", async () => {
    const home = sandboxHome();
    const destination = besideHome({ home });
    const transport = directoryTransport({ root: destination });
    const report = unwrap(await night({ home, targets: [nightTarget({ root: destination, transport })] }));
    expect(report.directory).toBe(join(stagingRoot({ home }), "2026-09-14T03-00-00-000Z"));
    expect(report.manifest.database).toBe("postgres");
    expect(report.manifest.dump.bytes).toBe("PGDMP fake dump bytes".length);
    expect(report.manifest.extensions).toEqual([{ name: "pg_trgm", schema: "public" }]);
    expect(report.manifest.vault).toEqual({
      bytes: FAKE_VAULT_BYTES.length,
      keyFingerprint: keyFingerprint({ key: KEY }),
      rows: 0,
      sha256: sha256Of({ bytes: FAKE_VAULT_BYTES }),
    });
    expect(report.files).toEqual({ bytes: 26, count: 2, skippedProtectedPaths: [], vanished: 0 });
    const sent = sentTo({ report });
    expect(sent.files).toEqual({ bytes: 26, chunks: NO_CHUNKS, count: 2, uploaded: 2, uploadedBytes: 26, vanished: 0 });
    expect(transport.uploaded.slice(0, 2).every((name) => name.startsWith("slopweaver/blobs/"))).toBe(true);
    // The dump goes as its one chunk — a fake dump is far under the smallest chunk — and never whole.
    expect(transport.uploaded.slice(2)).toEqual([
      `slopweaver/chunks/identity/${sha256Of({ bytes: Buffer.from("PGDMP fake dump bytes") })}`,
      "slopweaver/2026-09-14T03-00-00-000Z/files.json",
      "slopweaver/2026-09-14T03-00-00-000Z/storage.tar",
      "slopweaver/2026-09-14T03-00-00-000Z/vault.enc",
      "slopweaver/2026-09-14T03-00-00-000Z/manifest.json",
    ]);
    expect(sent.dumpChunks).toEqual({ chunks: 1, held: 0, sent: 1, sentRawBytes: 21, sentStoredBytes: 21 });
    expect(sent.receipt.destination).toBe(destination);
    expect(sent.receipt.prefix).toBe("slopweaver/2026-09-14T03-00-00-000Z/");
    expect(sent.receipt.encryption).toEqual(ENCRYPTION);
    const onDisk = readReceipt({ directory: report.directory, id: destinationAt({ root: destination }).id })!;
    expect(onDisk.prefix).toBe("slopweaver/2026-09-14T03-00-00-000Z/");
    expect(unwrap(verifyBackupDirectory({ directory: report.directory }))).toEqual(report.manifest);
    // What landed is ciphertext, one fixed overhead longer than the staged file, and opens to it under the key.
    const manifestObject = "slopweaver/2026-09-14T03-00-00-000Z/manifest.json";
    const staged = readFileSync(join(report.directory, BACKUP_FILES.manifest));
    const raw = readFileSync(join(destination, manifestObject));
    expect(raw.length).toBe(staged.length + OBJECT_OVERHEAD_BYTES);
    expect(raw.includes(Buffer.from('"database"'))).toBe(false);
    expect((await storedPlaintext({ objectName: manifestObject, root: destination })).equals(staged)).toBe(true);
  });

  it("refuses a destination handed in with no backup key, before staging anything", async () => {
    const home = sandboxHome();
    const result = await night({ home, key: null, targets: [nightTarget({ root: besideHome({ home }) })] });
    expect(unwrapErr(result)).toEqual([BackupSendErrors.keyless().message]);
    expect(BackupSendErrors.keyless().message).toBe(
      "a destination is only ever written under the backup key, and none was given",
    );
    expect(existsSync(stagingRoot({ home }))).toBe(false);
  });

  it("refuses a link planted at tonight's staging directory and dumps nothing through it", async () => {
    const home = sandboxHome();
    const elsewhere = besideHome({ home });
    mkdirSync(elsewhere, { recursive: true });
    mkdirSync(stagingRoot({ home }), { recursive: true });
    const planted = join(stagingRoot({ home }), "2026-09-14T03-00-00-000Z");
    symlinkSync(elsewhere, planted);

    const result = await night({ home, key: null, targets: [] });

    expect(unwrapErr(result)).toEqual([
      `${planted} is a link or not a directory; staging never writes through one — remove it and re-run`,
    ]);
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("stages and stops with no destination, keeping every frozen copy and no Vault leg without a key", async () => {
    const home = sandboxHome();
    const report = unwrap(await night({ home, key: null, targets: [] }));
    expect(report.destinations).toEqual([]);
    expect(report.manifest.vault).toBeNull();
    expect(report.files).toEqual({ bytes: 26, count: 2, skippedProtectedPaths: [], vanished: 0 });
    expect(readdirSync(report.directory).toSorted()).toEqual(
      [
        BACKUP_FILES.manifest,
        BACKUP_FILES.dump,
        BACKUP_FILES.storage,
        "destinations.json",
        "files.json",
        "snapshot",
      ].toSorted(),
    );
  });

  it("names an older copy the destination never got and keeps it, until --sweep-only sends it", async () => {
    const home = sandboxHome();
    const root = besideHome({ home });
    const transport = directoryTransport({ root });
    unwrap(await night({ home, nowIso: "2026-09-12T03:00:00.000Z", targets: [nightTarget({ root, transport })] }));
    // The 13th stages and stops, still owing the configured destination.
    unwrap(
      await runBackup({
        deps: FAKE_STACK,
        home,
        key: KEY,
        masterPassword: null,
        nowIso: "2026-09-13T03:00:00.000Z",
        obligations: idsOf({ roots: [root] }),
        owes: [destinationAt({ root })],
        protection: NO_PROTECTION,
        storeUrl: STORE_URL,
        targets: [],
      }),
    );
    // Tonight's run does NOT send it — a strand is a recovery, run on purpose — so it names it, and the pruner
    // keeps it because the destination does not hold it.
    const third = unwrap(await night({ home, targets: [nightTarget({ root, transport })] }));
    expect(third.stranded).toEqual([{ destination: destinationAt({ root }), names: ["2026-09-13T03-00-00-000Z"] }]);
    expect(third.pruned).toEqual(["2026-09-12T03-00-00-000Z"]);
    const swept = await runSweepOnly({
      home,
      obligations: idsOf({ roots: [root] }),
      targets: [sweepTarget({ home, root, transport })],
    });
    const outcome = swept.destinations[0]!;
    expect(outcome.status).toBe("swept");
    const report = (outcome as Extract<typeof outcome, { status: "swept" }>).report;
    expect(report.sweep.recovered.map((staging) => staging.prefix)).toEqual(["slopweaver/2026-09-13T03-00-00-000Z/"]);
    expect(report.sweep.recovered[0]!.filesMissing).toEqual([]);
    expect(swept.pruned).toEqual(["2026-09-13T03-00-00-000Z"]);
    expect(readdirSync(stagingRoot({ home })).toSorted()).toEqual(["2026-09-14T03-00-00-000Z"]);
  });

  it("refuses when the stack cannot be reached, before writing anything", async () => {
    const home = sandboxHome();
    const result = await night({
      deps: {
        ...FAKE_STACK,
        pgDumpVersion: () =>
          err(
            BackupErrors.commandLaunchFailed({
              cause: new Error("spawn docker ENOENT"),
              label: "docker exec pg_dump --version",
            }),
          ),
      },
      home,
      key: null,
      targets: [],
    });
    expect(unwrapErr(result)[0]).toContain("spawn docker ENOENT");
    expect(existsSync(stagingRoot({ home }))).toBe(false);
  });

  it("leaves out of the blob what the fleet appended to a file while its own upload ran", async () => {
    const home = sandboxHome();
    const destination = besideHome({ home });
    const lessons = join(home, "knowledge", "lessons.jsonl");
    const measured = readFileSync(lessons);
    const inner = directoryTransport({ root: destination });
    const growing: BackupTransport = {
      ...inner,
      upload: async (args) => {
        if (args.objectName === blobFor({ bytes: measured })) {
          appendFileSync(lessons, '{"lesson":"written by another session mid-upload"}\n');
        }
        return inner.upload(args);
      },
    };
    const report = unwrap(await night({ home, targets: [nightTarget({ root: destination, transport: growing })] }));
    expect(sentTo({ report }).files.uploaded).toBe(2);
    const stored = await storedPlaintext({ objectName: blobFor({ bytes: measured }), root: destination });
    expect(stored.length).toBe(measured.length);
    expect(sha256Of({ bytes: stored })).toBe(sha256Of({ bytes: measured }));
    expect(readFileSync(lessons).length).toBeGreaterThan(measured.length);
  });

  it("sends the FROZEN copy when a resync rewrites the file while its upload is in flight, then releases it", async () => {
    const home = sandboxHome();
    const destination = besideHome({ home });
    const lessons = join(home, "knowledge", "lessons.jsonl");
    const measured = readFileSync(lessons);
    const named = blobFor({ bytes: measured });
    const inner = directoryTransport({ root: destination });
    const rewriting: BackupTransport = {
      ...inner,
      upload: async (args) => {
        if (args.objectName === named) {
          writeFileSync(lessons, "Z".repeat(measured.length));
        }
        return inner.upload(args);
      },
    };
    const report = unwrap(await night({ home, targets: [nightTarget({ root: destination, transport: rewriting })] }));
    expect(sentTo({ report }).files.uploaded).toBe(2);
    expect(sha256Of({ bytes: await storedPlaintext({ objectName: named, root: destination }) })).toBe(
      sha256Of({ bytes: measured }),
    );
    expect(readFileSync(lessons, "utf8")).toBe("Z".repeat(measured.length));
    // Every destination it owes holds it, so its frozen copies are let go.
    expect(report.released).toEqual(["2026-09-14T03-00-00-000Z"]);
    expect(existsSync(join(report.directory, "snapshot"))).toBe(false);
  });

  it("names a file rewritten between the walk and its freeze for what was FROZEN, in the destination and in files.json", async () => {
    const home = sandboxHome();
    const destination = besideHome({ home });
    const lessons = join(home, "knowledge", "lessons.jsonl");
    const walked = readFileSync(lessons);
    const rewritten = Buffer.from('{"lesson":"rewritten by a resync after the walk"}\n');
    // The walk runs, then the resync rewrites the file before the freeze.
    const deps: BackupDeps = {
      ...FAKE_STACK,
      walkBackedUpFiles: (args) => {
        const walk = FAKE_STACK.walkBackedUpFiles(args);
        writeFileSync(lessons, rewritten);
        return walk;
      },
    };
    const report = unwrap(await night({ deps, home, targets: [nightTarget({ root: destination })] }));
    const manifest = JSON.parse(readFileSync(join(report.directory, FILES_MANIFEST), "utf8")) as {
      files: readonly { relativePath: string; sha256: string; bytes: number }[];
    };
    const entry = manifest.files.find((file) => file.relativePath === join("knowledge", "lessons.jsonl"))!;
    expect(entry.sha256).toBe(sha256Of({ bytes: rewritten }));
    expect(entry.bytes).toBe(rewritten.length);
    const stored = await storedPlaintext({ objectName: blobFor({ bytes: rewritten }), root: destination });
    expect(stored.toString("utf8")).toBe(rewritten.toString("utf8"));
    expect(existsSync(join(destination, blobFor({ bytes: walked })))).toBe(false);
    expect(report.files.bytes).toBe(entry.bytes + 11);
  });

  it("sends both contents when two files walked identical and one is rewritten before it is frozen", async () => {
    const home = sandboxHome();
    const destination = besideHome({ home });
    const same = '{"same":true}\n';
    const first = join(home, "knowledge", "a.jsonl");
    writeFileSync(first, same);
    writeFileSync(join(home, "knowledge", "b.jsonl"), same);
    const deps: BackupDeps = {
      ...FAKE_STACK,
      walkBackedUpFiles: (args) => {
        const walk = FAKE_STACK.walkBackedUpFiles(args);
        writeFileSync(first, '{"same":false}\n');
        return walk;
      },
    };
    unwrap(await night({ deps, home, targets: [nightTarget({ root: destination })] }));
    const sameObject = blobFor({ bytes: Buffer.from(same) });
    const changedObject = blobFor({ bytes: Buffer.from('{"same":false}\n') });
    expect((await storedPlaintext({ objectName: sameObject, root: destination })).toString("utf8")).toBe(same);
    expect((await storedPlaintext({ objectName: changedObject, root: destination })).toString("utf8")).toBe(
      '{"same":false}\n',
    );
  });

  it("re-uploads a blob the destination holds under the right name at the wrong length", async () => {
    const home = sandboxHome();
    const destination = besideHome({ home });
    const lessons = join(home, "knowledge", "lessons.jsonl");
    const measured = readFileSync(lessons);
    const named = blobFor({ bytes: measured });
    // A whole, decryptable object under the right name whose plaintext is the wrong length — a poisoned blob.
    await plantObject({
      bytes: Buffer.concat([measured, Buffer.from("poison")]),
      objectName: named,
      root: destination,
    });
    const report = unwrap(await night({ home, targets: [nightTarget({ root: destination })] }));
    expect(sentTo({ report }).files.uploaded).toBe(2);
    expect((await storedPlaintext({ objectName: named, root: destination })).equals(measured)).toBe(true);
  });
});

describe("the last outcome", () => {
  it("separates never-run from unreadable, and reports the most recent attempt", () => {
    const home = sandboxHome();
    expect(readLastOutcome({ home })).toBe("absent");
    const written = {
      atIso: "2026-09-14T03:00:00.000Z",
      destinations: [
        {
          id: "20b47fe82477fec9",
          label: "this Mac",
          prefix: "slopweaver/2026-09-14T03-00-00-000Z/",
          root: "/backups",
          status: "succeeded",
        },
      ],
      directory: "/x",
      status: "destinations",
    } as const;
    recordLastOutcome({ home, outcome: written });
    expect(readLastOutcome({ home })).toEqual(written);
    recordLastOutcome({
      home,
      outcome: { atIso: "2026-09-15T03:00:00.000Z", errors: ["destination unreachable"], status: "failed" },
    });
    expect(readLastOutcome({ home })).toEqual({
      atIso: "2026-09-15T03:00:00.000Z",
      errors: ["destination unreachable"],
      status: "failed",
    });
    writeFileSync(join(stagingRoot({ home }), "last.json"), '{"status":"succeeded","uploaded":false}\n');
    expect(readLastOutcome({ home })).toBe("unreadable");
  });

  it("records a staged arm for a run that reached no destination, and no shape can call one succeeded", () => {
    const home = sandboxHome();
    recordLastOutcome({
      home,
      outcome: { atIso: "2026-09-20T05:49:58.043Z", directory: "/y", status: "staged", why: LOCAL_ONLY_WHY },
    });
    expect(readLastOutcome({ home })).toEqual({
      atIso: "2026-09-20T05:49:58.043Z",
      directory: "/y",
      status: "staged",
      why: LOCAL_ONLY_WHY,
    });
  });
});
