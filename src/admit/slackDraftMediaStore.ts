/**
 * The private content store a parked as-me draft's attachments live in — the exact bytes admitted when the
 * draft was recorded, named by their SHA-256.
 *
 * ## Why the bytes are kept, not the path
 *
 * A parked draft is read by the owner hours before it is released. A row naming a PATH would release
 * whatever sits at that path on the day, which is exactly the gap `../visualEvidence/prepareUploads.ts`
 * refuses to reopen one layer down ("a path alone is not a proof"). So `slack draft record --media` stores
 * the bytes it admitted here and binds their hash into the digest the owner approves, and a release reads them back
 * ONCE, verifying length and hash, and sends those verified bytes without reopening anything.
 *
 * ## Layout and permissions
 *
 * `$SLOPWEAVER_HOME/queue/slack-draft-media/<sha[0:2]>/<sha256>` — `../corpus/contentStore.ts`'s own naming
 * and sharding, so there is one scheme for content addressing in this repository. Directories `0700`, files
 * `0600`: an unsent attachment is as private as the unsent message in `./slackDraftStore.ts`. The original
 * filename is ROW metadata and never part of the storage path, so no name a composer typed can steer a write.
 * Nor can a symbolic link: every entry between the state home and the blob (`queue`, the store root, the shard,
 * the blob) is refused when it is one, before any write or read, because following one would put approved
 * bytes outside the owner-only store. The home itself may be a link; it is the operator's to place. The store
 * root and a shard are this store's alone, so storing leaves them exactly `0700` and the blob `0600`, whatever
 * it found and whether it wrote the blob or found it there; `queue` is shared with the other queue stores and keeps whatever mode they gave it.
 *
 * ## Retention
 *
 * Nothing here deletes. Identical bytes are held once, so a blob may back several drafts, and the register
 * and this store share no lock — deleting on one snapshot would race a recorder that has written its blob
 * but not yet appended its row. Blobs therefore outlive release and drop until a sweep that takes one lock
 * across both exists; until then this store is append-only by construction.
 */
import { chmodSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";

import { contentDigest, contentPath } from "../corpus/contentStore.js";
import type { SlackUpload } from "../corpus/slack/writeTransport.js";
import { firstLinkedEntry } from "../lib/pathContainment.js";
import { err, ok, type Result } from "../lib/result.js";
import { writeFileAtomicBytes } from "../lib/writeAtomic.js";
import { type SlackDraftError, SlackDraftErrors } from "../outbound/slack/draftErrors.js";
import type { ParkedSlackDraftMedia } from "../outbound/slack/draftRegister.js";
import { stateHomePaths } from "../stateHome.js";

/** Owner-only permissions: these are the bytes of a message the owner has not decided to send. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** One stored attachment read back and verified: its path, the exact bytes, and the row entry they match. */
export interface VerifiedDraftMedia {
  readonly path: string;
  readonly upload: SlackUpload;
  readonly record: ParkedSlackDraftMedia;
}

/**
 * Where one attachment's bytes live.
 *
 * @param home the state home the store lives under
 * @param sha256 the lowercase-hex SHA-256 the row records
 * @returns the absolute blob path, sharded on the hash's first two characters
 */
export function slackDraftMediaPath({ home, sha256 }: { home: string; sha256: string }): string {
  return contentPath({ digest: sha256, root: stateHomePaths({ home }).slackDraftMedia });
}

/**
 * The first entry below the state home, on the way to a blob, that is a symbolic link, or undefined when none
 * is (`../lib/pathContainment.ts`).
 *
 * @returns the linked path, or undefined
 */
function linkedEntry({ home, path }: { home: string; path: string }): string | undefined {
  // The home is the queue directory's parent, as stateHome.ts spells it, so the walk up stops exactly there.
  return firstLinkedEntry({ path, top: dirname(stateHomePaths({ home }).queue) });
}

/**
 * Read one blob, or say why it cannot be: absent is `DRAFT_MEDIA_MISSING`, anything else a read failure.
 *
 * @returns the bytes on disk, or the typed refusal
 */
function readBlob({
  name,
  path,
  sha256,
}: {
  name: string;
  path: string;
  sha256: string;
}): Result<Buffer, SlackDraftError> {
  try {
    return ok(readFileSync(path));
  } catch (cause: unknown) {
    if (isMissing({ cause })) {
      return err(SlackDraftErrors.mediaMissing({ name, path, sha256 }));
    }
    return err(SlackDraftErrors.mediaReadFailed({ cause, path }));
  }
}

/** Whether a thrown filesystem error means the file is simply not there. */
function isMissing({ cause }: { cause: unknown }): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

/**
 * Whether bytes are exactly the ones a row entry records, by length and by SHA-256.
 *
 * @returns the refusal naming both sides, or nothing when they match
 */
function mismatchOf({
  bytes,
  path,
  record,
}: {
  bytes: Buffer;
  path: string;
  record: ParkedSlackDraftMedia;
}): SlackDraftError | undefined {
  const observed = { bytes: bytes.length, sha256: contentDigest({ bytes }) };
  if (observed.bytes === record.bytes && observed.sha256 === record.sha256) {
    return undefined;
  }
  return SlackDraftErrors.mediaCorrupt({
    name: record.name,
    observed,
    path,
    recorded: { bytes: record.bytes, sha256: record.sha256 },
  });
}

/**
 * Store one attachment's admitted bytes, or recognise a verified copy already there.
 *
 * An existing blob is READ and verified before it is trusted, and a corrupt one REFUSES rather than being
 * silently overwritten: it may back an older draft, and repairing it under that draft would change bytes
 * somebody else's approval names.
 *
 * @returns the row entry for these bytes, or the typed refusal
 */
function storeOne({
  home,
  upload,
}: {
  home: string;
  upload: SlackUpload;
}): Result<ParkedSlackDraftMedia, SlackDraftError> {
  const bytes = Buffer.from(upload.bytes);
  const record: ParkedSlackDraftMedia = {
    bytes: bytes.length,
    name: upload.filename,
    sha256: contentDigest({ bytes }),
  };
  const path = slackDraftMediaPath({ home, sha256: record.sha256 });
  const linked = linkedEntry({ home, path });
  if (linked !== undefined) {
    return err(SlackDraftErrors.mediaLinked({ path: linked }));
  }
  if (exists({ path })) {
    const held = readBlob({ name: record.name, path, sha256: record.sha256 });
    if (held.isErr()) {
      return err(held.error);
    }
    const mismatch = mismatchOf({ bytes: held.value, path, record });
    if (mismatch !== undefined) {
      return err(mismatch);
    }
    return settled({ home, path, record });
  }
  try {
    writeFileAtomicBytes({ bytes, dirMode: DIR_MODE, fileMode: FILE_MODE, path });
  } catch (cause: unknown) {
    return err(SlackDraftErrors.mediaWriteFailed({ cause, path }));
  }
  return settled({ home, path, record });
}

/**
 * Answer a stored blob's row entry once its modes are settled, whether it was just written or already there.
 *
 * @returns the row entry, or the write refusal naming the path `chmod` failed on
 */
function settled({
  home,
  path,
  record,
}: {
  home: string;
  path: string;
  record: ParkedSlackDraftMedia;
}): Result<ParkedSlackDraftMedia, SlackDraftError> {
  try {
    settleStoreModes({ home, path });
  } catch (cause: unknown) {
    return err(SlackDraftErrors.mediaWriteFailed({ cause, path }));
  }
  return ok(record);
}

/**
 * Set the store root and the blob's shard to exactly `0700` and the blob to exactly `0600`: a recursive
 * create never changes a directory it finds, and the process umask can narrow a mode it asks for, so the
 * modes are settled after the write rather than trusted from it. Throws what `chmod` throws.
 */
function settleStoreModes({ home, path }: { home: string; path: string }): void {
  chmodSync(stateHomePaths({ home }).slackDraftMedia, DIR_MODE);
  chmodSync(dirname(path), DIR_MODE);
  chmodSync(path, FILE_MODE);
}

/** Whether a path names an existing entry — `statSync` rather than `existsSync`, so a permission error surfaces. */
function exists({ path }: { path: string }): boolean {
  try {
    statSync(path);
    return true;
  } catch (cause: unknown) {
    if (isMissing({ cause })) {
      return false;
    }
    // Anything but "not there" is reported by the read that follows, which names the path and the cause.
    return true;
  }
}

/**
 * Store every admitted attachment, in order, and answer the row entries that bind them.
 *
 * Stops at the first failure: the caller parks nothing unless every blob is in place. A blob written before
 * a later one failed is harmless and unreferenced — nothing names it until a row does.
 *
 * @param home the state home the store lives under
 * @param uploads the EXACT bytes admission judged, with the filename Slack will show
 * @returns one entry per upload in the caller's order, or the first refusal
 */
export function storeSlackDraftMedia({
  home,
  uploads,
}: {
  home: string;
  uploads: readonly SlackUpload[];
}): Result<readonly ParkedSlackDraftMedia[], SlackDraftError> {
  const records: ParkedSlackDraftMedia[] = [];
  for (const upload of uploads) {
    const stored = storeOne({ home, upload });
    if (stored.isErr()) {
      return err(stored.error);
    }
    records.push(stored.value);
  }
  return ok(records);
}

/**
 * Read every attachment a row names, ONCE each, and verify its length and SHA-256 against the row.
 *
 * The bytes returned are the bytes verified, and a release sends exactly them: nothing reopens the path
 * after this, so a blob replaced between the check and the upload cannot be what goes out.
 *
 * @param home the state home the store lives under
 * @param media the row's attachments, in attach order
 * @returns each attachment's verified bytes under its recorded name, or the first refusal
 */
export function readSlackDraftMedia({
  home,
  media,
}: {
  home: string;
  media: readonly ParkedSlackDraftMedia[];
}): Result<readonly VerifiedDraftMedia[], SlackDraftError> {
  const verified: VerifiedDraftMedia[] = [];
  for (const record of media) {
    const path = slackDraftMediaPath({ home, sha256: record.sha256 });
    const linked = linkedEntry({ home, path });
    if (linked !== undefined) {
      return err(SlackDraftErrors.mediaLinked({ path: linked }));
    }
    const read = readBlob({ name: record.name, path, sha256: record.sha256 });
    if (read.isErr()) {
      return err(read.error);
    }
    const mismatch = mismatchOf({ bytes: read.value, path, record });
    if (mismatch !== undefined) {
      return err(mismatch);
    }
    verified.push({ path, record, upload: { bytes: read.value, filename: record.name } });
  }
  return ok(verified);
}
