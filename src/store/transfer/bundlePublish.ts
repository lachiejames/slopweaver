/**
 * Publishing a store export: gathered contents written into a new private directory that either appears
 * whole or not at all.
 *
 * Parts are written into a sibling staging directory (`0700`, files `0600` — a memory's evidence can quote a
 * private channel), then every part is re-read with the SAME reader `store import` uses, so an export the
 * import would refuse is never published. The manifest is written last from those measurements, and the
 * staging directory is renamed into place. A failure at any step removes the staging directory; the target
 * is never created, and an existing one is never touched.
 */
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, rmdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";
import { renameStagedFile, writeFileAtomic, writeFileAtomicStream } from "#lib/writeAtomic.js";

import type { OwnerDirectiveOverlay } from "../../judgement/ownerDirective.js";

import { measurePart, type PartReading } from "./bundleRead.js";
import type { PortableOwnerProfile } from "./decode.js";
import { type StoreTransferError, StoreTransferErrors } from "./errors.js";
import type { StoreExportManifest, StoreExportPartEntry } from "./manifest.js";
import {
  STORE_EXPORT_KIND,
  STORE_EXPORT_MANIFEST_FILE,
  STORE_EXPORT_MANIFEST_VERSION,
  STORE_EXPORT_PARTS,
  type StoreExportPartKind,
} from "./parts.js";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** Every part's content, already shaped as the lines or the document its file holds. */
export interface StoreExportContents {
  readonly memoryLines: readonly string[];
  readonly recallLines: readonly string[];
  readonly owner: PortableOwnerProfile | null;
  readonly voiceLines: readonly string[];
  readonly directives: OwnerDirectiveOverlay;
  readonly standingAskLines: readonly string[];
  /** One v2 envelope per stored steer measurement (`../../profile/steerMeasurementTransfer.ts`). */
  readonly steerMeasurementLines: readonly string[];
}

/** What a finished export wrote. */
export interface StoreExportWritten {
  readonly out: string;
  readonly manifest: StoreExportManifest;
  readonly parts: readonly PartReading[];
}

/**
 * Whether anything is at a path, links included.
 *
 * @returns `true` when `lstat` finds an entry, `false` only on `ENOENT`; any other failure throws
 */
function pathExists({ path }: { path: string }): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return false;
    }
    throw cause;
  }
}

/** One part file, a line at a time. */
function writeLines({ path, lines }: { path: string; lines: Iterable<string> }): void {
  writeFileAtomicStream({
    dirMode: DIR_MODE,
    fileMode: FILE_MODE,
    path,
    produce: ({ write }) => {
      for (const line of lines) {
        write({ text: `${line}\n` });
      }
    },
  });
}

/** One JSON part file. */
function writeDocument({ path, value, label }: { path: string; value: unknown; label: string }): void {
  writeFileAtomic({
    contents: `${safeJsonStringify({ label, space: 2, value })}\n`,
    dirMode: DIR_MODE,
    fileMode: FILE_MODE,
    path,
  });
}

/** The file a part lives at inside a directory. */
function partPath({ dir, kind }: { dir: string; kind: StoreExportPartKind }): string {
  const spec = STORE_EXPORT_PARTS.find((one) => one.kind === kind)!;
  return join(dir, spec.file);
}

/** Every part measured back off the staging directory, as the manifest's entries and the report's rows. */
function measureStaged({
  staging,
}: {
  staging: string;
}): Result<
  { readonly entries: readonly StoreExportPartEntry[]; readonly parts: readonly PartReading[] },
  StoreTransferError
> {
  const entries: StoreExportPartEntry[] = [];
  const parts: PartReading[] = [];
  for (const spec of STORE_EXPORT_PARTS) {
    const schemaVersion = spec.exportSchemaVersion;
    const measured = measurePart({ kind: spec.kind, path: join(staging, spec.file), schemaVersion });
    if (measured.isErr()) {
      return err(measured.error);
    }
    entries.push({
      kind: spec.kind,
      mediaType: spec.mediaType,
      path: spec.file,
      schemaVersion,
      ...measured.value.measure,
    });
    parts.push({ kind: spec.kind, status: "read", ...measured.value.measure });
  }
  return ok({ entries, parts });
}

/** Every part's file written into the staging directory. */
function writeParts({ staging, contents }: { staging: string; contents: StoreExportContents }): void {
  writeLines({ lines: contents.memoryLines, path: partPath({ dir: staging, kind: "memories" }) });
  writeLines({ lines: contents.recallLines, path: partPath({ dir: staging, kind: "memory-recalls" }) });
  writeDocument({
    label: "owner profile part",
    path: partPath({ dir: staging, kind: "owner-profile" }),
    value: contents.owner,
  });
  writeLines({ lines: contents.voiceLines, path: partPath({ dir: staging, kind: "owner-voice" }) });
  writeDocument({
    label: "owner directives part",
    path: partPath({ dir: staging, kind: "owner-directives" }),
    value: contents.directives,
  });
  writeLines({ lines: contents.standingAskLines, path: partPath({ dir: staging, kind: "standing-asks" }) });
  writeLines({ lines: contents.steerMeasurementLines, path: partPath({ dir: staging, kind: "steer-verdicts" }) });
}

