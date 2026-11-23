/**
 * The files leg when the home changes under it: files removed after the walk, files that cannot be frozen, a
 * listing that fails, and an upload whose landed bytes are not the frozen copy. The upload-retry scenarios are
 * in `backupRunFilesLeg.test.ts`. Every change lands between the walk and the freeze — the window a resync or a
 * walk's scratch file closes in — which a walk that acts after walking reaches without a mock.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../lib/result.js";
import { CHUNKED_FILE_MIN_BYTES, NO_CHUNKS } from "../../../store/backup/chunkPlan.js";
import { walkBackedUpFiles } from "../../../store/backup/files.js";
import { LocalDestinationErrors } from "../../../store/backup/localDestinationErrors.js";
import { FILES_MANIFEST } from "../../../store/backup/plan.js";
import { NO_PROTECTION } from "../../../store/backup/protectedPaths.js";
import type { BackupDeps } from "../../../store/backup/run.js";
import { freezeSmallFiles } from "../../../store/backup/smallFiles.js";
import type { BackupTransport } from "../../../store/backup/transport.js";
import { BackupUploadErrors } from "../../../store/backup/uploadErrors.js";

import { besideHome, blobFor, FAKE_STACK, removeSandboxHomes, sandboxHome, sha256Of } from "./backupRunWorld.js";
import { directoryTransport } from "./directoryTransport.js";
import { runFilesLeg } from "./filesLegOnce.js";

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
 * The entries a staging's `files.json` names.
 *
 * @param directory the staging directory
 * @returns its entries
 */
function manifestFiles({ directory }: { directory: string }): readonly { relativePath: string; sha256: string }[] {
  return (
    JSON.parse(readFileSync(join(directory, FILES_MANIFEST), "utf8")) as {
      files: readonly { relativePath: string; sha256: string }[];
    }
  ).files;
}

