/**
 * The files leg on the upload path: the walk with no transport, the blobs a destination lacks, the one listing,
 * the retries and failures of a blob upload, and the property a LIST of destinations rests on — the night's files
 * are frozen once, `files.json` is final before any send, and every destination receives the same bytes. The
 * removed-file and landed-size scenarios are in `backupRunFilesLegVanished.test.ts`.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, unwrap, unwrapErr } from "../../../lib/result.js";
import { prepareFilesLeg, releasePreparedFiles } from "../../../store/backup/filesPrepare.js";
import { sendPreparedFiles } from "../../../store/backup/filesSend.js";
import { FILES_MANIFEST } from "../../../store/backup/plan.js";
import { NO_PROTECTION } from "../../../store/backup/protectedPaths.js";
import type { BackupDeps } from "../../../store/backup/run.js";
import type { BackupTransport } from "../../../store/backup/transport.js";

import {
  besideHome,
  blobFor,
  FAKE_STACK,
  removeSandboxHomes,
  sandboxHome,
  sha256Of,
  writeFailure,
} from "./backupRunWorld.js";
import { directoryTransport } from "./directoryTransport.js";
import { runFilesLeg } from "./filesLegOnce.js";

const NO_BACKOFF = { isRetryable: () => true, minTimeoutMs: 0, randomize: false, retries: 0 } as const;

afterEach(() => {
  removeSandboxHomes();
});

/**
 * The fake stack, with a walk that runs `action` once it has measured the home and before anything is frozen.
 *
 * @param action what changes under the leg
 * @returns the effects
 */
function walkThen({ action }: { action: () => void }): BackupDeps {
  return {
    ...FAKE_STACK,
    walkBackedUpFiles: (args) => {
      const walked = FAKE_STACK.walkBackedUpFiles(args);
      action();
      return walked;
    },
  };
}

/**
 * The digest of a staging's `files.json` as it stands on disk.
 *
 * @param directory the staging directory
 * @returns its sha256
 */
function manifestDigest({ directory }: { directory: string }): string {
  return createHash("sha256")
    .update(readFileSync(join(directory, FILES_MANIFEST)))
    .digest("hex");
}

