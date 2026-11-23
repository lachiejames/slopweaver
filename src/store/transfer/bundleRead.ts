/**
 * Reading a store export from disk: every part measured and decoded in ONE pass over ONE open file.
 *
 * The bytes that are hashed are the bytes that are decoded. A reader that hashed a file and then opened it
 * again to parse it would let a swap between the two reads pass a forged part under a genuine hash, so each
 * part is opened once — `lstat` first so a symlink or a FIFO is refused before any open, then `O_NOFOLLOW`
 * at the open itself — and its lines are hashed, counted and fed to the part's decoder as they stream.
 *
 * The hash is rebuilt from the lines the reader hands back rather than taken off the raw chunks, which is
 * exact only while every line round-trips through strict UTF-8: so a line whose re-encoding differs from the
 * bytes it came from in length (an undecodable sequence, which the reader hands back as a placeholder)
 * refuses the part rather than hashing something the file does not hold. Effectful at the filesystem edge
 * only; nothing is written.
 */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, type Stats } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";

import { readJsonlLines } from "../../corpus/corpusStore.js";

import { partDecoder } from "./decode.js";
import { type StoreTransferError, StoreTransferErrors } from "./errors.js";
import { checkPartAgainstEntry, parseStoreExportManifest, type StoreExportManifest } from "./manifest.js";
import { STORE_EXPORT_MANIFEST_FILE, STORE_EXPORT_PARTS, type StoreExportPartKind } from "./parts.js";
import type { StagedEntry } from "./retained.js";

/**
 * What one part measured as.
 *
 * @internal reached as {@link MeasuredPart.measure}, never named outside this file
 */
export interface PartMeasure {
  readonly rows: number;
  readonly bytes: number;
  readonly sha256: string;
}

/** One part as a read found it: measured and decoded, or — in an unmanifested directory only — not there. */
export type PartReading =
  | ({ readonly kind: StoreExportPartKind; readonly status: "read" } & PartMeasure)
  | { readonly kind: StoreExportPartKind; readonly status: "unavailable" };

/** One part's measure, and the logical entries its decoder kept — held apart, so a report never prints them. */
export interface MeasuredPart {
  readonly measure: PartMeasure;
  readonly retained: readonly StagedEntry[];
}

/** A whole export as a read found it. `retained` holds an entry list for every part that was read. */
export interface BundleReading {
  readonly dir: string;
  readonly manifest: StoreExportManifest | null;
  readonly parts: readonly PartReading[];
  readonly retained: ReadonlyMap<StoreExportPartKind, readonly StagedEntry[]>;
}

/** `lstat`, or `null` when nothing is at the path. */
function lstatOrNull({ path }: { path: string }): Stats | null {
  try {
    return lstatSync(path);
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return null;
    }
    throw cause;
  }
}

/**
 * A file's identity right now: inode, size and both change times, or the error reading it gave. Any append,
 * rewrite or replacement moves at least one of them, so two equal fingerprints bracket a read nothing changed
 * under, and an absent file fingerprints as its `ENOENT`, so one appearing mid-read moves too.
 *
 * @param path the file to fingerprint, never followed if it is a link
 * @returns `ino:size:mtimeNs:ctimeNs`, or `error:<code>`
 */
export function fileFingerprint({ path }: { path: string }): string {
  try {
    const stat = lstatSync(path, { bigint: true });
    return `${String(stat.ino)}:${String(stat.size)}:${String(stat.mtimeNs)}:${String(stat.ctimeNs)}`;
  } catch (cause) {
    return cause instanceof Error && "code" in cause ? `error:${String(cause.code)}` : "error";
  }
}

/** A part's path refused before any open unless `lstat` finds a regular file there, never a link or a FIFO. */
function refuseUnlessRegularFile({
  kind,
  path,
}: {
  kind: StoreExportPartKind;
  path: string;
}): Result<void, StoreTransferError> {
  let found: Stats | null;
  try {
    found = lstatOrNull({ path });
  } catch (cause) {
    return err(StoreTransferErrors.partUnreadable({ cause, part: kind, path }));
  }
  if (found === null || !found.isFile()) {
    const cause = found === null ? "no such file" : "not a regular file";
    return err(StoreTransferErrors.partUnreadable({ cause, part: kind, path }));
  }
  return ok(undefined);
}

/**
 * One line's bytes, when the line is the plain UTF-8 the file holds. The strict reader hands back a placeholder for
 * a line that is not UTF-8, and three invalid bytes are the placeholder's own length, so it is refused by the
 * reader's `undecodable` flag, never by its text or length: hashing it would hash text the file does not hold, and a
 * line that really is one U+FFFD is a line a v1 part may carry.
 *
 * @param byteLength how many bytes the file held for the line
 * @param undecodable whether the strict reader found a byte that is not UTF-8 and delivered its placeholder
 * @returns the line's bytes, or undefined when they are not the file's
 */
