/**
 * The chunk store under the backup: how a chunk is named, which chunks the destination already holds, and how two
 * send tallies add.
 */
import { describe, expect, it } from "vitest";

import { CHUNKING } from "../../../../store/backup/chunkBoundaries.js";
import {
  addTallies,
  type ChunkedContent,
  chunkObjectName,
  missingChunks,
  NO_CHUNKS,
} from "../../../../store/backup/chunkPlan.js";
import { SUPABASE_PROJECT_ID } from "../../../../store/backup/plan.js";

describe("which chunks the destination already holds", () => {
  const content: ChunkedContent = {
    chunking: CHUNKING,
    chunks: [
      { bytes: 10, sha256: "a".repeat(64) },
      { bytes: 20, sha256: "b".repeat(64) },
      { bytes: 10, sha256: "a".repeat(64) },
      { bytes: 5, sha256: "c".repeat(64) },
    ],
    encoding: "identity",
  };
  const name = ({ sha256, encoding }: { sha256: string; encoding: "identity" | "zstd" }): string =>
    chunkObjectName({ encoding, project: SUPABASE_PROJECT_ID, sha256 });

  it("names a chunk under its encoding and the digest of its raw bytes", () => {
    expect(name({ encoding: "zstd", sha256: "a".repeat(64) })).toBe(`slopweaver/chunks/zstd/${"a".repeat(64)}`);
  });

  it("asks for each missing digest once, at its first offset, in file order", () => {
    expect(missingChunks({ content, project: SUPABASE_PROJECT_ID, stored: new Map() })).toEqual([
      { bytes: 10, offset: 0, sha256: "a".repeat(64) },
      { bytes: 20, offset: 10, sha256: "b".repeat(64) },
      { bytes: 5, offset: 40, sha256: "c".repeat(64) },
    ]);
  });

  it("holds an identity chunk only at its exact raw length", () => {
    const stored = new Map([
      [name({ encoding: "identity", sha256: "a".repeat(64) }), 10],
      [name({ encoding: "identity", sha256: "b".repeat(64) }), 19],
      [name({ encoding: "zstd", sha256: "c".repeat(64) }), 5],
    ]);
    expect(missingChunks({ content, project: SUPABASE_PROJECT_ID, stored }).map((chunk) => chunk.sha256)).toEqual([
      "b".repeat(64),
      "c".repeat(64),
    ]);
  });

  it("holds a zstd chunk at any length but zero", () => {
    const zstd: ChunkedContent = { ...content, encoding: "zstd" };
    const stored = new Map([
      [name({ encoding: "zstd", sha256: "a".repeat(64) }), 3],
      [name({ encoding: "zstd", sha256: "b".repeat(64) }), 0],
    ]);
    expect(missingChunks({ content: zstd, project: SUPABASE_PROJECT_ID, stored }).map((chunk) => chunk.sha256)).toEqual(
      ["b".repeat(64), "c".repeat(64)],
    );
  });

  it("adds two tallies field by field", () => {
    const one = { chunks: 3, held: 1, sent: 2, sentRawBytes: 20, sentStoredBytes: 5 };
    expect(addTallies({ left: one, right: one })).toEqual({
      chunks: 6,
      held: 2,
      sent: 4,
      sentRawBytes: 40,
      sentStoredBytes: 10,
    });
    expect(addTallies({ left: NO_CHUNKS, right: one })).toEqual(one);
  });
});
