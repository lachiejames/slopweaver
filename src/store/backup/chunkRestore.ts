/**
 * Rebuilding a chunked file from the destination — the inverse of `./chunkUpload.ts`, one chunk at a time.
 *
 * Each chunk is downloaded, decoded and checked against the length and digest the manifest recorded before a
 * byte of it is written, and the file is assembled beside its target and renamed into place only once every
 * chunk has landed — so a restore cut short leaves no half-file under the real name. The caller still checks
 * the WHOLE file against the manifest afterwards, exactly as it does a file that was one blob: no object is
 * trusted because it decoded.
 *
 * {@link fetchDump} is the one caller-facing choice this module makes: a version-2 manifest's dump is
 * rebuilt from its chunks, and a version-1 one is downloaded whole, exactly as it was sent.
 */
import { closeSync, fsyncSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import { renameStagedFile } from "#lib/writeAtomic.js";

import { ChunkErrors } from "./chunkErrors.js";
import { type ChunkedContent, chunkedContentSchema, chunkObjectName } from "./chunkPlan.js";
import { decodeChunk } from "./chunks.js";
import { backupErrorLines } from "./errors.js";
import { BACKUP_FILES, SUPABASE_PROJECT_ID } from "./plan.js";
import { digestFile, readSmallFile } from "./stack.js";
import type { BackupTransport } from "./transport.js";

/**
 * The dump fields of a downloaded manifest {@link fetchDump} reads — its length and digest, and its chunk list,
 * which a version-1 manifest has none of, and means `null`.
 */
const dumpChunksSchema = z.object({
  dump: z.object({
    bytes: z.number().int().nonnegative(),
    chunked: chunkedContentSchema.nullable().default(null),
    sha256: z.string(),
  }),
});

/**
 * Write every byte of `data` to an open file.
 *
 * @param descriptor the open file
 * @param data what to write
 */
function writeAll({ descriptor, data }: { descriptor: number; data: Buffer }): void {
  let written = 0;
  while (written < data.length) {
    written += writeSync(descriptor, data, written, data.length - written);
  }
}

/**
 * Rebuild one chunked file at `target` from the chunks its content names.
 *
 * @param content the file's chunk list, from its manifest
 * @param target where the rebuilt file goes; replaced only when every chunk landed
 * @param scratch a directory each chunk is downloaded into before it is decoded
 * @param project the Supabase project id the chunk names are built under
 * @param transport the destination
 * @returns nothing, or the first reason the file could not be rebuilt
 */
export async function rebuildChunkedFile({
  content,
  target,
  scratch,
  project,
  transport,
}: {
  content: ChunkedContent;
  target: string;
  scratch: string;
  project: string;
  transport: BackupTransport;
}): Promise<Result<void>> {
  const partial = `${target}.partial`;
  const downloaded = join(scratch, "chunk.download");
  let descriptor: number | null = null;
  try {
    // Whatever already sits at the partial path is removed and the file is created EXCLUSIVELY, so a link left
    // there is never followed into another file.
    rmSync(partial, { force: true });
    descriptor = openSync(partial, "wx", 0o600);
    for (const chunk of content.chunks) {
      const objectName = chunkObjectName({ encoding: content.encoding, project, sha256: chunk.sha256 });
      const fetched = await transport.download({ objectName, path: downloaded });
      if (fetched.isErr()) {
        return err([fetched.error.message]);
      }
      const raw = decodeChunk({ chunk, encoding: content.encoding, objectName, stored: readFileSync(downloaded) });
      if (raw.isErr()) {
        return err([raw.error.message]);
      }
      writeAll({ data: raw.value, descriptor });
    }
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameStagedFile({ flushDirectory: true, from: partial, to: target });
    return ok(undefined);
  } catch (cause: unknown) {
    return err([ChunkErrors.rebuildFailed({ cause, path: target }).message]);
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor);
    }
    // The partial first: it sits beside the real name, so no failure removing the scratch copy may skip it.
    rmSync(partial, { force: true });
    rmSync(downloaded, { force: true });
  }
}

/**
 * Put one backup's dump beside its downloaded manifest: rebuilt from its chunks when the manifest lists them,
 * downloaded whole when it does not. A rebuilt dump is checked against the manifest's length and digest here, and
 * removed when it misses; the caller still verifies the result against the manifest either way.
 *
 * @param directory where the manifest was downloaded, and where the dump goes
 * @param prefix the backup's object prefix, which a whole dump lives under
 * @param transport the destination
 * @returns nothing, or why the dump could not be fetched
 */
export async function fetchDump({
  directory,
  prefix,
  transport,
}: {
  directory: string;
  prefix: string;
  transport: BackupTransport;
}): Promise<Result<void>> {
  const text = readSmallFile({ path: join(directory, BACKUP_FILES.manifest) });
  if (text.isErr()) {
    return err(backupErrorLines({ error: text.error }));
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(text.value);
  } catch {
    return err([`${BACKUP_FILES.manifest} in ${directory} is not JSON`]);
  }
  const parsed = dumpChunksSchema.safeParse(decoded);
  if (!parsed.success) {
    return err([`${BACKUP_FILES.manifest} in ${directory} names no readable dump: ${parsed.error.message}`]);
  }
  const target = join(directory, BACKUP_FILES.dump);
  // The retrieval directory is reused per prefix, so a dump an earlier restore left there is removed first:
  // a fetch that fails below must leave nothing at the path, not the last run's file.
  rmSync(target, { force: true });
  const chunked = parsed.data.dump.chunked;
  if (chunked === null) {
    const downloaded = await transport.download({ objectName: `${prefix}${BACKUP_FILES.dump}`, path: target });
    if (downloaded.isErr()) {
      rmSync(target, { force: true });
      return err([downloaded.error.message]);
    }
    return ok(undefined);
  }
  const rebuilt = await rebuildChunkedFile({
    content: chunked,
    project: SUPABASE_PROJECT_ID,
    scratch: directory,
    target,
    transport,
  });
  if (rebuilt.isErr()) {
    return rebuilt;
  }
  return removeUnlessRecorded({ recorded: parsed.data.dump, target });
}

/**
 * Keep a rebuilt dump only when it is the length and digest its manifest recorded. Every chunk verified is not the
 * whole dump verified — a chunk list short of the dump still rebuilds — so one that misses is removed rather than
 * left at its path, as `restoreFiles` does for a file.
 *
 * @param recorded the length and digest the manifest gives the dump
 * @param target the rebuilt dump
 * @returns nothing, or why the dump was removed
 */
function removeUnlessRecorded({
  recorded,
  target,
}: {
  recorded: { bytes: number; sha256: string };
  target: string;
}): Result<void> {
  const digested = digestFile({ path: target });
  if (digested.isErr()) {
    rmSync(target, { force: true });
    return err(backupErrorLines({ error: digested.error }));
  }
  const { bytes, sha256 } = recorded;
  if (digested.value.bytes !== bytes || digested.value.sha256 !== sha256) {
    rmSync(target, { force: true });
    return err([
      `${BACKUP_FILES.dump} rebuilt from its chunks is ${String(digested.value.bytes)} byte(s) sha256 ` +
        `${digested.value.sha256.slice(0, 12)}…, the manifest says ${String(bytes)} byte(s) sha256 ` +
        `${sha256.slice(0, 12)}… — removed rather than left at its path`,
    ]);
  }
  return ok(undefined);
}