function plainUtf8Line({
  line,
  byteLength,
  undecodable,
}: {
  line: string;
  byteLength: number;
  undecodable: boolean;
}): Buffer | undefined {
  const encoded = Buffer.from(line, "utf8");
  if (undecodable || encoded.length !== byteLength) {
    return undefined;
  }
  return encoded;
}

/**
 * Measure and decode one part's file, which must be a regular file and not a link to one.
 *
 * @param kind which part the file holds, so its own domain's decoder judges it
 * @param path the part's file
 * @param schemaVersion the part's version as a manifest names it, or `null` for an unmanifested part
 * @returns its rows, bytes and hash with the entries it decoded to, or the first way it is not a readable,
 * decodable part
 */
export function measurePart({
  kind,
  path,
  schemaVersion,
}: {
  kind: StoreExportPartKind;
  path: string;
  schemaVersion: number | null;
}): Result<MeasuredPart, StoreTransferError> {
  const regular = refuseUnlessRegularFile({ kind, path });
  if (regular.isErr()) {
    return err(regular.error);
  }
  const decoder = partDecoder({ kind, schemaVersion });
  const hash = createHash("sha256");
  let bytes = 0;
  let lines = 0;
  // A holder rather than a `let`: the callbacks assign it, and flow analysis would read a `let` as still null.
  const seen: { failure: StoreTransferError | null } = { failure: null };
  try {
    readJsonlLines({
      noFollow: true,
      onChunk: () => seen.failure === null,
      onLine: ({ line, index, byteLength, undecodable }) => {
        if (seen.failure !== null) {
          return;
        }
        const encoded = plainUtf8Line({ byteLength, line, undecodable });
        if (encoded === undefined) {
          const why = `line ${String(index + 1)} is not plain UTF-8`;
          seen.failure = StoreTransferErrors.partUndecodable({ part: kind, why });
          return;
        }
        if (lines > 0) {
          hash.update("\n");
          bytes += 1;
        }
        hash.update(encoded);
        bytes += byteLength;
        lines += 1;
        const fed = decoder.line({ number: index + 1, text: line });
        if (fed.isErr()) {
          seen.failure = fed.error;
        }
      },
      path,
      strictUtf8: true,
    });
  } catch (cause) {
    return err(StoreTransferErrors.partUnreadable({ cause, part: kind, path }));
  }
  if (seen.failure !== null) {
    return err(seen.failure);
  }
  return decoder
    .finish()
    .map(({ rows, retained }) => ({ measure: { bytes, rows, sha256: hash.digest("hex") }, retained }));
}

/** The manifest, read through a descriptor that refuses a link, then parsed. */
function readManifest({ path }: { path: string }): Result<StoreExportManifest, StoreTransferError> {
  let text: string;
  try {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!fstatSync(fd).isFile()) {
        return err(StoreTransferErrors.manifestInvalid({ why: "manifest.json is not a regular file" }));
      }
      text = readFileSync(fd, "utf8");
    } finally {
      closeSync(fd);
    }
  } catch (cause) {
    const why = `manifest.json would not read: ${cause instanceof Error ? cause.message : String(cause)}`;
    return err(StoreTransferErrors.manifestInvalid({ why }));
  }
  let value: unknown;
  try {
    value = safeJsonParse({ label: "store export manifest", text });
  } catch {
    return err(StoreTransferErrors.manifestInvalid({ why: "manifest.json is not JSON" }));
  }
  return parseStoreExportManifest({ value });
}

/** A directory's identity, `dev:ino`, or `null` when nothing at the path is a directory. */
function directoryIdentity({ path }: { path: string }): string | null {
  const found = lstatOrNull({ path });
  if (found === null || !found.isDirectory()) {
    return null;
  }
  return `${String(found.dev)}:${String(found.ino)}`;
}

/**
 * Read a whole export: against its manifest's promises, or — with `unmanifested` — as a directory with none,
 * whose missing parts are reported unavailable rather than empty.
 *
 * The directory is resolved to its real path once and every file is opened beneath that. The directory's
 * identity and every file the read may open are fingerprinted before the read and again after it, so a
 * directory or a part replaced, rewritten or created mid-read is refused, never reported as what was named.
 * A replacement undone before the end goes unseen — Node opens by path, with no `openat`.
 *
 * @param dir the export's directory
 * @param unmanifested the caller says this directory predates manifests; refused if it has one
 * @returns every part's reading in registry order, or the first refusal
 */
