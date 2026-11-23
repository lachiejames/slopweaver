/**
 * Sending a chunked file's missing chunks — read from the frozen file, checked, encoded, sent, checked again.
 *
 * ## The proof chain, one chunk at a time
 *
 * 1. Read the chunk's bytes from the file at its offset — a frozen clone or a staged dump, which nothing else
 *    writes — and refuse when they no longer hash to the digest the plan recorded.
 * 2. Encode that exact buffer, write it to a scratch file, and send THAT through the same verified upload
 *    every blob uses (`./transport.ts`: the verified write, and the digest of what streamed).
 * 3. Refuse, and take the object back out, when what landed is not the encoded bytes at the length sent.
 *
 * So an object under `chunks/<encoding>/<sha256>` is always the encoding of bytes that hash to its name, which
 * is what lets {@link missingChunks} trust a name it finds.
 *
 * ## Why several at once, when the blobs go one at a time
 *
 * A chunk is at most 8 MiB raw and a bronze one compresses 7–32x, so on this uplink a chunk's round trips —
 * the upload, then the metadata read — cost more than its bytes. MEASURED: the former cloud bucket
 * (GCS Sydney) through Cloudflare WARP at 645 KiB/s, where a 150 KiB encoded chunk is a quarter-second of
 * transfer behind a second of requests. {@link CHUNK_UPLOAD_CONCURRENCY} overlaps the waiting, and it is
 * small because the link, not this process, is the ceiling once the requests overlap.
 */
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createConcurrencyLimiter, type RetryPolicy } from "#lib/resilience.js";
import { err, ok, type Result } from "#lib/result.js";

import { type ChunkError, ChunkErrors } from "./chunkErrors.js";
import {
  type ChunkEncoding,
  type ChunkedContent,
  type ChunkTally,
  chunkObjectName,
  chunkPrefix,
  distinctChunks,
  type MissingChunk,
  missingChunks,
} from "./chunkPlan.js";
import { encodeChunk } from "./chunks.js";
import { type BackupTransport, uploadRetried } from "./transport.js";

/** How many chunks are in flight at once — see the header for why more than one, and why not many. */
const CHUNK_UPLOAD_CONCURRENCY = 6;

/** How a failed chunk upload is retried — every failure, because a chunk write is idempotent by its name. */
const CHUNK_UPLOAD_RETRY: RetryPolicy = { isRetryable: () => true, retries: 3 };

/** What sending one file's missing chunks carried. */
interface SentChunks {
  readonly sent: number;
  readonly rawBytes: number;
  readonly storedBytes: number;
}

/**
 * Read one chunk's raw bytes from an open file, refusing when they are not the chunk the plan recorded.
 *
 * @param descriptor the open file
 * @param chunk the chunk and where it sits
 * @param path the file, for the refusal
 * @returns the raw bytes, or why they are not the chunk
 */
function readChunk({
  descriptor,
  chunk,
  path,
}: {
  descriptor: number;
  chunk: MissingChunk;
  path: string;
}): Result<Buffer, ChunkError> {
  const raw = Buffer.allocUnsafe(chunk.bytes);
  let read = 0;
  while (read < chunk.bytes) {
    const got = readSync(descriptor, raw, read, chunk.bytes - read, chunk.offset + read);
    if (got === 0) {
      return err(ChunkErrors.changed({ offset: chunk.offset, path }));
    }
    read += got;
  }
  if (createHash("sha256").update(raw).digest("hex") !== chunk.sha256) {
    return err(ChunkErrors.changed({ offset: chunk.offset, path }));
  }
  return ok(raw);
}

/**
 * Send one chunk and check what landed, taking it back out when it is not what was sent.
 *
 * @param stored the encoded bytes
 * @param objectName where they go
 * @param scratch the directory the encoded bytes are staged in for the upload
 * @param retry how a failed upload is retried
 * @param transport the destination
 * @returns nothing, or why the chunk did not land as sent
 */
async function sendOne({
  stored,
  objectName,
  scratch,
  retry,
  transport,
}: {
  stored: Buffer;
  objectName: string;
  scratch: string;
  retry: RetryPolicy;
  transport: BackupTransport;
}): Promise<Result<void, ChunkError | string>> {
  const staged = join(scratch, objectName.replaceAll("/", "_"));
  writeFileSync(staged, stored, { mode: 0o600 });
  try {
    const landed = await uploadRetried({ bytes: stored.length, objectName, path: staged, retry, transport });
    if (landed.isErr()) {
      return err(landed.error.message);
    }
    const digest = createHash("sha256").update(stored).digest("hex");
    if (landed.value.bytes === stored.length && landed.value.sha256 === digest && landed.value.name === objectName) {
      return ok(undefined);
    }
    const why = `landed as ${String(landed.value.bytes)} byte(s) hashing to ${landed.value.sha256.slice(0, 12)}…, sent ${String(stored.length)} hashing to ${digest.slice(0, 12)}…`;
    const removed = await transport.remove({ objectName });
    if (removed.isErr()) {
      return err(ChunkErrors.leftBehind({ objectName, why: removed.error.message }));
    }
    return err(ChunkErrors.landedWrong({ objectName, why }));
  } finally {
    rmSync(staged, { force: true });
  }
}

