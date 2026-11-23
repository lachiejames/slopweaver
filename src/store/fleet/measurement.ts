/**
 * One measurement file as the rows `measurement_blob` and `measurement_location` take, and the Storage object
 * its bytes become when they are not inline. Pure: bytes and a path in, rows or a named refusal out.
 *
 * The table header (`../schema/measurement.ts`) says why a body is keyed by its hash and a path is a row of
 * its own. What this module adds is PLACEMENT, and the one rule about it: it is decided by the BYTES, first by
 * size and only then by whether they decode — never by the file's extension. MEASURED, the
 * `answer-q2-safety-prompt-alarm-union-rerank.json` reply in `bakeoff/lap1/replies/` and its copy under
 * `bakeoff/lap1-before-shard-regen/` are not UTF-8 (repro: `iconv -f utf-8 -t utf-8 <file>` exits non-zero),
 * so a rule keyed on `.json` would have refused a file the store can perfectly well hold as an object.
 */
import { createHash } from "node:crypto";
import { isAbsolute, join, posix } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import {
  MEASUREMENT_CLASSES,
  type NewMeasurementBlobRecord,
  type NewMeasurementLocationRecord,
} from "../schema/measurement.js";

import {
  type FleetImportError,
  FleetImportErrors,
  type UnknownMeasurementClassError,
  type UnstorableMeasurementError,
} from "./errors.js";
import { decodeExactly } from "./exactText.js";

/** One of the four roots. */
export type MeasurementClass = (typeof MEASUREMENT_CLASSES)[number];

/**
 * Each class's root, relative to the state home. Display and matching strings, never joined onto a home:
 * `stateHomePaths()` owns the absolute paths, and `unit/store/fleet/measurement.test.ts` holds these equal to
 * what that contract resolves, so the two cannot drift apart.
 */
export const MEASUREMENT_ROOT_PREFIXES: Readonly<Record<MeasurementClass, string>> = {
  bakeoff: "bakeoff",
  "datadog-shots": "datadog-shots",
  evidence: "evidence",
  proof: "proof",
};

/**
 * The largest body stored inline as text; anything bigger is an object in Storage whatever it holds.
 *
 * Checked BEFORE a byte is decoded, so no file larger than this is ever turned into a JS string
 * (`.claude/rules/typescript-patterns.md`, "never let a data-sized payload through one JS string"). MEASURED,
 * the largest file under the four roots is 2,757,706 bytes (repro: `cd ~/.slopweaver && find
 * bakeoff datadog-shots evidence proof -type f -print0 | xargs -0 stat -f '%z %N' | sort -n | tail -1`), so
 * today every text file is inline and the cap is headroom, not a limit anything meets.
 */
export const INLINE_BODY_MAX_BYTES = 8 * 1024 * 1024;

/** The Storage bucket a `storage` body's bytes live in, private, each object keyed by its body's sha-256. */
export const MEASUREMENT_BUCKET = "measurements";

/** Filenames a walk never reads: Finder's folder-view state, written by the OS rather than by the fleet. */
const SKIPPED_NAMES: ReadonlySet<string> = new Set([".DS_Store"]);

/** The media types a reader is told, by extension. Anything else is `application/octet-stream`. */
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  csv: "text/csv",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  jsonl: "application/x-ndjson",
  log: "text/plain",
  md: "text/markdown",
  mjs: "text/javascript",
  mts: "text/typescript",
  patch: "text/x-diff",
  pdf: "application/pdf",
  png: "image/png",
  py: "text/x-python",
  ts: "text/typescript",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  webp: "image/webp",
};

