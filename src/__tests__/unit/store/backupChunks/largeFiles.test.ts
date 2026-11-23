/**
 * The chunk store under the backup: a night's large files, frozen into the snapshot before they are cut and sent,
 * and the freezes that are left out or refused.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { backedUpFilePath } from "../../../../store/backup/files.js";
import { filesObjectsMissing } from "../../../../store/backup/filesHeld.js";
import { freezeLargeFiles, sendLargeFiles } from "../../../../store/backup/largeFiles.js";

import { directoryTransport } from "../directoryTransport.js";
import { chunkDigests, MIB, NO_BACKOFF, noise, scratchDirectory, useScratchDirectories } from "./harness.js";

useScratchDirectories();

describe("a night's large files", () => {
  it("names each by its frozen clone, so a write after the freeze is not in what is sent", async () => {
    const home = scratchDirectory();
    const relativePath = "corpus/bronze/slack/compact.jsonl";
    const live = backedUpFilePath({ home, relativePath });
    mkdirSync(join(live, ".."), { recursive: true });
    const frozenBytes = noise({ bytes: 9 * MIB, seed: 11 });
    writeFileSync(live, frozenBytes);
    const snapshot = join(home, "snapshot");
    mkdirSync(join(snapshot, "large"), { recursive: true });
    const settled = unwrap(
      freezeLargeFiles({ files: [{ bytes: 0, relativePath, sha256: "0".repeat(64) }], home, snapshot }),
    );
    const frozen = settled.files;
    expect(settled.vanished).toBe(0);
    writeFileSync(live, "rewritten after the freeze");
    const { entry, frozenPath } = frozen[0]!;
    expect(frozen.length).toBe(1);
    expect(entry.relativePath).toBe(relativePath);
    expect(entry.bytes).toBe(9 * MIB);
    expect(entry.sha256).toBe(createHash("sha256").update(frozenBytes).digest("hex"));
    expect(frozenPath).toBe(join(snapshot, "large", entry.sha256));
    expect(entry.chunked.chunks.map((chunk) => chunk.sha256)).toEqual(chunkDigests({ data: frozenBytes }));

    const scratch = join(home, "scratch");
    mkdirSync(scratch);
    const transport = directoryTransport({ root: join(home, "bucket") });
    const sent = unwrap(await sendLargeFiles({ entries: [entry], retry: NO_BACKOFF, scratch, snapshot, transport }));
    expect(sent.tally.sent).toBe(entry.chunked.chunks.length);
    expect(sent.tally.sentRawBytes).toBe(9 * MIB);
    expect(sent.unsourced).toEqual([]);
    // The clone stays for the next destination; the live file is never touched.
    expect(existsSync(frozenPath)).toBe(true);
    expect(readFileSync(live, "utf8")).toBe("rewritten after the freeze");
    expect(unwrap(await filesObjectsMissing({ files: [entry], transport }))).toEqual([]);

    const second = directoryTransport({ root: join(home, "ssd") });
    const again = unwrap(
      await sendLargeFiles({ entries: [entry], retry: NO_BACKOFF, scratch, snapshot, transport: second }),
    );
    expect(again.tally.sent).toBe(entry.chunked.chunks.length);
    expect(unwrap(await filesObjectsMissing({ files: [entry], transport: second }))).toEqual([]);
  });

  it("leaves out and counts a large file that is gone by its freeze", () => {
    const home = scratchDirectory();
    const snapshot = join(home, "snapshot");
    mkdirSync(snapshot);

    const settled = unwrap(
      freezeLargeFiles({
        files: [{ bytes: 9 * MIB, relativePath: "corpus/bronze/slack/compact.jsonl", sha256: "0".repeat(64) }],
        home,
        snapshot,
      }),
    );

    expect(settled).toEqual({ files: [], vanished: 1 });
  });

  it("still refuses a large file that cannot be frozen for any reason but being gone", () => {
    const home = scratchDirectory();
    const relativePath = "corpus/bronze/slack/compact.jsonl";
    // A directory where the file was: the clone fails, and not with ENOENT.
    mkdirSync(backedUpFilePath({ home, relativePath }), { recursive: true });
    const snapshot = join(home, "snapshot");
    mkdirSync(snapshot);

    const refused = unwrapErr(
      freezeLargeFiles({ files: [{ bytes: 9 * MIB, relativePath, sha256: "0".repeat(64) }], home, snapshot }),
    );

    expect(refused[0]).toContain(`${relativePath}: could not be frozen into the snapshot it is sent from`);
  });

  it("refuses, never skips, a large file still in place when the SNAPSHOT is what is missing", () => {
    const home = scratchDirectory();
    const relativePath = "corpus/bronze/slack/compact.jsonl";
    const live = backedUpFilePath({ home, relativePath });
    mkdirSync(join(live, ".."), { recursive: true });
    writeFileSync(live, "still here");

    // The clone's destination directory does not exist, so copyFile throws ENOENT about the DESTINATION.
    const refused = unwrapErr(
      freezeLargeFiles({
        files: [{ bytes: 9 * MIB, relativePath, sha256: "0".repeat(64) }],
        home,
        snapshot: join(home, "no-such-snapshot"),
      }),
    );

    expect(refused[0]).toContain(`${relativePath}: could not be frozen into the snapshot it is sent from`);
  });

  it("sends nothing and lists nothing when there are no large files", async () => {
    const transport = directoryTransport({ root: join(scratchDirectory(), "bucket") });
    const sent = unwrap(
      await sendLargeFiles({
        entries: [],
        retry: NO_BACKOFF,
        scratch: scratchDirectory(),
        snapshot: scratchDirectory(),
        transport,
      }),
    );
    expect(sent).toEqual({
      tally: { chunks: 0, held: 0, sent: 0, sentRawBytes: 0, sentStoredBytes: 0 },
      unsourced: [],
    });
    expect(transport.sizeListings).toEqual([]);
  });
});