/**
 * Send every missing chunk of one file, {@link CHUNK_UPLOAD_CONCURRENCY} at a time, stopping at the first
 * failure: a chunk already in flight finishes, and none is started after it.
 *
 * @param path the frozen file the chunks are read from
 * @param missing the chunks to send, from {@link missingChunks}
 * @param encoding how they are stored
 * @param project the Supabase project id their names are built under
 * @param scratch a directory this call may stage encoded chunks in
 * @param transport the destination
 * @param retry how a failed chunk upload is retried; a test passes a zero backoff
 * @returns what was sent, or one line per failure
 */
async function sendChunks({
  path,
  missing,
  encoding,
  project,
  scratch,
  transport,
  retry = CHUNK_UPLOAD_RETRY,
}: {
  path: string;
  missing: readonly MissingChunk[];
  encoding: ChunkEncoding;
  project: string;
  scratch: string;
  transport: BackupTransport;
  retry?: RetryPolicy;
}): Promise<Result<SentChunks>> {
  const limit = createConcurrencyLimiter({ concurrency: CHUNK_UPLOAD_CONCURRENCY });
  const failures: string[] = [];
  let sent = 0;
  let rawBytes = 0;
  let storedBytes = 0;
  const descriptor = openSync(path, "r");
  try {
    await Promise.all(
      missing.map((chunk) =>
        limit(async () => {
          if (failures.length > 0) {
            return;
          }
          const raw = readChunk({ chunk, descriptor, path });
          if (raw.isErr()) {
            failures.push(raw.error.message);
            return;
          }
          const stored = encodeChunk({ encoding, raw: raw.value });
          const objectName = chunkObjectName({ encoding, project, sha256: chunk.sha256 });
          const landed = await sendOne({ objectName, retry, scratch, stored, transport });
          if (landed.isErr()) {
            failures.push(typeof landed.error === "string" ? landed.error : landed.error.message);
            return;
          }
          sent += 1;
          rawBytes += chunk.bytes;
          storedBytes += stored.length;
        }),
      ),
    );
  } finally {
    closeSync(descriptor);
  }
  if (failures.length > 0) {
    return err(failures);
  }
  return ok({ rawBytes, sent, storedBytes });
}

/**
 * Every chunk of one encoding the destination already holds, name to stored length, from ONE listing — shared by
 * every file a run sends, and added to as chunks land so a chunk two files share is sent once.
 *
 * @param transport the destination
 * @param project the Supabase project id
 * @param encoding which chunk prefix to list
 * @returns the listing, or why it failed
 */
export async function chunkInventory({
  transport,
  project,
  encoding,
}: {
  transport: BackupTransport;
  project: string;
  encoding: ChunkEncoding;
}): Promise<Result<Map<string, number>>> {
  const sizes = await transport.objectSizes({ prefix: chunkPrefix({ encoding, project }) });
  if (sizes.isErr()) {
    return err([sizes.error.message]);
  }
  return ok(new Map(sizes.value));
}

/**
 * Send whatever one chunked file's content names that the destination lacks, and record what landed in `stored`.
 *
 * @param path the frozen file the chunks are read from
 * @param content the file's chunk list
 * @param project the Supabase project id
 * @param scratch a directory this call may stage encoded chunks in
 * @param stored the run's shared inventory of this encoding, from {@link chunkInventory}; grown in place
 * @param transport the destination
 * @param retry how a failed chunk upload is retried; a test passes a zero backoff
 * @returns the tally, or one line per failure
 */
export async function sendContentChunks({
  path,
  content,
  project,
  scratch,
  stored,
  transport,
  retry = CHUNK_UPLOAD_RETRY,
}: {
  path: string;
  content: ChunkedContent;
  project: string;
  scratch: string;
  stored: Map<string, number>;
  transport: BackupTransport;
  retry?: RetryPolicy;
}): Promise<Result<ChunkTally>> {
  const missing = missingChunks({ content, project, stored });
  const sent = await sendChunks({ encoding: content.encoding, missing, path, project, retry, scratch, transport });
  if (sent.isErr()) {
    return err(sent.error);
  }
  for (const chunk of missing) {
    stored.set(chunkObjectName({ encoding: content.encoding, project, sha256: chunk.sha256 }), chunk.bytes);
  }
  const chunks = distinctChunks({ content });
  return ok({
    chunks,
    held: chunks - missing.length,
    sent: sent.value.sent,
    sentRawBytes: sent.value.rawBytes,
    sentStoredBytes: sent.value.storedBytes,
  });
}
