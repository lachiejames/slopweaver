/**
 * One file under an `authored` home directory as the rows `authored_body` and `authored_file` take, and the
 * two read-side decisions the `store authored` verb makes over those rows. Pure: bytes, paths and rows in;
 * rows, plans or a named refusal out.
 *
 * `../schema/authored.ts` says why a body is keyed by the sha-256 of its exact bytes and a path is a row of
 * its own; `./authoredDirectories.ts` says which directories are this class.
 *
 * ## A credential is refused, never stored
 *
 * The store is dumped to the backup destination as corpus data, never as a credential. So a text body that
 * trips a SECRET class of the repository's own hygiene scanner (`isSecretHit`, `../../hygiene/scan.ts` — a
 * credential pattern or a private-denylist word) is refused with the file and the class named, and the
 * leg exits non-zero until somebody moves the token out of the file. A body holding a NUL byte is binary and is
 * scanned as raw bytes (`latin1`, one character per byte), so a token sitting in it as plain ASCII is caught
 * exactly as in text. A git bundle is compressed, so its pack is INFLATED object by object and each object is
 * scanned too (`./gitBundle.ts`); a bundle whose pack will not inflate is refused rather than stored unread.
 * What remains unseen is an image's own compressed data, and the leg counts binary bodies so that is stated.
 * MEASURED on this install: 184 binary bodies (101 `.bundle`, 80 images, 3 other), zero secret
 * hits among them, so neither scan costs a false refusal here (repro: `slopweaver store import-fleet --only
 * authored --dry-run`, whose note line counts them).
 */
import { createHash } from "node:crypto";

import { err, ok, type Result } from "#lib/result.js";
import { isSecretHit, scanContent } from "../../hygiene/scan.js";
import type { NewAuthoredBodyRecord, NewAuthoredFileRecord } from "../schema/authored.js";

import { isAuthoredHomeFile, isAuthoredPath } from "./authoredDirectories.js";
import { isCallFilePath, stripCallToolAnswers } from "./callToolAnswerStrip.js";
import { type FleetImportError, FleetImportErrors } from "./errors.js";
import { gitBundleObjects, isGitBundle } from "./gitBundle.js";
import { anchorHomeRelativePath } from "./ownerTurnAnchor.js";

/**
 * The largest file the leg reads into one row.
 *
 * MEASURED, the largest file under any authored directory is 6,725,299 bytes (repro: `cd
 * ~/.slopweaver && find handover-evidence briefs artifacts artifact-migration sessions talk -type f -exec stat
 * -f '%z %N' {} + | sort -rn | head -1`). 32 MiB is the point `../../lib/safeJson.ts` starts warning at, far above that, and a
 * file past it is refused by name rather than loaded — a surprise that size is a finding, not a row.
 */
export const AUTHORED_FILE_MAX_BYTES = 32 * 1024 * 1024;

/** A file projected into its body row and its location row. */
export interface ProjectedAuthoredFile {
  readonly body: NewAuthoredBodyRecord;
  readonly location: NewAuthoredFileRecord;
  /** Whether the body is binary — scanned as raw bytes, so a secret inside compressed data is not seen. */
  readonly binary: boolean;
  /** Whether the body is a git bundle, whose pack was inflated and scanned object by object. */
  readonly bundle: boolean;
}

/**
 * The top-level directory a home-relative path sits under, when the path is clean and its deepest classification
 * row is `authored` — so `live/slack/turn-markers/a.json` names `live`, and `live/browser/…` names nothing. A
 * top-level file the class names (`responders.json`) is its own entry, so it names itself.
 *
 * @param relativePath a path under the home, `/`-separated
 * @returns the top-level entry's name, or `undefined` for a path outside the class, a bare directory, or one with
 *   an empty, `.` or `..` segment
 */
export function authoredDirectoryOf({ relativePath }: { relativePath: string }): string | undefined {
  const segments = relativePath.split("/");
  if (segments.length === 1 && isAuthoredHomeFile({ name: relativePath })) {
    return relativePath;
  }
  if (segments.length < 2 || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return undefined;
  }
  if (!isAuthoredPath({ relativePath })) {
    return undefined;
  }
  return segments[0]!;
}