describe("the files leg", () => {
  it("writes files.json and reports the walk when there is no transport to send to", async () => {
    const home = sandboxHome();
    const directory = join(home, "staged");
    mkdirSync(directory, { recursive: true });
    const report = unwrap(
      await runFilesLeg({
        deps: FAKE_STACK,
        directory,
        home,
        nowIso: "2026-09-14T03:00:00.000Z",
        transport: null,
      }),
    );
    expect(report.count).toBe(2);
    expect(report.uploaded).toBe(0);
    expect(report.uploadedBytes).toBe(0);
    expect(report.bytes).toBe(26);
    const manifest: unknown = JSON.parse(readFileSync(join(directory, FILES_MANIFEST), "utf8"));
    expect((manifest as { createdAtIso: string }).createdAtIso).toBe("2026-09-14T03:00:00.000Z");
    expect((manifest as { files: readonly unknown[] }).files.length).toBe(2);
  });

  it("sends the blobs a destination lacks and counts only those as uploaded", async () => {
    const home = sandboxHome();
    const directory = join(home, "staged");
    const root = besideHome({ home });
    mkdirSync(directory, { recursive: true });
    mkdirSync(root, { recursive: true });
    const transport = directoryTransport({ root });
    const first = unwrap(
      await runFilesLeg({ deps: FAKE_STACK, directory, home, nowIso: "2026-09-14T03:00:00.000Z", transport }),
    );
    expect(first.uploaded).toBe(2);
    expect(first.uploadedBytes).toBe(26);
    const second = unwrap(
      await runFilesLeg({ deps: FAKE_STACK, directory, home, nowIso: "2026-09-15T03:00:00.000Z", transport }),
    );
    expect(second.count).toBe(2);
    expect(second.uploaded).toBe(0);
    expect(second.uploadedBytes).toBe(0);
  });

  it("asks the destination what it holds with ONE listing of the blob prefix, however many files there are", async () => {
    const home = sandboxHome();
    const directory = join(home, "staged");
    mkdirSync(directory, { recursive: true });
    for (let index = 0; index < 40; index += 1) {
      mkdirSync(join(home, "corpus", "bodies"), { recursive: true });
      writeFileSync(join(home, "corpus", "bodies", `body-${String(index)}.json`), `{"n":${String(index)}}`);
    }
    const transport = directoryTransport({ root: besideHome({ home }) });
    const report = unwrap(
      await runFilesLeg({ deps: FAKE_STACK, directory, home, nowIso: "2026-09-14T03:00:00.000Z", transport }),
    );
    expect(report.count).toBe(42);
    expect(report.uploaded).toBe(42);
    expect(transport.sizeListings).toEqual(["slopweaver/blobs/"]);
  });

  it("retries a blob upload that failed once, and the night still succeeds", async () => {
    const home = sandboxHome();
    const directory = join(home, "staged");
    mkdirSync(directory, { recursive: true });
    const root = besideHome({ home });
    const inner = directoryTransport({ root });
    const attempts: string[] = [];
    const flaky: BackupTransport = {
      ...inner,
      upload: async (args) => {
        attempts.push(args.objectName);
        if (attempts.length === 1) {
          return err(writeFailure({ objectName: args.objectName, path: args.path, root }));
        }
        return inner.upload(args);
      },
    };
    const report = unwrap(
      await runFilesLeg({
        deps: FAKE_STACK,
        directory,
        home,
        nowIso: "2026-09-14T03:00:00.000Z",
        transport: flaky,
        uploadRetry: { ...NO_BACKOFF, retries: 3 },
      }),
    );
    expect(report.uploaded).toBe(2);
    expect(attempts.length).toBe(3);
    expect(attempts[0]).toBe(attempts[1]);
    expect(inner.uploaded.length).toBe(2);
  });

  it("reports the destination's own failure after the last retry, and keeps the frozen copy it sent from", async () => {
    const home = sandboxHome();
    const directory = join(home, "staged");
    mkdirSync(directory, { recursive: true });
    const root = besideHome({ home });
    const attempts: string[] = [];
    const down: BackupTransport = {
      ...directoryTransport({ root }),
      upload: async (args) => {
        attempts.push(args.objectName);
        return err(writeFailure({ objectName: args.objectName, path: args.path, root }));
      },
    };
    const result = await runFilesLeg({
      deps: FAKE_STACK,
      directory,
      home,
      nowIso: "2026-09-14T03:00:00.000Z",
      transport: down,
      uploadRetry: { ...NO_BACKOFF, retries: 2 },
    });
    // The walk path-sorts, so the bronze window is the first blob sent and the one the failure names — sent
    // from its frozen copy, kept under its own digest.
    const bytes = readFileSync(join(home, "corpus", "bronze", "slack", "6d_2026-09-08.jsonl"));
    const objectName = blobFor({ bytes });
    const frozen = join(directory, "snapshot", "blobs", sha256Of({ bytes }));
    expect(unwrapErr(result)).toEqual([writeFailure({ objectName, path: frozen, root }).message]);
    expect(existsSync(frozen)).toBe(true);
    expect(attempts).toEqual([objectName, objectName, objectName]);
  });
});

