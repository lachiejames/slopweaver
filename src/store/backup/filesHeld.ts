/**
 * Which of the objects a staging's `files.json` names the destination does not hold.
 *
 * `files.json` is written before the files leg sends anything, so a night whose leg failed part-way leaves a
 * staging naming blobs and chunks that never landed. The sweep can send that staging's own objects but not
 * those: they were read from frozen clones that are gone, and the live files may have changed since
 * (`./sweep.ts` § What it cannot put back). So the sweep asks this before it writes a receipt, and a recovered
 * staging whose files half will not restore SAYS so rather than being pruned as though it would.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";

import { CHUNK_ENCODINGS, chunkObjectName, missingChunks } from "./chunkPlan.js";
import { chunkInventory } from "./chunkUpload.js";
import { backupErrorLines } from "./errors.js";
import {
  blobObjectName,
  blobPrefix,
  FILES_MANIFEST,
  type ManifestFile,
  parseFilesManifest,
  SUPABASE_PROJECT_ID,
} from "./plan.js";
import type { BackupTransport } from "./transport.js";

/**
 * {@link filesObjectsMissing} over the `files.json` a staging directory holds, beside the digest of the exact
 * bytes it checked — so a caller can refuse when the `files.json` it sent is not the one that was checked.
 *
 * @param directory the staging directory
 * @param transport the destination
 * @returns the missing object names and the checked bytes' digest; or why `files.json` could not be read or
 * the destination listed
 */
export async function stagedFilesMissing({
  directory,
  transport,
}: {
  directory: string;
  transport: BackupTransport;
}): Promise<Result<{ missing: readonly string[]; sha256: string }>> {
  const path = join(directory, FILES_MANIFEST);
  let value: unknown;
  let sha256: string;
  try {
    const bytes = readFileSync(path);
    sha256 = createHash("sha256").update(bytes).digest("hex");
    value = safeJsonParse({ label: path, text: bytes.toString("utf8") });
  } catch (cause: unknown) {
    return err([`${path} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`]);
  }
  const parsed = parseFilesManifest({ value });
  if (parsed.isErr()) {
    return err(backupErrorLines({ error: parsed.error }));
  }
  const missing = await filesObjectsMissing({ files: parsed.value.files, transport });
  return missing.map((names) => ({ missing: names, sha256 }));
}

/**
 * Every object `files` names that the destination lacks: a whole file's blob at the wrong length or absent, and each
 * chunk a chunked file's list names that its encoding's prefix does not hold. One listing per prefix.
 *
 * @param files the entries a staging's `files.json` names
 * @param transport the destination
 * @returns the missing object names, sorted and each once; or why the destination could not be listed
 */
export async function filesObjectsMissing({
  files,
  transport,
}: {
  files: readonly ManifestFile[];
  transport: BackupTransport;
}): Promise<Result<readonly string[]>> {
  const whole = await blobsMissing({ files: files.filter((file) => file.chunked === null), transport });
  if (whole.isErr()) {
    return err(whole.error);
  }
  const chunked = await chunksMissing({ files, transport });
  if (chunked.isErr()) {
    return err(chunked.error);
  }
  return ok([...new Set([...whole.value, ...chunked.value])].toSorted());
}

/**
 * The blobs of whole files the destination lacks, each entry checked against its OWN length: a digest held at one
 * entry's length is not held for another's.
 *
 * @param files entries stored as one blob each
 * @param transport the destination
 * @returns the missing blob names, or why the blob prefix could not be listed
 */
async function blobsMissing({
  files,
  transport,
}: {
  files: readonly ManifestFile[];
  transport: BackupTransport;
}): Promise<Result<readonly string[]>> {
  if (files.length === 0) {
    return ok([]);
  }
  const project = SUPABASE_PROJECT_ID;
  const sizes = await transport.objectSizes({ prefix: blobPrefix({ project }) });
  if (sizes.isErr()) {
    return err([sizes.error.message]);
  }
  return ok(
    files
      .map((file) => blobObjectName({ project, sha256: file.sha256 }))
      .filter((name, index) => sizes.value.get(name) !== files[index]!.bytes),
  );
}

/**
 * The chunks chunked files name that their encoding's prefix lacks, from one listing per encoding.
 *
 * @param files every entry; the ones not chunked are skipped
 * @param transport the destination
 * @returns the missing chunk names, or why a chunk prefix could not be listed
 */
async function chunksMissing({
  files,
  transport,
}: {
  files: readonly ManifestFile[];
  transport: BackupTransport;
}): Promise<Result<readonly string[]>> {
  const project = SUPABASE_PROJECT_ID;
  const missing: string[] = [];
  for (const encoding of CHUNK_ENCODINGS) {
    const contents = files.flatMap((file) => (file.chunked?.encoding === encoding ? [file.chunked] : []));
    if (contents.length === 0) {
      continue;
    }
    const stored = await chunkInventory({ encoding, project, transport });
    if (stored.isErr()) {
      return err(stored.error);
    }
    for (const content of contents) {
      missing.push(
        ...missingChunks({ content, project, stored: stored.value }).map((chunk) =>
          chunkObjectName({ encoding, project, sha256: chunk.sha256 }),
        ),
      );
    }
  }
  return ok(missing);
}
