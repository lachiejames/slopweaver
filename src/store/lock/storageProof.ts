/**
 * Proof that a retained `storage.tar` holds the bytes of every Storage object the database names — the leg a
 * database rehearsal cannot see, because it compares rows and never opens the volume.
 *
 * MEASURED on the live store: the file backend keeps each object at
 * `<tenant>/<tenant>/<bucket>/<name>/<version>` under the volume (`stub/stub/…` here), and the store's own
 * objects are content-addressed — the name's last segment is the sha256 of the bytes. Repro:
 * `docker exec supabase_storage_slopweaver find /mnt -type f`, then `sha256sum` one of them. So each object is
 * checked three ways: its file is in the tar at its path, its byte count is the one `storage.objects` records,
 * and — where its name is a sha256 — its bytes digest to its name. Only objects created before the dump began
 * are expected: the tar is cut after the dump, so anything newer is the live store moving, not a gap.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { type StoreLockError, StoreLockErrors } from "./errors.js";

/** One Storage object as the database records it. */
export interface StorageObjectRow {
  readonly bucket: string;
  readonly name: string;
  readonly version: string | null;
  /** `metadata->>'size'`, or `null` when the row records none. */
  readonly size: number | null;
}

/** One file in the unpacked tar. */
export interface TarFile {
  /** Its path inside the tar, `/`-separated, with no leading `./`. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** A sha256 in hex. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Milliseconds the `tar` unpack may take. It is a local extraction of the store's own Storage volume, which reads
 * and writes at disk speed — seconds for the store as it stands — so ten minutes is far past the slowest legitimate
 * run, and an unpack still going then is a stuck child, not a large volume.
 */
const UNPACK_TIMEOUT_MS = 600_000;

/**
 * Every way the tar fails to hold the objects the database names.
 *
 * @param objects the rows, already limited to those created before the dump began
 * @param files every file the tar unpacked to
 * @returns one sentence per problem, capped at the first ten plus a count — empty when every object is held
 */
export function storageProblems({
  objects,
  files,
}: {
  objects: readonly StorageObjectRow[];
  files: readonly TarFile[];
}): readonly string[] {
  const problems: string[] = [];
  for (const object of objects) {
    const suffix =
      object.version === null
        ? `/${object.bucket}/${object.name}`
        : `/${object.bucket}/${object.name}/${object.version}`;
    const file = files.find((candidate) => `/${candidate.path}`.endsWith(suffix));
    const label = `${object.bucket}/${object.name}`;
    if (file === undefined) {
      problems.push(`${label}: not in storage.tar`);
      continue;
    }
    if (object.size !== null && object.size !== file.bytes) {
      problems.push(
        `${label}: storage.objects records ${String(object.size)} byte(s), the tar holds ${String(file.bytes)}`,
      );
    }
    const last = object.name.split("/").at(-1)!;
    if (SHA256_HEX.test(last) && last !== file.sha256) {
      problems.push(`${label}: its bytes digest to ${file.sha256.slice(0, 12)}…, not its name`);
    }
  }
  if (problems.length > 10) {
    return [...problems.slice(0, 10), `…and ${String(problems.length - 10)} more`];
  }
  return problems;
}

/**
 * Rows out of the JSON array {@link storageObjectsQuery} prints.
 *
 * @param value the parsed array
 * @returns the rows, or why the array is not that shape
 */
export function parseStorageObjects({
  value,
}: {
  value: unknown;
}): Result<readonly StorageObjectRow[], StoreLockError> {
  const refuse = ({ detail }: { detail: string }): Result<readonly StorageObjectRow[], StoreLockError> =>
    err(StoreLockErrors.backupGateFailed({ reasons: [`storage.objects: ${detail}`] }));
  if (!Array.isArray(value)) {
    return refuse({ detail: "not an array" });
  }
  const rows: StorageObjectRow[] = [];
  for (const row of value as unknown[]) {
    if (!isRecord(row)) {
      return refuse({ detail: "a row is not an object" });
    }
    const { bucket, name, version, size } = row;
    if (typeof bucket !== "string" || typeof name !== "string") {
      return refuse({ detail: "a row carries no bucket or name" });
    }
    rows.push({
      bucket,
      name,
      size: typeof size === "number" ? size : null,
      version: typeof version === "string" ? version : null,
    });
  }
  return ok(rows);
}

/**
 * The query that lists every object created before an instant, as one JSON array.
 *
 * @param beforeIso the dump's start
 * @returns the query, or a refusal for anything but an ISO instant — it is spliced into the SQL
 */
export function storageObjectsQuery({ beforeIso }: { beforeIso: string }): Result<string, StoreLockError> {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(beforeIso)) {
    return err(StoreLockErrors.backupGateFailed({ reasons: [`${beforeIso} is not an ISO instant`] }));
  }
  return ok(`select coalesce(json_agg(json_build_object('bucket', bucket_id, 'name', name, 'version', version,
  'size', (metadata->>'size')::bigint)), '[]'::json)
from storage.objects where created_at <= '${beforeIso}'::timestamptz;
`);
}

/**
 * Unpack a tar into a fresh directory, digest every file, and remove the directory again.
 *
 * @param tarPath the retained `storage.tar`
 * @param scratch a directory to unpack into — created, then removed whatever happens
 * @returns every file it held
 */
export function unpackAndDigest({
  tarPath,
  scratch,
}: {
  tarPath: string;
  scratch: string;
}): Result<readonly TarFile[], StoreLockError> {
  mkdirSync(scratch, { mode: 0o700, recursive: true });
  try {
    const unpacked = spawnSync("tar", ["-xf", tarPath, "-C", scratch], {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: UNPACK_TIMEOUT_MS,
    });
    if (unpacked.error !== undefined || unpacked.status !== 0) {
      let why = String(unpacked.stderr).trim();
      if (unpacked.error !== undefined) {
        const timedOut = "code" in unpacked.error && unpacked.error.code === "ETIMEDOUT";
        why = timedOut ? `tar did not finish within ${String(UNPACK_TIMEOUT_MS / 1000)}s` : unpacked.error.message;
      }
      return err(StoreLockErrors.backupGateFailed({ reasons: [`storage.tar did not unpack: ${why}`] }));
    }
    const files: TarFile[] = [];
    const walk = ({ directory }: { directory: string }): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          walk({ directory: path });
        } else if (entry.isFile()) {
          const bytes = readFileSync(path);
          files.push({
            bytes: statSync(path).size,
            path: relative(scratch, path).split(sep).join("/"),
            sha256: createHash("sha256").update(bytes).digest("hex"),
          });
        }
      }
    };
    walk({ directory: scratch });
    return ok(files);
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}