/**
 * Project one file's exact bytes into its two rows.
 *
 * @param bytes the file exactly as read — hashed and stored as given, bar a call file's tool answers
 *   (`./callToolAnswerStrip.ts`), which are removed first
 * @param relativePath where it sat under the home, `/`-separated; names the file in any refusal
 * @param fileModifiedAt the file's mtime
 * @param denylist the private denylist's words, whose presence is a secret exactly as a credential pattern is
 * @returns the rows, or the reason the file is not stored
 */
export function projectAuthoredFile({
  bytes,
  relativePath,
  fileModifiedAt,
  denylist,
}: {
  bytes: Uint8Array;
  relativePath: string;
  fileModifiedAt: Date;
  denylist: readonly string[];
}): Result<ProjectedAuthoredFile, FleetImportError> {
  const directory = authoredDirectoryOf({ relativePath });
  if (directory === undefined) {
    return err(
      FleetImportErrors.unstorableAuthoredFile({
        path: relativePath,
        reason: "it is not a path ./authoredDirectories.ts classifies authored",
      }),
    );
  }
  if (bytes.length > AUTHORED_FILE_MAX_BYTES) {
    return err(
      FleetImportErrors.unstorableAuthoredFile({
        path: relativePath,
        reason: `it is ${String(bytes.length)} bytes, over the ${String(AUTHORED_FILE_MAX_BYTES)}-byte ceiling`,
      }),
    );
  }
  const stored = isCallFilePath({ relativePath }) ? stripCallToolAnswers({ bytes }).bytes : bytes;
  const buffer = Buffer.from(stored);
  const binary = buffer.includes(0);
  const bundle = isGitBundle({ bytes: buffer });
  const secret = secretIn({ binary, buffer, bundle, denylist, relativePath });
  if (secret !== undefined) {
    return err(FleetImportErrors.unstorableAuthoredFile({ path: relativePath, reason: secret }));
  }
  const bodySha256 = createHash("sha256").update(buffer).digest("hex");
  return ok({
    binary,
    body: { body: buffer, bodySha256, byteLength: buffer.length },
    bundle,
    location: { bodySha256, directory, fileModifiedAt, relativePath },
  });
}

/**
 * Why a body may not be stored for a secret it carries, or `undefined` when the scan found none.
 *
 * @param buffer the body
 * @param binary whether it holds a NUL, and so is read one character per byte
 * @param bundle whether it is a git bundle, whose inflated objects are scanned as well
 * @param denylist the private denylist's words
 * @param relativePath names the file in the hits
 * @returns the refusal reason, or `undefined`
 */
function secretIn({
  buffer,
  binary,
  bundle,
  denylist,
  relativePath,
}: {
  buffer: Buffer;
  binary: boolean;
  bundle: boolean;
  denylist: readonly string[];
  relativePath: string;
}): string | undefined {
  const texts: { where: string; content: string }[] = [
    { content: buffer.toString(binary ? "latin1" : "utf8"), where: "line" },
  ];
  if (binary) {
    // UTF-16 text holds a NUL beside every ASCII character, so one character per byte reads a token as
    // `g\0h\0p\0_…` and misses it; both byte orders are read as UTF-16 as well.
    const even = buffer.subarray(0, buffer.length - (buffer.length % 2));
    texts.push({ content: even.toString("utf16le"), where: "UTF-16LE line" });
    texts.push({ content: Buffer.from(even).swap16().toString("utf16le"), where: "UTF-16BE line" });
  }
  if (bundle) {
    const objects = gitBundleObjects({ bytes: buffer });
    if (objects.isErr()) {
      return `it is a git bundle whose pack cannot be inflated to scan (${objects.error.reason}), so it cannot be checked for a secret`;
    }
    objects.value.forEach((object, index) => {
      texts.push({ content: object.toString("latin1"), where: `pack object ${String(index + 1)}, line` });
    });
  }
  for (const text of texts) {
    const hit = scanContent({ content: text.content, denylist, path: relativePath }).find((candidate) =>
      isSecretHit({ label: candidate.label }),
    );
    if (hit !== undefined) {
      return `${text.where} ${String(hit.line)} trips the ${hit.label} secret class, and the store's dump leaves this machine`;
    }
  }
  return undefined;
}