/**
 * Write gathered contents as a store export in a new directory: staged privately, re-read with the import's
 * own reader, the manifest written last, then renamed into place.
 *
 * @param out the directory to create; refused if anything is already there
 * @param contents every part's content
 * @param producerVersion this build's version, recorded in the manifest
 * @param createdAtIso the instant recorded in the manifest
 * @returns what was written, or the first refusal — with nothing left behind
 */
export function writeStoreExport({
  out,
  contents,
  producerVersion,
  createdAtIso,
}: {
  out: string;
  contents: StoreExportContents;
  producerVersion: string;
  createdAtIso: string;
}): Result<StoreExportWritten, StoreTransferError> {
  if (pathExists({ path: out })) {
    return err(StoreTransferErrors.targetExists({ path: out }));
  }
  const staging = join(dirname(out), `.${basename(out)}.partial-${randomUUID()}`);
  try {
    mkdirSync(dirname(out), { mode: DIR_MODE, recursive: true });
    mkdirSync(staging, { mode: DIR_MODE });
    writeParts({ contents, staging });
  } catch (cause) {
    rmSync(staging, { force: true, recursive: true });
    return err(StoreTransferErrors.writeFailed({ cause, path: staging }));
  }
  const measured = measureStaged({ staging });
  if (measured.isErr()) {
    rmSync(staging, { force: true, recursive: true });
    return err(measured.error);
  }
  const manifest: StoreExportManifest = {
    createdAtIso,
    kind: STORE_EXPORT_KIND,
    parts: measured.value.entries,
    producer: { name: "slopweaver", version: producerVersion },
    schemaVersion: STORE_EXPORT_MANIFEST_VERSION,
  };
  try {
    writeDocument({ label: "store export manifest", path: join(staging, STORE_EXPORT_MANIFEST_FILE), value: manifest });
  } catch (cause) {
    rmSync(staging, { force: true, recursive: true });
    return err(StoreTransferErrors.writeFailed({ cause, path: staging }));
  }
  const published = publishStagedExport({ out, staging });
  if (published.isErr()) {
    rmSync(staging, { force: true, recursive: true });
    return err(published.error);
  }
  return ok({ manifest, out, parts: measured.value.parts });
}

/**
 * Move the finished staging directory to `out` without ever replacing anything there.
 *
 * A rename onto a path replaces an EMPTY directory standing at it, so an existence check before the rename
 * leaves a window in which one created meanwhile is silently replaced. `out` is therefore CLAIMED first with
 * an exclusive `mkdir`, which fails if anything is there, and the rename replaces only that empty claim. A
 * claim written into meanwhile makes the rename fail rather than replace it, and the claim is then removed
 * with `rmdir`, which removes only an empty directory. Killed between the claim and the rename, an empty
 * `out` is the one thing left behind, and the import refuses it: it holds no manifest. A process that
 * removes the claim and recreates it empty in the instant before the rename is not seen: Node has no
 * `RENAME_EXCL`, and only a process acting in `out`'s own parent directory can do it.
 *
 * @param out where the export is published
 * @param staging the finished private directory, left in place for the caller to remove on a refusal
 * @returns `true` once `out` is the staged export, or why nothing at `out` was touched
 */
export function publishStagedExport({
  out,
  staging,
}: {
  out: string;
  staging: string;
}): Result<true, StoreTransferError> {
  try {
    mkdirSync(out, { mode: DIR_MODE });
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "EEXIST") {
      return err(StoreTransferErrors.targetExists({ path: out }));
    }
    return err(StoreTransferErrors.writeFailed({ cause, path: out }));
  }
  try {
    // Every part is already fsynced; flushing `out`'s parent is what makes the publish survive a crash.
    renameStagedFile({ flushDirectory: true, from: staging, to: out });
  } catch (cause) {
    try {
      rmdirSync(out);
    } catch {
      // not empty, or already gone: either way it is not ours to remove
    }
    return err(StoreTransferErrors.writeFailed({ cause, path: out }));
  }
  return ok(true);
}

/**
 * Keep a just-published export only if the checks run after publishing still hold: an old build's journal append
 * landing after the snapshot's own checks is missing from the export, so a refusal removes the directory this run
 * published — `writeStoreExport` never publishes over anything, so nothing else stands at `out`.
 *
 * @param out the directory `writeStoreExport` published
 * @param recheck the witnessed registers' checks, run after publishing
 * @returns nothing once the export stands, or the refusal with the export removed
 */
export function settlePublishedExport({
  out,
  recheck,
}: {
  out: string;
  recheck: Result<undefined, StoreTransferError>;
}): Result<undefined, StoreTransferError> {
  if (recheck.isErr()) {
    rmSync(out, { force: true, recursive: true });
  }
  return recheck;
}
