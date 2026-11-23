/**
 * The destination seam every backup and restore moves bytes through — named for no medium, so the local
 * directory (`./localDirectoryTransport.ts`) and the encrypting decorator over it (`./encryptingTransport.ts`)
 * satisfy one contract and every chunk, blob, staging and sweep caller stays the same code whatever the
 * directory is mounted on.
 */
import { type RetryPolicy, retryTransient } from "#lib/resilience.js";
import { err, ok, type Result } from "#lib/result.js";

import { type BackupError, BackupErrors } from "./errors.js";
import type { LocalDestinationError } from "./localDestinationErrors.js";
import type { ObjectCryptoError } from "./objectCryptoErrors.js";

/** What a destination reported about one object after a verified write, plus the digest of what was sent. */
export interface StoredObject {
  readonly name: string;
  /** The length of the PLAINTEXT the caller handed over, whatever the destination holds physically. */
  readonly bytes: number;
  /** The sha256 of the plaintext bytes this process streamed, computed on the way past rather than re-read. */
  readonly sha256: string;
}

/** Every way a destination operation fails: the local directory's, or the object cipher's. */
export type BackupTransportError = LocalDestinationError | ObjectCryptoError;

/** The operations a backup and a restore need from a destination, and nothing else. */
export interface BackupTransport {
  /** Whether the destination answers, and the location it names itself by in a receipt. */
  readonly probe: () => Promise<Result<{ location: string }, BackupTransportError>>;
  /**
   * Write one local file to one object name, verified, and report what landed. `bytes` bounds the read to
   * the length the caller measured, so a file that grew since cannot land under a name that describes the
   * shorter content; omit it for a file this process wrote and nothing else can touch.
   */
  readonly upload: (args: {
    path: string;
    objectName: string;
    bytes?: number;
  }) => Promise<Result<StoredObject, BackupTransportError>>;
  /** Delete one object — how a blob whose digest does not match its name is taken back out. */
  readonly remove: (args: { objectName: string }) => Promise<Result<void, BackupTransportError>>;
  /** Fetch one object to one local path. */
  readonly download: (args: { objectName: string; path: string }) => Promise<Result<void, BackupTransportError>>;
  /**
   * Whether a host path lies inside this destination. A download is refused there: written over a stored
   * object, it would replace ciphertext with its own decrypted bytes.
   */
  readonly holds: (args: { path: string }) => boolean;
  /** List the object names under a prefix, sorted. */
  readonly list: (args: { prefix: string }) => Promise<Result<readonly string[], BackupTransportError>>;
  /**
   * Every object under a prefix mapped to its PLAINTEXT length — how the content-addressed blobs are skipped
   * in one listing rather than a round trip per file. The size rather than mere presence, because a name
   * that is present but the wrong length is exactly a poisoned blob, and skipping it would make that state
   * permanent. An object whose length cannot be read is left out, so it reads as absent and is written again.
   */
  readonly objectSizes: (args: {
    prefix: string;
  }) => Promise<Result<ReadonlyMap<string, number>, BackupTransportError>>;
}

/**
 * One upload under an outer retry policy, above whatever the destination does itself. Only the TRANSPORT
 * failure is retried: a file that landed but does not match what was measured is the caller's refusal,
 * judged after this returns, and never re-sent blindly. Every write is idempotent by its name — a blob is
 * named for its own digest and a staged file for its backup's instant — which is what makes a retry safe.
 *
 * `p-retry` retries a THROW, so a failed attempt is thrown as an `Error` carrying the destination's message,
 * and the last one comes back out as the same message an unretried call reports.
 *
 * @param transport the destination
 * @param path the local file
 * @param objectName where it lands
 * @param bytes the length the caller measured, bounding the read
 * @param retry how a failed attempt is retried
 * @returns what landed, or the last attempt's failure
 */
export async function uploadRetried({
  transport,
  path,
  objectName,
  bytes,
  retry,
}: {
  transport: BackupTransport;
  path: string;
  objectName: string;
  bytes?: number;
  retry: RetryPolicy;
}): Promise<Result<StoredObject, BackupError>> {
  try {
    const landed = await retryTransient({
      operation: async () => {
        const sent = await transport.upload({ objectName, path, ...(bytes === undefined ? {} : { bytes }) });
        if (sent.isErr()) {
          throw new Error(sent.error.message, { cause: sent.error });
        }
        return sent.value;
      },
      policy: retry,
    });
    return ok(landed);
  } catch (thrown: unknown) {
    return err(BackupErrors.uploadFailed({ cause: thrown, objectName }));
  }
}