/** The bytes one `storage` body puts into the bucket. */
export interface MeasurementUpload {
  /** The object key, which is the body's sha-256. */
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

/** A file projected into its body row, its location row and — when not inline — its upload. */
export interface ProjectedMeasurement {
  readonly blob: NewMeasurementBlobRecord;
  readonly location: NewMeasurementLocationRecord;
  readonly upload: MeasurementUpload | undefined;
}

/** Every file's rows, bodies and uploads deduplicated. */
export interface FoldedMeasurements {
  readonly blobs: readonly NewMeasurementBlobRecord[];
  readonly locations: readonly NewMeasurementLocationRecord[];
  readonly uploads: readonly MeasurementUpload[];
}

/**
 * Whether a filename is one the walk never reads.
 *
 * @param fileName a bare filename, no directory
 * @returns `true` for an OS-written file such as `.DS_Store`
 */
export function isSkippedMeasurementName({ fileName }: { fileName: string }): boolean {
  return SKIPPED_NAMES.has(fileName);
}

/**
 * A `--class` word as a class, refusing one the table has no row for.
 *
 * @param value the word as typed
 * @returns the class, or the refusal naming the four it may be
 */
export function parseMeasurementClass({
  value,
}: {
  value: string;
}): Result<MeasurementClass, UnknownMeasurementClassError> {
  const found = MEASUREMENT_CLASSES.find((candidate) => candidate === value);
  if (found === undefined) {
    return err(FleetImportErrors.unknownMeasurementClass({ known: MEASUREMENT_CLASSES, value }));
  }
  return ok(found);
}

/**
 * Which class a home-relative path belongs to.
 *
 * @param relativePath the file's path under the home, `/`-separated
 * @returns the class, or `undefined` when the path is not under one of the four roots or carries a `..`
 */
export function measurementClassOf({ relativePath }: { relativePath: string }): MeasurementClass | undefined {
  const segments = relativePath.split("/");
  if (segments.length < 2 || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return undefined;
  }
  return MEASUREMENT_CLASSES.find((candidate) => MEASUREMENT_ROOT_PREFIXES[candidate] === segments[0]);
}

/**
 * The media type a reader is told, by the file's extension.
 *
 * @param relativePath the file's path under the home
 * @returns the media type, or `application/octet-stream` for an extension the map does not name
 */
export function mediaTypeOf({ relativePath }: { relativePath: string }): string {
  const fileName = relativePath.split("/").at(-1)!;
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) {
    return "application/octet-stream";
  }
  const known = MEDIA_TYPES[fileName.slice(dot + 1).toLowerCase()];
  if (known === undefined) {
    return "application/octet-stream";
  }
  return known;
}

/**
 * Project one file's exact bytes into its rows and, when its bytes cannot be inline text, its upload.
 *
 * @param bytes the file exactly as read — hashed as given, never trimmed
 * @param relativePath where it sat under the home, `/`-separated; names the file in any refusal
 * @param fileModifiedAt the file's mtime
 * @returns the rows and upload, or the refusal for a path outside the four roots
 */
export function projectMeasurementFile({
  bytes,
  relativePath,
  fileModifiedAt,
}: {
  bytes: Uint8Array;
  relativePath: string;
  fileModifiedAt: Date;
}): Result<ProjectedMeasurement, FleetImportError> {
  const measurementClass = measurementClassOf({ relativePath });
  if (measurementClass === undefined) {
    return err(
      FleetImportErrors.unstorableMeasurement({
        path: relativePath,
        reason: `not under ${MEASUREMENT_CLASSES.map((c) => `${MEASUREMENT_ROOT_PREFIXES[c]}/`).join(", ")}`,
      }),
    );
  }
  const bodySha256 = createHash("sha256").update(bytes).digest("hex");
  const mediaType = mediaTypeOf({ relativePath });
  const location = { bodySha256, fileModifiedAt, measurementClass, relativePath };
  const text = inlineText({ bytes });
  if (text !== undefined) {
    return ok({
      blob: { body: text, bodySha256, byteLength: bytes.length, mediaType, placement: "inline" },
      location,
      upload: undefined,
    });
  }
  return ok({
    blob: { body: null, bodySha256, byteLength: bytes.length, mediaType, placement: "storage" },
    location,
    upload: { bytes, contentType: mediaType, key: bodySha256 },
  });
}

