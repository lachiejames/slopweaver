/**
 * Retrieving a backup and rebuilding its files: verifying a staged directory, decrypting a destination address
 * into the retrieved area, the files leg's chunked and incremental nights, and a files restore that refuses
 * corruption. Over the same fakes as `backupRun.test.ts`, from `backupRunWorld.ts`.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { CHUNK_MAX_BYTES } from "../../../store/backup/chunkBoundaries.js";
import { NO_CHUNKS } from "../../../store/backup/chunkPlan.js";
import { BACKUP_DIRECTORY_ENV, BACKUP_DIRECTORY_SECRET } from "../../../store/backup/destination.js";
import { BackupErrors, backupErrorLines } from "../../../store/backup/errors.js";
import { walkBackedUpFiles } from "../../../store/backup/files.js";
import { LocalDestinationErrors } from "../../../store/backup/localDestinationErrors.js";
import { BACKUP_FILES, FILES_MANIFEST, SUPABASE_PROJECT_ID } from "../../../store/backup/plan.js";
import { NO_PROTECTION } from "../../../store/backup/protectedPaths.js";
import { RECEIPTS_DIRECTORY } from "../../../store/backup/receipts.js";
import { runRestoreFiles } from "../../../store/backup/restoreFiles.js";
import { resolveRestoreSource, verifyBackupDirectory } from "../../../store/backup/restoreSource.js";
import type { BackupDeps } from "../../../store/backup/run.js";
import { stagingRoot } from "../../../store/backup/staging.js";
import { STAGING_DESTINATIONS_FILE } from "../../../store/backup/stagingDestinations.js";
import type { BackupTransport } from "../../../store/backup/transport.js";

import { oneNight, sentReport } from "./backupRunNights.js";
import {
  backupAddress,
  besideHome,
  FAKE_STACK,
  FAKE_VAULT_BYTES,
  plantObject,
  removeSandboxHomes,
  sandboxHome,
  underKey,
} from "./backupRunWorld.js";
import { directoryTransport } from "./directoryTransport.js";

afterEach(() => {
  removeSandboxHomes();
});

describe("verifying and retrieving", () => {
  it("refuses a directory whose payload no longer matches its manifest", async () => {
    const home = sandboxHome();
    const report = unwrap(await oneNight({ home, key: null, nowIso: "2026-09-14T03:00:00.000Z" }));
    writeFileSync(join(report.directory, BACKUP_FILES.dump), "PGDMP truncated");
    const verified = verifyBackupDirectory({ directory: report.directory });
    expect(verified.isErr()).toBe(true);
    expect(unwrapErr(verified).code).toBe("BACKUP_INTEGRITY_FAILED");
    expect(backupErrorLines({ error: unwrapErr(verified) })[0]).toContain("store.dump: manifest says");
  });

  it("decrypts a destination address into the retrieved area and verifies it, Vault leg included", async () => {
    const home = sandboxHome();
    const destination = besideHome({ home });
    const transport = directoryTransport({ root: destination });
    unwrap(await oneNight({ home, nowIso: "2026-09-14T03:00:00.000Z", transport }));
    const source = unwrap(
      await resolveRestoreSource({
        from: backupAddress({ instant: "2026-09-14T03-00-00-000Z", root: destination }),
        home,
        transportFor: () => ok(underKey({ inner: transport })),
      }),
    );
    expect(source).toEqual({
      directory: join(stagingRoot({ home }), "retrieved", "slopweaver_2026-09-14T03-00-00-000Z"),
      kind: "local-destination",
      prefix: "slopweaver/2026-09-14T03-00-00-000Z/",
      root: destination,
    });
    const verified = unwrap(verifyBackupDirectory({ directory: source.directory }));
    expect(verified.createdAtIso).toBe("2026-09-14T03:00:00.000Z");
    expect(readFileSync(join(source.directory, BACKUP_FILES.vault)).equals(FAKE_VAULT_BYTES)).toBe(true);
  });

  it("refuses a local directory with no manifest", async () => {
    const home = sandboxHome();
    const result = await resolveRestoreSource({
      from: home,
      home,
      transportFor: () => ok(directoryTransport({ root: home })),
    });
    expect(unwrapErr(result)).toEqual(
      BackupErrors.restoreSourceUnfinished({ directory: home, manifest: "manifest.json" }),
    );
    expect(unwrapErr(result).message).toBe(`${home} holds no manifest.json — not a finished backup directory`);
  });

  it("refuses --secrets-into inside the destination before fetching a single object", async () => {
    const home = sandboxHome();
    const destination = besideHome({ home });
    const collateral = join(destination, "collateral");
    let fetched = 0;
    const result = await resolveRestoreSource({
      from: join(destination, SUPABASE_PROJECT_ID, "2026-11-03T03-00-00-000Z"),
      home,
      transportFor: () => {
        fetched += 1;
        return ok(directoryTransport({ root: destination }));
      },
      writesTo: [{ path: collateral, role: "--secrets-into" }],
    });
    expect(unwrapErr(result)).toEqual(
      BackupErrors.destinationOverlaps({ destination, path: collateral, role: "--secrets-into" }),
    );
    expect(fetched).toBe(0);
    expect(existsSync(join(stagingRoot({ home }), "retrieved"))).toBe(false);
  });

  it("checks a staging-directory restore's --secrets-into against the remembered destination", async () => {
    const home = sandboxHome();
    const report = unwrap(await oneNight({ home, key: null, nowIso: "2026-09-14T03:00:00.000Z" }));
    const destination = besideHome({ home });
    mkdirSync(destination, { recursive: true });
    const collateral = join(destination, "restored-secrets");
    const transportFor = () => ok(directoryTransport({ root: destination }));
    const unremembered = await resolveRestoreSource({
      from: report.directory,
      home,
      transportFor,
      writesTo: [{ path: collateral, role: "--secrets-into" }],
    });
    expect(unwrap(unremembered)).toEqual({ directory: report.directory, kind: "directory" });
    mkdirSync(join(home, "secrets"), { mode: 0o700, recursive: true });
    writeFileSync(join(home, "secrets", BACKUP_DIRECTORY_SECRET), `${destination}\n`, { mode: 0o600 });
    const remembered = await resolveRestoreSource({
      from: report.directory,
      home,
      transportFor,
      writesTo: [{ path: collateral, role: "--secrets-into" }],
    });
    expect(unwrapErr(remembered)).toEqual(
      BackupErrors.destinationOverlaps({ destination, path: collateral, role: "--secrets-into" }),
    );
  });

  it("still checks the home's remembered destination when the environment names a different one", async () => {
    const home = sandboxHome();
    const report = unwrap(await oneNight({ home, key: null, nowIso: "2026-09-14T03:00:00.000Z" }));
    const destination = besideHome({ home });
    mkdirSync(destination, { recursive: true });
    mkdirSync(join(home, "secrets"), { mode: 0o700, recursive: true });
    writeFileSync(join(home, "secrets", BACKUP_DIRECTORY_SECRET), `${destination}\n`, { mode: 0o600 });
    const elsewhere = join(dirname(home), "elsewhere");
    mkdirSync(elsewhere);
    const collateral = join(destination, "restored-secrets");
    const before = process.env[BACKUP_DIRECTORY_ENV];
    process.env[BACKUP_DIRECTORY_ENV] = elsewhere;
    try {
      const shadowed = await resolveRestoreSource({
        from: report.directory,
        home,
        transportFor: () => ok(directoryTransport({ root: destination })),
        writesTo: [{ path: collateral, role: "--secrets-into" }],
      });
      expect(unwrapErr(shadowed)).toEqual(
        BackupErrors.destinationOverlaps({ destination, path: collateral, role: "--secrets-into" }),
      );
    } finally {
      if (before === undefined) {
        delete process.env[BACKUP_DIRECTORY_ENV];
      } else {
        process.env[BACKUP_DIRECTORY_ENV] = before;
      }
    }
  });

  it("checks a staging-directory restore's --secrets-into against the SECOND remembered destination too", async () => {
    const home = sandboxHome();
    const report = unwrap(await oneNight({ home, key: null, nowIso: "2026-09-14T03:00:00.000Z" }));
    const first = besideHome({ home });
    const ssd = join(dirname(home), "ssd");
    mkdirSync(first, { recursive: true });
    mkdirSync(ssd, { recursive: true });
    mkdirSync(join(home, "secrets"), { mode: 0o700, recursive: true });
    writeFileSync(join(home, "secrets", BACKUP_DIRECTORY_SECRET), `${first}\n${ssd}\n`, { mode: 0o600 });
    const collateral = join(ssd, "restored-secrets");
    const refused = await resolveRestoreSource({
      from: report.directory,
      home,
      transportFor: () => ok(directoryTransport({ root: ssd })),
      writesTo: [{ path: collateral, role: "--secrets-into" }],
    });
    expect(unwrapErr(refused)).toEqual(
      BackupErrors.destinationOverlaps({ destination: ssd, path: collateral, role: "--secrets-into" }),
    );
  });

  it("refuses an address whose destination holds the home itself", async () => {
    const home = sandboxHome();
    const destination = dirname(home);
    const result = await resolveRestoreSource({
      from: join(destination, SUPABASE_PROJECT_ID, "2026-11-03T03-00-00-000Z"),
      home,
      transportFor: () => ok(directoryTransport({ root: destination })),
    });
    expect(unwrapErr(result).code).toBe("DESTINATION_OVERLAPS");
    expect(unwrapErr(result).message).toContain("the Slopweaver home");
  });
});

describe("the files leg", () => {
  it("sends a large file as chunks, sends only its new tail the next night, and rebuilds it on restore", async () => {
    const home = sandboxHome();
    const destination = besideHome({ home });
    const transport = directoryTransport({ root: destination });
    // Shaped like bronze, one JSON line per record, and ~37 MB: past the chunker's 16 MiB read window, so the window
    // refills and carries a partial chunk, and more chunks than the upload's six slots, so sends queue behind each
    // other as the real file's did. The walk's MEASURE is what routes a
    // file to the chunked path, so the walk reports this one TRUNK_PARITY_BYTES past its real measure: 158,888,890
    // and 158,888,925 bytes, exactly what the real 5,000,000-line fixture this replaced measured, so routing sees the
    // same sizes it did. One routed size cannot catch a routing bug confined to sizes above it, and that fixture could
    // not either. The walk is held exact twice: on this file's real measure, and on a sparse file of the routed size
    // walked on its own, so a walk that mis-measures only large files still fails here. The manifest's bytes, digest
    // and chunk list come from the real frozen clone. MEASURED, the real 158,888,890-byte fixture took 4.0 s alone
    // and 10.7–11.1 s inside `src/__tests__/unit/store` (both with `--coverage`, as the lane runs), and timed out at
    // 20 s once in a whole lane at load 15 to 18; this one 1.1–1.4 s alone at load 10 to 12. Re-measure with
    // `yarn vitest run --config config/vitest/unit.ts --coverage <this file> --reporter=verbose`.
    const lines = Array.from({ length: 1_200_000 }, (_, index) => `{"id":${String(index)},"text":"message"}`);
    // 158,888,890 (5,000,000 such lines) less 37,288,890 (these 1,200,000).
    const TRUNK_PARITY_BYTES = 121_600_000;
    const sparseHome = sandboxHome();
    const sparse = join(sparseHome, "corpus", "bronze", "slack", "compact.jsonl");
    writeFileSync(sparse, "");
    truncateSync(sparse, 158_888_890);
    expect(
      unwrap(walkBackedUpFiles({ home: sparseHome, protection: NO_PROTECTION })).files.find(
        (file) => file.relativePath === "corpus/bronze/slack/compact.jsonl",
      )!.bytes,
    ).toBe(158_888_890);
    const compact = join(home, "corpus", "bronze", "slack", "compact.jsonl");
    writeFileSync(compact, `${lines.join("\n")}\n`);
    const measured: number[] = [];
    const deps: BackupDeps = {
      ...FAKE_STACK,
      walkBackedUpFiles: ({ home: walkedHome, protection }) =>
        walkBackedUpFiles({ home: walkedHome, protection }).map((walked) => ({
          ...walked,
          files: walked.files.map((file) => {
            if (file.relativePath !== "corpus/bronze/slack/compact.jsonl") {
              return file;
            }
            measured.push(file.bytes);
            return { ...file, bytes: file.bytes + TRUNK_PARITY_BYTES };
          }),
        })),
    };
    const sizes = [statSync(compact).size];
    const run = async ({ nowIso }: { nowIso: string }) => {
      const report = unwrap(await oneNight({ deps, home, keepLocal: 5, nowIso, transport }));
      return { directory: report.directory, files: unwrap(sentReport({ report })).files };
    };
    const first = await run({ nowIso: "2026-09-14T03:00:00.000Z" });
    expect(first.files.chunks.chunks).toBe(7);
    expect(first.files.uploaded).toBe(2);
    expect(first.files.chunks.held).toBe(0);
    expect(first.files.chunks.sent).toBe(first.files.chunks.chunks);
    expect(first.files.chunks.sentStoredBytes).toBeLessThan(first.files.chunks.sentRawBytes / 5);
    appendFileSync(compact, '{"id":"tonight","text":"one more"}\n');
    sizes.push(statSync(compact).size);
    const second = await run({ nowIso: "2026-09-15T03:00:00.000Z" });
    expect(sizes).toEqual([37_288_890, 37_288_925]);
    expect(sizes[0]).toBeGreaterThan(2 * CHUNK_MAX_BYTES);
    expect(measured).toEqual(sizes);
    expect(second.files.uploaded).toBe(0);
    expect(second.files.chunks.sent).toBe(1);
    expect(second.files.chunks.held).toBe(second.files.chunks.chunks - 1);
    const manifest = JSON.parse(readFileSync(join(second.directory, FILES_MANIFEST), "utf8")) as {
      files: { relativePath: string; chunked: { encoding: string } | null }[];
    };
    expect(manifest.files.filter((file) => file.chunked !== null).map((file) => file.relativePath)).toEqual([
      "corpus/bronze/slack/compact.jsonl",
    ]);
    expect(manifest.files.find((file) => file.chunked !== null)!.chunked!.encoding).toBe("zstd");
    expect(manifest.files).toHaveLength(3);
    const reader = underKey({ inner: transport });
    const source = unwrap(
      await resolveRestoreSource({
        from: backupAddress({ instant: "2026-09-15T03-00-00-000Z", root: destination }),
        home,
        transportFor: () => ok(reader),
      }),
    );
    const into = join(home, "rebuilt");
    unwrap(await runRestoreFiles({ into, source, transport: reader }));
    expect(readFileSync(join(into, "corpus", "bronze", "slack", "compact.jsonl")).equals(readFileSync(compact))).toBe(
      true,
    );
    expect(readdirSync(second.directory).toSorted()).toEqual(
      [
        BACKUP_FILES.manifest,
        BACKUP_FILES.dump,
        BACKUP_FILES.storage,
        BACKUP_FILES.vault,
        FILES_MANIFEST,
        STAGING_DESTINATIONS_FILE,
        RECEIPTS_DIRECTORY,
      ].toSorted(),
    );
  });

  it("sends only the blobs the destination lacks on the second night, and restores every file by digest", async () => {
    const home = sandboxHome();
    const destination = besideHome({ home });
    const transport = directoryTransport({ root: destination });
    const first = unwrap(await oneNight({ home, nowIso: "2026-09-14T03:00:00.000Z", transport }));
    expect(unwrap(sentReport({ report: first })).files.uploaded).toBe(2);
    writeFileSync(join(home, "corpus", "bronze", "slack", "6d_2026-09-15.jsonl"), '{"id":"b"}\n');
    const second = unwrap(await oneNight({ home, nowIso: "2026-09-15T03:00:00.000Z", transport }));
    expect(unwrap(sentReport({ report: second })).files).toEqual({
      bytes: 37,
      chunks: NO_CHUNKS,
      count: 3,
      uploaded: 1,
      uploadedBytes: 11,
      vanished: 0,
    });
    const reader = underKey({ inner: transport });
    const source = unwrap(
      await resolveRestoreSource({
        from: backupAddress({ instant: "2026-09-15T03-00-00-000Z", root: destination }),
        home,
        transportFor: () => ok(reader),
      }),
    );
    const into = join(home, "rebuilt");
    const restored = unwrap(await runRestoreFiles({ into, source, transport: reader }));
    expect(restored).toEqual({ bytes: 37, count: 3, into });
    expect(readFileSync(join(into, "corpus", "bronze", "slack", "6d_2026-09-15.jsonl"), "utf8")).toBe('{"id":"b"}\n');
  });

  it("refuses a target that already holds something, writing nothing into it", async () => {
    const home = sandboxHome();
    const destination = besideHome({ home });
    const transport = directoryTransport({ root: destination });
    unwrap(await oneNight({ home, nowIso: "2026-09-14T03:00:00.000Z", transport }));
    const reader = underKey({ inner: transport });
    const source = unwrap(
      await resolveRestoreSource({
        from: backupAddress({ instant: "2026-09-14T03-00-00-000Z", root: destination }),
        home,
        transportFor: () => ok(reader),
      }),
    );
    const into = join(home, "rebuilt");
    mkdirSync(into);
    writeFileSync(join(into, "already-here"), "x");
    const refused = unwrapErr(await runRestoreFiles({ into, source, transport: reader }));
    expect(refused).toEqual(BackupErrors.filesTargetNotEmpty({ into }));
    expect(readdirSync(into)).toEqual(["already-here"]);
  });
});

describe("a files restore refuses corruption rather than reporting it", () => {
  it("errs when a blob's bytes no longer digest to what the manifest recorded", async () => {
    const home = sandboxHome();
    const root = besideHome({ home });
    const transport = directoryTransport({ root });
    unwrap(await oneNight({ home, nowIso: "2026-09-14T03:00:00.000Z", transport }));
    // Replace one blob IN THE DESTINATION with a well-formed object under the right key whose plaintext is not
    // what its name (its digest) says — so it decrypts cleanly, and only the digest check can catch it.
    const blob = readdirSync(join(root, "slopweaver", "blobs"))[0]!;
    await plantObject({
      bytes: Buffer.from("not the bytes this digest names"),
      objectName: `slopweaver/blobs/${blob}`,
      root,
    });
    const reader = underKey({ inner: transport });
    const source = unwrap(
      await resolveRestoreSource({
        from: backupAddress({ instant: "2026-09-14T03-00-00-000Z", root }),
        home,
        transportFor: () => ok(reader),
      }),
    );
    const into = join(home, "rebuilt");
    const result = await runRestoreFiles({ into, source, transport: reader });
    expect(result.isErr()).toBe(true);
    const lines = backupErrorLines({ error: unwrapErr(result) });
    expect(lines[0]).toBe("1 of 2 restored file(s) do not match files.json");
    expect(lines[1]).toContain("digest differs after restore");
    // The file that matched stays; the one that did not is not left at its path.
    const kept = readdirSync(into, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
    expect(kept.length).toBe(1);
  });

  it("leaves no truncated file at a blob's path when its download dies part-way", async () => {
    const home = sandboxHome();
    const root = besideHome({ home });
    const stored = directoryTransport({ root });
    unwrap(await oneNight({ home, nowIso: "2026-09-14T03:00:00.000Z", transport: stored }));
    const reader = underKey({ inner: stored });
    const source = unwrap(
      await resolveRestoreSource({
        from: backupAddress({ instant: "2026-09-14T03-00-00-000Z", root }),
        home,
        transportFor: () => ok(reader),
      }),
    );
    // A blob download writes half its bytes at the caller's path and then the read dies.
    const dropping: BackupTransport = {
      ...reader,
      download: async ({ objectName, path }) => {
        writeFileSync(path, "half a bl");
        return err(LocalDestinationErrors.readFailed({ cause: new Error("ECONNRESET"), objectName, root }));
      },
    };
    const into = join(home, "rebuilt");
    const result = await runRestoreFiles({ into, source, transport: dropping });
    expect(backupErrorLines({ error: unwrapErr(result) })[0]).toContain("ECONNRESET");
    const leftBehind = readdirSync(into, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
    expect(leftBehind.map((entry) => entry.name)).toEqual([]);
  });
});