/**
 * Resolve what a caller typed to a stored file's path.
 *
 * @param ref an anchor in any spelling `anchorHomeRelativePath` reads, or a path relative to the home
 * @param home the state home an absolute path must sit under
 * @returns the path under the home, or the refusal naming why it is not this class's file
 */
export function resolveAuthoredRef({ ref, home }: { ref: string; home: string }): Result<string, FleetImportError> {
  const relativePath = anchorHomeRelativePath({ home, ref });
  if (relativePath === undefined) {
    return err(FleetImportErrors.unstorableAuthoredFile({ path: ref, reason: `it names no file under ${home}` }));
  }
  if (authoredDirectoryOf({ relativePath }) === undefined) {
    return err(
      FleetImportErrors.unstorableAuthoredFile({
        path: ref,
        reason: `${relativePath} is not under a directory classified authored`,
      }),
    );
  }
  return ok(relativePath);
}

/** One stored version of a path, as the restore plan reads it. */
export interface StoredAuthoredVersion {
  readonly relativePath: string;
  readonly bodySha256: string;
  readonly byteLength: number;
  readonly fileModifiedAt: Date;
}

/**
 * The stored paths an import did not find on disk — what `authored_absent` holds after that import.
 *
 * `present` is every file the walk LISTED, refused ones included: a file refused as a credential is still on
 * disk, so it is not absent, and leaving it out would mark it deleted.
 *
 * @param stored every distinct path the store holds a version of
 * @param present every home-relative path the walk listed
 * @returns the stored paths the walk did not list, sorted
 */
export function absentAuthoredPaths({
  stored,
  present,
}: {
  stored: readonly string[];
  present: readonly string[];
}): readonly string[] {
  const listed = new Set(present);
  return stored.filter((path) => !listed.has(path)).toSorted();
}

/**
 * The newest stored version at each path — the one `show` prints and `restore` writes.
 *
 * Ties on `fileModifiedAt` break on the body hash, so the answer never depends on row order.
 *
 * @param versions every stored version, in any order
 * @returns one version per path, in path order
 */
export function newestPerPath({
  versions,
}: {
  versions: readonly StoredAuthoredVersion[];
}): readonly StoredAuthoredVersion[] {
  const newest = new Map<string, StoredAuthoredVersion>();
  for (const version of versions) {
    const held = newest.get(version.relativePath);
    if (held === undefined || isNewer({ candidate: version, held })) {
      newest.set(version.relativePath, version);
    }
  }
  return [...newest.values()].toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
}

/** Whether one version outranks another at the same path. */
function isNewer({ candidate, held }: { candidate: StoredAuthoredVersion; held: StoredAuthoredVersion }): boolean {
  const delta = candidate.fileModifiedAt.getTime() - held.fileModifiedAt.getTime();
  if (delta !== 0) {
    return delta > 0;
  }
  return candidate.bodySha256 > held.bodySha256;
}

/** What `restore` will do with every stored path. */
export interface AuthoredRestorePlan {
  /** Absent in the home — written from the store. */
  readonly write: readonly StoredAuthoredVersion[];
  /** Present with exactly the stored bytes — nothing to do. */
  readonly identical: readonly StoredAuthoredVersion[];
  /** Present with OTHER bytes — never overwritten, named so a reader can look. */
  readonly differs: readonly StoredAuthoredVersion[];
}

/**
 * Decide, per path, whether restore writes it.
 *
 * A present file is never overwritten, whatever it holds: the home copy may be newer than the last import,
 * and a restore that clobbered it would lose exactly the kind of work this class exists to keep.
 *
 * @param newest the newest stored version at each path
 * @param presentSha256 the sha-256 of the file at a path on disk, or `undefined` when nothing is there
 * @returns the three buckets
 */
export function planAuthoredRestore({
  newest,
  presentSha256,
}: {
  newest: readonly StoredAuthoredVersion[];
  presentSha256: (relativePath: string) => string | undefined;
}): AuthoredRestorePlan {
  const write: StoredAuthoredVersion[] = [];
  const identical: StoredAuthoredVersion[] = [];
  const differs: StoredAuthoredVersion[] = [];
  for (const version of newest) {
    const present = presentSha256(version.relativePath);
    if (present === undefined) {
      write.push(version);
    } else if (present === version.bodySha256) {
      identical.push(version);
    } else {
      differs.push(version);
    }
  }
  return { differs, identical, write };
}
