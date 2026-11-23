/**
 * The chunk store under the backup: where content-defined cuts fall in a buffer, and which cuts an edit or a growth
 * leaves alone.
 */
import { describe, expect, it } from "vitest";

import { CHUNK_MAX_BYTES, CHUNK_MIN_BYTES, chunkLengths } from "../../../../store/backup/chunkBoundaries.js";

import { chunkDigests, MIB, noise } from "./harness.js";

describe("where a chunk is cut", () => {
  it("cuts nothing from nothing, and one chunk from a file shorter than the smallest", () => {
    expect(chunkLengths({ data: Buffer.alloc(0) })).toEqual([]);
    expect(chunkLengths({ data: noise({ bytes: 1000, seed: 7 }) })).toEqual([1000]);
  });

  it("covers every byte, keeps every chunk inside its bounds, and cuts by content rather than at the cap", () => {
    const data = noise({ bytes: 40 * MIB, seed: 1 });
    const lengths = chunkLengths({ data });
    expect(lengths.reduce((sum, length) => sum + length, 0)).toBe(data.length);
    expect(lengths.slice(0, -1).filter((length) => length < CHUNK_MIN_BYTES || length > CHUNK_MAX_BYTES)).toEqual([]);
    expect(lengths.filter((length) => length < CHUNK_MAX_BYTES).length).toBeGreaterThan(lengths.length / 2);
    expect(chunkLengths({ data })).toEqual(lengths);
  });

  it("re-cuts only around an edit, so the chunks either side of it are the same objects", () => {
    const before = noise({ bytes: 40 * MIB, seed: 2 });
    const after = Buffer.concat([before.subarray(0, 20 * MIB), Buffer.from("an edit"), before.subarray(20 * MIB)]);
    const was = chunkDigests({ data: before });
    const now = new Set(chunkDigests({ data: after }));
    expect(was.filter((digest) => !now.has(digest)).length).toBeLessThanOrEqual(2);
  });

  it("keeps every chunk but the old tail when a file only grows", () => {
    const before = noise({ bytes: 30 * MIB, seed: 3 });
    const after = Buffer.concat([before, noise({ bytes: 3 * MIB, seed: 4 })]);
    const was = chunkDigests({ data: before });
    expect(chunkDigests({ data: after }).slice(0, was.length - 1)).toEqual(was.slice(0, -1));
  });
});
