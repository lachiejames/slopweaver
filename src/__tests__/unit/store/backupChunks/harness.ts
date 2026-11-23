/*
 * What the backup chunk-store test files share: the size unit, a retry policy that never waits, deterministic
 * incompressible bytes and their chunk digests, and the throwaway directories each case writes into, removed after
 * every case by the `afterEach` that `useScratchDirectories()` registers.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach } from "vitest";

import { chunkLengths } from "../../../../store/backup/chunkBoundaries.js";

/** One mebibyte, the unit every file size here is written in. */
export const MIB = 1024 * 1024;
/** A retry policy that never retries, so a failed send fails at once. */
export const NO_BACKOFF = { isRetryable: (): boolean => false, retries: 0 };

const directories: string[] = [];

/** Register the `afterEach` that removes every directory minted since the last case. Call it once per test file. */
export function useScratchDirectories(): void {
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });
}

/**
 * A throwaway directory, removed after each test.
 *
 * @returns the new directory's absolute path
 */
export function scratchDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "backup-chunks-"));
  directories.push(directory);
  return directory;
}

/**
 * Deterministic incompressible bytes from a seed — xorshift32, so the same seed is the same file every run.
 *
 * @param bytes how many
 * @param seed the stream's seed, non-zero
 * @returns the bytes
 */
export function noise({ bytes, seed }: { bytes: number; seed: number }): Buffer {
  const words = new Uint32Array(Math.ceil(bytes / 4));
  let state = seed;
  for (let index = 0; index < words.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    words[index] = state >>> 0;
  }
  return Buffer.from(words.buffer, 0, bytes);
}

/**
 * The digest of each chunk of `data`, in order.
 *
 * @returns one sha256 hex digest per chunk the content-defined cut makes
 */
export function chunkDigests({ data }: { data: Buffer }): readonly string[] {
  const digests: string[] = [];
  let offset = 0;
  for (const length of chunkLengths({ data })) {
    digests.push(
      createHash("sha256")
        .update(data.subarray(offset, offset + length))
        .digest("hex"),
    );
    offset += length;
  }
  return digests;
}