describe("one night's files, prepared once for every destination", () => {
  it("names a file rewritten between the walk and its freeze by the frozen digest, before anything is sent", async () => {
    const home = sandboxHome();
    const directory = join(home, "staged");
    mkdirSync(directory, { recursive: true });
    const bronze = join(home, "corpus", "bronze", "slack", "6d_2026-09-08.jsonl");
    const rewritten = Buffer.from('{"text":"rewritten by a resync after the walk"}\n');
    const prepared = unwrap(
      prepareFilesLeg({
        deps: walkThen({ action: () => writeFileSync(bronze, rewritten) }),
        directory,
        home,
        nowIso: "2026-09-14T03:00:00.000Z",
        protection: NO_PROTECTION,
      }),
    );
    const named = JSON.parse(readFileSync(join(directory, FILES_MANIFEST), "utf8")) as {
      files: readonly { sha256: string }[];
    };
    expect(named.files.map((file) => file.sha256)).toEqual(prepared.entries.map((entry) => entry.sha256));
    expect(prepared.entries[0]!.sha256).toBe(sha256Of({ bytes: rewritten }));
  });

  it("sends two destinations the same frozen bytes, and neither send rewrites files.json", async () => {
    const home = sandboxHome();
    const directory = join(home, "staged");
    mkdirSync(directory, { recursive: true });
    const bronze = join(home, "corpus", "bronze", "slack", "6d_2026-09-08.jsonl");
    const frozenBytes = Buffer.from('{"text":"what the freeze read"}\n');
    const laterBytes = Buffer.from('{"text":"written after the freeze, before the second send"}\n');
    const prepared = unwrap(
      prepareFilesLeg({
        deps: walkThen({ action: () => writeFileSync(bronze, frozenBytes) }),
        directory,
        home,
        nowIso: "2026-09-14T03:00:00.000Z",
        protection: NO_PROTECTION,
      }),
    );
    const before = manifestDigest({ directory });
    const mac = besideHome({ home });
    const ssd = join(home, "..", "ssd-destination");
    unwrap(await sendPreparedFiles({ directory, ...prepared, transport: directoryTransport({ root: mac }) }));
    writeFileSync(bronze, laterBytes);
    unwrap(await sendPreparedFiles({ directory, ...prepared, transport: directoryTransport({ root: ssd }) }));
    expect(manifestDigest({ directory })).toBe(before);
    expect([mac, ssd].map((root) => existsSync(join(root, blobFor({ bytes: frozenBytes }))))).toEqual([true, true]);
    expect([mac, ssd].map((root) => existsSync(join(root, blobFor({ bytes: laterBytes }))))).toEqual([false, false]);
  });

  it("keeps every frozen copy through a failed send, so the next destination and a later sweep still have them", async () => {
    const home = sandboxHome();
    const directory = join(home, "staged");
    mkdirSync(directory, { recursive: true });
    const prepared = unwrap(
      prepareFilesLeg({
        deps: FAKE_STACK,
        directory,
        home,
        nowIso: "2026-09-14T03:00:00.000Z",
        protection: NO_PROTECTION,
      }),
    );
    const failing = join(home, "..", "failing-destination");
    const down: BackupTransport = {
      ...directoryTransport({ root: failing }),
      upload: async (args) => err(writeFailure({ objectName: args.objectName, path: args.path, root: failing })),
    };
    const refused = await sendPreparedFiles({ directory, ...prepared, retry: NO_BACKOFF, transport: down });
    expect(unwrapErr(refused).length).toBe(1);
    const reached = unwrap(
      await sendPreparedFiles({
        directory,
        ...prepared,
        transport: directoryTransport({ root: besideHome({ home }) }),
      }),
    );
    expect(reached.report.uploaded).toBe(2);
    expect(reached.unsourced).toEqual([]);
  });

  it("names, rather than fails, an entry whose frozen copy was released before a destination got it", async () => {
    const home = sandboxHome();
    const directory = join(home, "staged");
    mkdirSync(directory, { recursive: true });
    const prepared = unwrap(
      prepareFilesLeg({
        deps: FAKE_STACK,
        directory,
        home,
        nowIso: "2026-09-14T03:00:00.000Z",
        protection: NO_PROTECTION,
      }),
    );
    releasePreparedFiles({ directory });
    const sent = unwrap(
      await sendPreparedFiles({
        directory,
        ...prepared,
        transport: directoryTransport({ root: besideHome({ home }) }),
      }),
    );
    expect(existsSync(join(directory, "snapshot"))).toBe(false);
    expect(sent.report.uploaded).toBe(0);
    expect(sent.unsourced).toEqual(["corpus/bronze/slack/6d_2026-09-08.jsonl", "knowledge/lessons.jsonl"]);
  });
});