export function readExportBundle({
  dir,
  unmanifested,
}: {
  dir: string;
  unmanifested: boolean;
}): Result<BundleReading, StoreTransferError> {
  let real: string;
  let before: string | null;
  try {
    real = realpathSync(dir);
    before = directoryIdentity({ path: real });
  } catch (cause) {
    return err(StoreTransferErrors.sourceUnreadable({ cause, what: dir }));
  }
  if (before === null) {
    return err(StoreTransferErrors.sourceUnreadable({ cause: "not a directory", what: dir }));
  }
  const watched = [STORE_EXPORT_MANIFEST_FILE, ...STORE_EXPORT_PARTS.map((spec) => spec.file)].map((file) =>
    join(real, file),
  );
  const files = watched.map((path) => fileFingerprint({ path }));
  const read = readResolved({ dir: real, unmanifested });
  let after: string | null;
  try {
    after = directoryIdentity({ path: real });
  } catch {
    after = null;
  }
  if (after !== before) {
    return err(StoreTransferErrors.sourceMoved({ path: dir }));
  }
  const moved = watched.find((path, at) => fileFingerprint({ path }) !== files[at]);
  if (moved !== undefined) {
    return err(StoreTransferErrors.sourceMoved({ path: moved }));
  }
  return read.map((reading) => ({ ...reading, dir }));
}

/** The manifested-or-not decision and the read, beneath a directory already resolved to its real path. */
function readResolved({
  dir,
  unmanifested,
}: {
  dir: string;
  unmanifested: boolean;
}): Result<BundleReading, StoreTransferError> {
  const manifestPath = join(dir, STORE_EXPORT_MANIFEST_FILE);
  let hasManifest: boolean;
  try {
    hasManifest = lstatOrNull({ path: manifestPath }) !== null;
  } catch (cause) {
    return err(StoreTransferErrors.sourceUnreadable({ cause, what: manifestPath }));
  }
  if (unmanifested && hasManifest) {
    return err(StoreTransferErrors.manifestPresent({ dir }));
  }
  if (!unmanifested && !hasManifest) {
    return err(StoreTransferErrors.manifestAbsent({ dir }));
  }
  return unmanifested ? readUnmanifested({ dir }) : readManifested({ dir, manifestPath });
}

/** Every part, each held to its manifest entry. */
function readManifested({
  dir,
  manifestPath,
}: {
  dir: string;
  manifestPath: string;
}): Result<BundleReading, StoreTransferError> {
  const manifest = readManifest({ path: manifestPath });
  if (manifest.isErr()) {
    return err(manifest.error);
  }
  const parts: PartReading[] = [];
  const retained = new Map<StoreExportPartKind, readonly StagedEntry[]>();
  for (const entry of manifest.value.parts) {
    const measured = measurePart({ kind: entry.kind, path: join(dir, entry.path), schemaVersion: entry.schemaVersion });
    if (measured.isErr()) {
      return err(measured.error);
    }
    const checked = checkPartAgainstEntry({ entry, measured: measured.value.measure });
    if (checked.isErr()) {
      return err(checked.error);
    }
    parts.push({ kind: entry.kind, status: "read", ...measured.value.measure });
    retained.set(entry.kind, measured.value.retained);
  }
  return ok({ dir, manifest: manifest.value, parts, retained });
}

/** Every part whose file is present, read at the registry's own name and nowhere else. */
function readUnmanifested({ dir }: { dir: string }): Result<BundleReading, StoreTransferError> {
  const parts: PartReading[] = [];
  const retained = new Map<StoreExportPartKind, readonly StagedEntry[]>();
  for (const spec of STORE_EXPORT_PARTS) {
    const path = join(dir, spec.file);
    let present: boolean;
    try {
      present = lstatOrNull({ path }) !== null;
    } catch (cause) {
      return err(StoreTransferErrors.partUnreadable({ cause, part: spec.kind, path }));
    }
    if (!present) {
      parts.push({ kind: spec.kind, status: "unavailable" });
      continue;
    }
    // No manifest names a version: a part this build reads one way is read that way, and the steer lines each say
    // which version they are.
    const only = spec.readableSchemaVersions.length === 1 ? spec.readableSchemaVersions[0]! : null;
    const measured = measurePart({ kind: spec.kind, path, schemaVersion: only });
    if (measured.isErr()) {
      return err(measured.error);
    }
    parts.push({ kind: spec.kind, status: "read", ...measured.value.measure });
    retained.set(spec.kind, measured.value.retained);
  }
  if (parts.every((part) => part.status === "unavailable")) {
    return err(StoreTransferErrors.nothingRecognised({ dir }));
  }
  return ok({ dir, manifest: null, parts, retained });
}

/**
 * One hash over what every part holds, so two readings of the same content — an export and its copy, or the
 * same state exported twice — can be compared in one line. Absent parts count, as absent: an export missing
 * its voice register is not the same content as one holding an empty one.
 *
 * @param parts every part's reading, in registry order
 * @returns `sha256:` and the hex digest
 */
export function contentDigest({ parts }: { parts: readonly PartReading[] }): string {
  const hash = createHash("sha256");
  parts.forEach((part) => {
    const held = part.status === "read" ? `${part.sha256} ${String(part.rows)}` : "unavailable";
    hash.update(`${part.kind} ${held}\n`);
  });
  return `sha256:${hash.digest("hex")}`;
}