describe("the files leg when the home changes under it", () => {
  it("leaves out and counts a small file removed after the walk, before its freeze", async () => {
    const home = sandboxHome();
    const directory = join(home, "staged");
    mkdirSync(directory, { recursive: true });
    const bronze = join(home, "corpus", "bronze", "slack", "6d_2026-09-08.jsonl");
    const report = unwrap(
      await runFilesLeg({
        deps: walkThen({ action: () => rmSync(bronze) }),
        directory,
        home,
        nowIso: "2026-10-15T16:00:00.000Z",
        transport: directoryTransport({ root: besideHome({ home }) }),
      }),
    );
    expect(report.vanished).toBe(1);
    expect(report.count).toBe(1);
    expect(report.uploaded).toBe(1);
    expect(manifestFiles({ directory }).map((file) => file.relativePath)).toEqual(["knowledge/lessons.jsonl"]);
  });

  it("names each survivor once, by its frozen digest, when an earlier file vanished before a later rewrite", async () => {
    const home = sandboxHome();
    const directory = join(home, "staged");
    mkdirSync(directory, { recursive: true });
    // Path order: corpus/bodies (vanishes) < corpus/bronze (rewritten) < knowledge (unchanged).
    mkdirSync(join(home, "corpus", "bodies"), { recursive: true });
    const body = join(home, "corpus", "bodies", "page.json");
    writeFileSync(body, '{"body":"scratch"}');
    const bronze = join(home, "corpus", "bronze", "slack", "6d_2026-09-08.jsonl");
    const rewritten = Buffer.from('{"text":"rewritten by a resync after the walk"}\n');
    const deps = walkThen({
      action: () => {
        rmSync(body);
        writeFileSync(bronze, rewritten);
      },
    });
    const report = unwrap(
      await runFilesLeg({
        deps,
        directory,
        home,
        nowIso: "2026-10-15T16:00:00.000Z",
        transport: directoryTransport({ root: besideHome({ home }) }),
      }),
    );
    expect(report.vanished).toBe(1);
    expect(manifestFiles({ directory }).map((file) => file.relativePath)).toEqual([
      "corpus/bronze/slack/6d_2026-09-08.jsonl",
      "knowledge/lessons.jsonl",
    ]);
    expect(manifestFiles({ directory })[0]!.sha256).toBe(sha256Of({ bytes: rewritten }));
  });

  it("still fails the leg when a file cannot be frozen for any reason but being gone", async () => {
    const home = sandboxHome();
    const directory = join(home, "staged");
    mkdirSync(directory, { recursive: true });
    const bronze = join(home, "corpus", "bronze", "slack", "6d_2026-09-08.jsonl");
    // A directory where the file was: the clone fails, and not with ENOENT.
    const deps = walkThen({
      action: () => {
        rmSync(bronze);
        mkdirSync(bronze);
      },
    });
    const result = await runFilesLeg({
      deps,
      directory,
      home,
      nowIso: "2026-10-15T16:00:00.000Z",
      transport: directoryTransport({ root: besideHome({ home }) }),
    });
    expect(unwrapErr(result)[0]).toContain(
      "corpus/bronze/slack/6d_2026-09-08.jsonl: could not be frozen into the snapshot it is sent from",
    );
    expect(existsSync(join(directory, "snapshot"))).toBe(false);
    expect(existsSync(join(directory, FILES_MANIFEST))).toBe(true);
  });

  it("fails, never skips, a small file still in place when the SNAPSHOT is what is missing", () => {
    const home = sandboxHome();
    const files = unwrap(FAKE_STACK.walkBackedUpFiles({ home, protection: NO_PROTECTION })).files;
    // The clone's destination directory is absent, so copyFile throws ENOENT about the DESTINATION, not the source.
    const result = freezeSmallFiles({
      digest: FAKE_STACK.digestFile,
      files,
      home,
      snapshot: join(home, "no-such-snapshot"),
    });
    expect(unwrapErr(result)[0]).toContain(
      "corpus/bronze/slack/6d_2026-09-08.jsonl: could not be frozen into the snapshot it is sent from",
    );
  });

  it("leaves out and counts a large file removed after the walk, before its freeze", async () => {
    const home = sandboxHome();
    const directory = join(home, "staged");
    mkdirSync(directory, { recursive: true });
    // A walk that measured a large file which is gone by the freeze — no 64 MiB fixture needed to reach it.
    const walksAGoneLargeFile: BackupDeps = {
      ...FAKE_STACK,
      walkBackedUpFiles: ({ home: walkedHome, protection }) =>
        walkBackedUpFiles({ home: walkedHome, protection }).map((walked) => ({
          ...walked,
          files: [
            ...walked.files,
            {
              bytes: CHUNKED_FILE_MIN_BYTES,
              relativePath: "corpus/bronze/slack/compact.jsonl",
              sha256: "0".repeat(64),
            },
          ],
        })),
    };
    const report = unwrap(
      await runFilesLeg({
        deps: walksAGoneLargeFile,
        directory,
        home,
        nowIso: "2026-10-15T16:00:00.000Z",
        transport: directoryTransport({ root: besideHome({ home }) }),
      }),
    );
    expect(report.vanished).toBe(1);
    expect(report.count).toBe(2);
    expect(report.chunks).toEqual(NO_CHUNKS);
    expect(manifestFiles({ directory }).map((file) => file.relativePath)).toEqual([
      "corpus/bronze/slack/6d_2026-09-08.jsonl",
      "knowledge/lessons.jsonl",
    ]);
  });

  it("reports a listing failure without sending anything", async () => {
    const home = sandboxHome();
    const directory = join(home, "staged");
    mkdirSync(directory, { recursive: true });
    const root = besideHome({ home });
    const inner = directoryTransport({ root });
    const unlistable: BackupTransport = {
      ...inner,
      objectSizes: async ({ prefix }) =>
        err(LocalDestinationErrors.listFailed({ cause: new Error("EACCES"), prefix, root })),
    };
    const result = await runFilesLeg({
      deps: FAKE_STACK,
      directory,
      home,
      nowIso: "2026-09-14T03:00:00.000Z",
      transport: unlistable,
    });
    expect(unwrapErr(result)).toEqual([
      LocalDestinationErrors.listFailed({ cause: new Error("EACCES"), prefix: "slopweaver/blobs/", root }).message,
    ]);
    expect(inner.uploaded).toEqual([]);
  });

  // The three below hand the files leg its transport BARE: `runBackup` always wraps its destination in the object
  // cipher, which reads the frozen clone itself, so only a bare transport sees the clone's path and its own count.
  it("refuses an upload whose landed size disagrees with the frozen file", async () => {
    const home = sandboxHome();
    const directory = join(home, "staged");
    mkdirSync(directory, { recursive: true });
    const short: BackupTransport = {
      ...directoryTransport({ root: besideHome({ home }) }),
      upload: async ({ objectName }) => ok({ bytes: 1, name: objectName, sha256: "" }),
    };
    const result = await runFilesLeg({
      deps: FAKE_STACK,
      directory,
      home,
      nowIso: "2026-09-14T03:00:00.000Z",
      transport: short,
    });
    expect(unwrapErr(result)[0]).toContain("did not carry the whole file");
  });

  it("removes the blob and refuses when the bytes that landed are not the frozen copy", async () => {
    const home = sandboxHome();
    const directory = join(home, "staged");
    mkdirSync(directory, { recursive: true });
    const root = besideHome({ home });
    const lessons = join(home, "knowledge", "lessons.jsonl");
    const measured = readFileSync(lessons);
    const named = blobFor({ bytes: measured });
    const inner = directoryTransport({ root });
    // Corrupts the CLONE under the transport, which nothing but a transport fault could do in production.
    const corrupting: BackupTransport = {
      ...inner,
      upload: async (args) => {
        if (args.objectName === named) {
          writeFileSync(args.path, "Z".repeat(measured.length));
        }
        return inner.upload(args);
      },
    };
    const result = await runFilesLeg({
      deps: FAKE_STACK,
      directory,
      home,
      nowIso: "2026-09-14T03:00:00.000Z",
      transport: corrupting,
    });
    expect(unwrapErr(result)).toEqual([
      BackupUploadErrors.blobRewritten({
        named: sha256Of({ bytes: measured }),
        relativePath: join("knowledge", "lessons.jsonl"),
        sent: sha256Of({ bytes: Buffer.from("Z".repeat(measured.length)) }),
      }).message,
    ]);
    expect(existsSync(join(root, named))).toBe(false);
  });

  it("says the destination still holds the bad blob when the removal itself fails", async () => {
    const home = sandboxHome();
    const directory = join(home, "staged");
    mkdirSync(directory, { recursive: true });
    const root = besideHome({ home });
    const lessons = join(home, "knowledge", "lessons.jsonl");
    const measured = readFileSync(lessons);
    const named = blobFor({ bytes: measured });
    const inner = directoryTransport({ root });
    const stuck: BackupTransport = {
      ...inner,
      remove: async ({ objectName }) =>
        err(LocalDestinationErrors.removeFailed({ cause: new Error("EPERM"), objectName, root })),
      upload: async (args) => {
        if (args.objectName === named) {
          writeFileSync(args.path, "Z".repeat(measured.length));
        }
        return inner.upload(args);
      },
    };
    const result = await runFilesLeg({
      deps: FAKE_STACK,
      directory,
      home,
      nowIso: "2026-09-14T03:00:00.000Z",
      transport: stuck,
    });
    const line = unwrapErr(result)[0]!;
    expect(line).toContain("the bytes that landed are not the frozen copy they were named for");
    expect(line).toContain(`could NOT be removed (could not remove ${root}/${named}: EPERM)`);
    expect(line).toContain("Delete it by hand before the next backup");
    expect(existsSync(join(root, named))).toBe(true);
  });
});
