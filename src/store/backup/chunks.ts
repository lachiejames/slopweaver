/**
 * The effectful half of the chunk store: cutting a file on disk into its chunk list, and encoding one chunk.
 *
 * Every buffer here is bounded by {@link CHUNK_MAX_BYTES}: a file is read through a window twice the largest
 * chunk and never whole, which is the only shape that can cut a 17 GB `compact.jsonl`. MEASURED on
 * this machine, cutting and hashing it runs at ~700 MB/s — about 25 seconds for the largest file the backup
 * carries (`node scratch cdc bench` over the first 4 GB of `corpus/bronze/slack/compact.jsonl`: 4,000,000,000
 * bytes in 5.7 s).
 */
import { createHash } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";

import { err, ok, type Result } from "#lib/result.js";

import { CHUNK_MAX_BYTES, CHUNKING, chunkLength } from "./chunkBoundaries.js";
import { type ChunkError, ChunkErrors } from "./chunkErrors.js";
import type { ChunkEncoding, ChunkedContent, ChunkRef } from "./chunkPlan.js";

/** zstd's level for a chunk: 3 is its default, and the measured 7–32x on bronze needs nothing higher. */
const ZSTD_LEVEL = 3;

/** A file cut into chunks: its whole length and digest, and the content a manifest records. */
export interface PlannedFile {
  readonly bytes: number;
  readonly sha256: string;
  readonly content: ChunkedContent;
}

/**
 * Fill `buffer` from `descriptor` at the file position, as far as the file allows.
 *
 * @param descriptor the open file
 * @param buffer where the bytes go
 * @param from the offset in `buffer` to fill from
 * @param position the file offset to read from
 * @param size the file's length, past which nothing is read
 * @returns how many bytes were read
 */
function fill({
  descriptor,
  buffer,
  from,
  position,
  size,
}: {
  descriptor: number;
  buffer: Buffer;
  from: number;
  position: number;
  size: number;
}): number {
  let read = 0;
  while (from + read < buffer.length && position + read < size) {
    const got = readSync(descriptor, buffer, from + read, buffer.length - from - read, position + read);
    if (got === 0) {
      break;
    }
    read += got;
  }
  return read;
}

/**
 * Cut one open file into chunks, hashing each chunk and the whole file on the way past.
 *
 * @param descriptor the open file
 * @returns the whole length and digest, and the chunks in order
 */
function cutOpenFile({ descriptor }: { descriptor: number }): {
  bytes: number;
  sha256: string;
  chunks: readonly ChunkRef[];
} {
  const size = fstatSync(descriptor).size;
  const whole = createHash("sha256");
  const chunks: ChunkRef[] = [];
  const buffer = Buffer.allocUnsafe(CHUNK_MAX_BYTES * 2);
  let filePosition = 0;
  let start = 0;
  let end = 0;
  while (filePosition < size || start < end) {
    if (end - start < CHUNK_MAX_BYTES && filePosition < size) {
      buffer.copy(buffer, 0, start, end);
      end -= start;
      start = 0;
      const read = fill({ buffer, descriptor, from: end, position: filePosition, size });
      end += read;
      filePosition += read;
      if (read === 0 && start === end) {
        break;
      }
    }
    const length = chunkLength({ window: buffer.subarray(start, end) });
    const chunk = buffer.subarray(start, start + length);
    whole.update(chunk);
    chunks.push({ bytes: length, sha256: createHash("sha256").update(chunk).digest("hex") });
    start += length;
  }
  return { bytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0), chunks, sha256: whole.digest("hex") };
}

/**
 * Cut one file into its chunk list.
 *
 * @param path the file — a frozen clone or a staged dump, which nothing else writes
 * @param encoding how its chunks will be stored
 * @returns the whole file's length and digest and its content, or why it could not be read
 */
export function planFileChunks({
  path,
  encoding,
}: {
  path: string;
  encoding: ChunkEncoding;
}): Result<PlannedFile, ChunkError> {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, "r");
    const cut = cutOpenFile({ descriptor });
    return ok({ bytes: cut.bytes, content: { chunking: CHUNKING, chunks: cut.chunks, encoding }, sha256: cut.sha256 });
  } catch (cause: unknown) {
    return err(ChunkErrors.planFailed({ cause, path }));
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor);
    }
  }
}

/**
 * The bytes a chunk is stored as.
 *
 * @param raw the chunk's raw bytes, at most {@link CHUNK_MAX_BYTES}
 * @param encoding how to store them
 * @returns the stored bytes
 */
export function encodeChunk({ raw, encoding }: { raw: Buffer; encoding: ChunkEncoding }): Buffer {
  if (encoding === "identity") {
    return raw;
  }
  return zstdCompressSync(raw, { params: { [constants.ZSTD_c_compressionLevel]: ZSTD_LEVEL } });
}

/**
 * A stored chunk's raw bytes, checked against the length and digest its name and manifest promise.
 *
 * The output is capped at {@link CHUNK_MAX_BYTES}, so a stored object claiming to inflate past any chunk this
 * store can cut is refused rather than allowed to take the memory it asks for.
 *
 * @param stored the bytes as downloaded
 * @param chunk the manifest's record of the chunk
 * @param encoding how it was stored
 * @param objectName where it came from, for the refusal
 * @returns the raw bytes, or why they are not the chunk
 */
export function decodeChunk({
  stored,
  chunk,
  encoding,
  objectName,
}: {
  stored: Buffer;
  chunk: ChunkRef;
  encoding: ChunkEncoding;
  objectName: string;
}): Result<Buffer, ChunkError> {
  let raw: Buffer;
  try {
    raw = encoding === "identity" ? stored : zstdDecompressSync(stored, { maxOutputLength: CHUNK_MAX_BYTES });
  } catch (cause: unknown) {
    const why = `will not decode as ${encoding} (${cause instanceof Error ? cause.message : String(cause)})`;
    return err(ChunkErrors.corrupt({ objectName, why }));
  }
  const digest = createHash("sha256").update(raw).digest("hex");
  if (raw.length !== chunk.bytes || digest !== chunk.sha256) {
    const why = `decodes to ${String(raw.length)} byte(s) hashing to ${digest.slice(0, 12)}…, not the recorded ${String(chunk.bytes)} hashing to ${chunk.sha256.slice(0, 12)}…`;
    return err(ChunkErrors.corrupt({ objectName, why }));
  }
  return ok(raw);
}
