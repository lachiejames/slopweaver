/**
 * The chunk store under the backup: which of a staging's files the destination lacks, read from one listing per
 * prefix and judged against each entry's own length.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { CHUNKING } from "../../../../store/backup/chunkBoundaries.js";
import { type ChunkedContent, chunkObjectName } from "../../../../store/backup/chunkPlan.js";
import { filesObjectsMissing } from "../../../../store/backup/filesHeld.js";
import { blobObjectName, blobPrefix, SUPABASE_PROJECT_ID } from "../../../../store/backup/plan.js";
import { blobsAlreadyHeld } from "../../../../store/backup/smallFiles.js";

import { directoryTransport } from "../directoryTransport.js";
import { scratchDirectory, useScratchDirectories } from "./harness.js";

useScratchDirectories();

describe("which of a staging's files the destination lacks", () => {
  /**
   * Put an object of a given length into the directory standing in for the bucket.
   *
   * @param bucket the directory
   * @param name the object name
   * @param bytes its length
   */
  function plant({ bucket, name, bytes }: { bucket: string; name: string; bytes: number }): void {
    mkdirSync(join(bucket, name, ".."), { recursive: true });
    writeFileSync(join(bucket, name), Buffer.alloc(bytes));
  }

  it("holds a small file's blob only at that file's own length, from one listing", async () => {
    const bucket = scratchDirectory();
    const blob = ({ sha256 }: { sha256: string }): string => blobObjectName({ project: SUPABASE_PROJECT_ID, sha256 });
    plant({ bucket, bytes: 3, name: blob({ sha256: "a".repeat(64) }) });
    plant({ bucket, bytes: 2, name: blob({ sha256: "b".repeat(64) }) });
    const files = [
      { bytes: 3, relativePath: "held", sha256: "a".repeat(64) },
      { bytes: 3, relativePath: "short", sha256: "b".repeat(64) },
      { bytes: 3, relativePath: "absent", sha256: "c".repeat(64) },
    ];
    const held = unwrap(await blobsAlreadyHeld({ files, transport: directoryTransport({ root: bucket }) }));
    expect([...held]).toEqual(["a".repeat(64)]);
  });

  it("names a blob absent or at the wrong length, and each chunk a list names that is not stored", async () => {
    const bucket = scratchDirectory();
    const held = "a".repeat(64);
    const short = "b".repeat(64);
    const absent = "c".repeat(64);
    const storedChunk = "d".repeat(64);
    const lostChunk = "e".repeat(64);
    const blob = ({ sha256 }: { sha256: string }): string => blobObjectName({ project: SUPABASE_PROJECT_ID, sha256 });
    const chunk = ({ sha256 }: { sha256: string }): string =>
      chunkObjectName({ encoding: "zstd", project: SUPABASE_PROJECT_ID, sha256 });
    plant({ bucket, bytes: 3, name: blob({ sha256: held }) });
    plant({ bucket, bytes: 2, name: blob({ sha256: short }) });
    plant({ bucket, bytes: 1, name: chunk({ sha256: storedChunk }) });
    const chunked: ChunkedContent = {
      chunking: CHUNKING,
      chunks: [
        { bytes: 5, sha256: storedChunk },
        { bytes: 5, sha256: lostChunk },
      ],
      encoding: "zstd",
    };
    const missing = await filesObjectsMissing({
      files: [
        { bytes: 3, chunked: null, relativePath: "a", sha256: held },
        { bytes: 3, chunked: null, relativePath: "b", sha256: short },
        { bytes: 3, chunked: null, relativePath: "c", sha256: absent },
        { bytes: 10, chunked, relativePath: "d", sha256: "f".repeat(64) },
      ],
      transport: directoryTransport({ root: bucket }),
    });
    expect(unwrap(missing)).toEqual([blob({ sha256: short }), blob({ sha256: absent }), chunk({ sha256: lostChunk })]);
  });

  it("checks each entry against its own length, so one entry held does not hold another with the same digest", async () => {
    const bucket = scratchDirectory();
    const sha256 = "a".repeat(64);
    const name = blobObjectName({ project: SUPABASE_PROJECT_ID, sha256 });
    plant({ bucket, bytes: 1, name });
    const missing = await filesObjectsMissing({
      files: [
        { bytes: 1, chunked: null, relativePath: "a", sha256 },
        { bytes: 2, chunked: null, relativePath: "b", sha256 },
      ],
      transport: directoryTransport({ root: bucket }),
    });
    expect(unwrap(missing)).toEqual([name]);
  });

  it("lists only the blob prefix when no file is chunked, and nothing at all for no files", async () => {
    const bucket = scratchDirectory();
    const transport = directoryTransport({ root: bucket });
    expect(unwrap(await filesObjectsMissing({ files: [], transport }))).toEqual([]);
    expect(transport.sizeListings).toEqual([]);
    const file = { bytes: 1, chunked: null, relativePath: "a", sha256: "a".repeat(64) };
    expect(unwrap(await filesObjectsMissing({ files: [file], transport }))).toEqual([
      blobObjectName({ project: SUPABASE_PROJECT_ID, sha256: file.sha256 }),
    ]);
    expect(transport.sizeListings).toEqual([blobPrefix({ project: SUPABASE_PROJECT_ID })]);
  });
});