/**
 * The bytes as text a Postgres `text` column holds exactly, or `undefined` when they belong in Storage.
 *
 * Size first, so a file past the cap is never decoded at all; then an exact round trip; then no NUL, which
 * `text` refuses.
 *
 * @param bytes the file's contents
 * @returns the text, or `undefined`
 */
function inlineText({ bytes }: { bytes: Uint8Array }): string | undefined {
  if (bytes.length > INLINE_BODY_MAX_BYTES) {
    return undefined;
  }
  const text = decodeExactly({ bytes });
  if (text === undefined || text.includes("\u0000")) {
    return undefined;
  }
  return text;
}

/**
 * Fold projected files into one write: each body and upload once, every location kept.
 *
 * Takes an ITERABLE so the leg can hand it a generator reading one file at a time, holding only distinct
 * bodies resident — the same reason `./ownerTurn.ts`'s `foldOwnerTurns` gives.
 *
 * @param projected every file's rows, in walk order
 * @returns the distinct bodies, their uploads, and every location
 */
export function foldMeasurements({ projected }: { projected: Iterable<ProjectedMeasurement> }): FoldedMeasurements {
  const blobs = new Map<string, NewMeasurementBlobRecord>();
  const uploads = new Map<string, MeasurementUpload>();
  const locations: NewMeasurementLocationRecord[] = [];
  for (const file of projected) {
    if (!blobs.has(file.blob.bodySha256)) {
      blobs.set(file.blob.bodySha256, file.blob);
      if (file.upload !== undefined) {
        uploads.set(file.upload.key, file.upload);
      }
    }
    locations.push(file.location);
  }
  return { blobs: [...blobs.values()], locations, uploads: [...uploads.values()] };
}

/**
 * The locations an import still has to record: every path whose body differs from the one the store last
 * recorded there, or that it has never recorded.
 *
 * A path already showing this body is skipped, so a re-run over an unchanged home records nothing; a path
 * that went back to an earlier body is recorded AGAIN, because "newest" is the latest observation and a skip
 * there would leave the intermediate body answering for a file that no longer holds it.
 *
 * @param locations every location the walk found
 * @param current the body the store last recorded at each path it holds
 * @returns the locations to insert, in walk order
 */
export function locationsToRecord({
  locations,
  current,
}: {
  locations: readonly NewMeasurementLocationRecord[];
  current: ReadonlyMap<string, string>;
}): readonly NewMeasurementLocationRecord[] {
  return locations.filter((location) => current.get(location.relativePath) !== location.bodySha256);
}

/**
 * The uploads a write still has to make: every `storage` body the store does not already hold.
 *
 * A body already in `measurement_blob` had its object uploaded BEFORE its row was inserted (see
 * `./measurementStore.ts`), so a held sha needs no second upload and a re-run over an unchanged home makes none.
 *
 * @param folded what the walk produced
 * @param heldShas the body hashes `measurement_blob` already holds
 * @returns the uploads to make, in fold order
 */
export function uploadsNeeded({
  folded,
  heldShas,
}: {
  folded: FoldedMeasurements;
  heldShas: ReadonlySet<string>;
}): readonly MeasurementUpload[] {
  return folded.uploads.filter((upload) => !heldShas.has(upload.key));
}

/**
 * Where a restore writes one stored path, refusing any path that would leave the target directory.
 *
 * @param into the directory a restore writes under
 * @param relativePath the stored path under the home
 * @returns the absolute path to write, or the refusal naming the path
 */
export function restoreTarget({
  into,
  relativePath,
}: {
  into: string;
  relativePath: string;
}): Result<string, UnstorableMeasurementError> {
  const normalised = posix.normalize(relativePath);
  const escapes =
    isAbsolute(relativePath) || normalised === ".." || normalised.startsWith("../") || normalised !== relativePath;
  if (escapes || measurementClassOf({ relativePath }) === undefined) {
    return err(
      FleetImportErrors.unstorableMeasurement({
        path: relativePath,
        reason: `restoring it would write outside ${into} or outside the four measurement roots`,
      }),
    );
  }
  return ok(join(into, ...relativePath.split("/")));
}
