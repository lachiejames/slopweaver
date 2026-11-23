/**
 * The effectful edge onto the local Supabase STACK — every `docker exec` a backup or restore makes. The
 * database-level steps (`psql`, `createdb`, `pg_restore`) live beside it in `stackDatabase.ts`, through the
 * same `run`.
 *
 * Each call is `spawnSync` with the payload on a FILE DESCRIPTOR, never a pipe: a 6 GB database's dump
 * flows from `pg_dump` inside the container straight into the staging file, and a restore flows from the
 * file straight into `pg_restore`'s stdin. No JS string or Buffer ever holds a payload — the rule
 * `.claude/rules/typescript-patterns.md` states for JSON applies with more force to a dump. Only stderr
 * is piped, and only because a refusal is small and worth quoting.
 *
 * Synchronous on purpose: `no-headless` bans the async `child_process` members, and a dump that blocks
 * the verb for ninety seconds is exactly what the verb is for.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";

import { type BackupError, BackupErrors } from "./errors.js";
import { fileVanished } from "./fileRace.js";
import { type BackupArtefact, DUMPED_SCHEMAS, STORAGE_VOLUME_MOUNT, supabaseContainer } from "./plan.js";

/** What every stack step returns: its value, or the backup failure that stopped it. */
export type Step<T> = Result<T, BackupError>;

/**
 * The bound on a step that moves no payload — a `psql` query, `createdb`, `dropdb`, a `docker inspect`, a version
 * line. Each returns in seconds, so this only ends a client wedged on a daemon or a server that never answers.
 */
export const QUERY_STEP_TIMEOUT_MS = 120_000;

/**
 * The bound on a step that streams a payload — `pg_dump`, a Storage tar, `pg_restore`, a Vault export. A 6 GB
 * dump runs in about ninety seconds (this file's header), so four hours is past any slow store and only ends a
 * wedged one.
 */
export const PAYLOAD_STEP_TIMEOUT_MS = 4 * 60 * 60 * 1000;

/** Bytes read per step while digesting a file, so the digest of a multi-gigabyte dump is bounded. */
const DIGEST_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Run one command with an explicit stdio layout and report its failure as text.
 *
 * @param command the binary
 * @param args its argv
 * @param stdio the three descriptors — a number is a file, `"ignore"` closes, `"pipe"` captures
 * @param label how a refusal names the step
 * @param timeoutMs how long the step may run before it is stopped — {@link QUERY_STEP_TIMEOUT_MS} or
 *   {@link PAYLOAD_STEP_TIMEOUT_MS}, required so every caller states which it is
 * @returns the captured stdout (empty unless piped), or the step's stderr as the refusal
 */
export function run({
  command,
  args,
  stdio,
  label,
  input,
  timeoutMs,
}: {
  command: string;
  args: readonly string[];
  stdio: readonly [number | "ignore" | "pipe", number | "pipe", "pipe"];
  label: string;
  /** Text for a piped stdin — a list file, never a payload. */
  input?: string;
  timeoutMs: number;
}): Result<string, BackupError> {
  const result = spawnSync(command, [...args], {
    maxBuffer: 64 * 1024 * 1024,
    stdio: [...stdio],
    timeout: timeoutMs,
    ...(input === undefined ? {} : { input }),
  });
  if (result.error !== undefined) {
    const timedOut = "code" in result.error && result.error.code === "ETIMEDOUT";
    const cause = timedOut
      ? new Error(`did not finish within ${String(timeoutMs / 1000)}s and was stopped`, { cause: result.error })
      : result.error;
    return err(BackupErrors.commandLaunchFailed({ cause, label }));
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr).trim();
    return err(BackupErrors.commandExited({ label, status: result.status, stderr }));
  }
  return ok(String(result.stdout));
}

/**
 * Open a host file for reading, hand its descriptor to one step, and close it whatever the step did.
 *
 * @param path the file
 * @param use the step, given the descriptor to put on a child's stdin
 * @returns whatever the step returned
 */
export function withInput<T>({ path, use }: { path: string; use: (input: number) => Step<T> }): Step<T> {
  const input = openSync(path, "r");
  try {
    return use(input);
  } finally {
    closeSync(input);
  }
}

/**
 * Digest and measure one staged file, in bounded chunks.
 *
 * @param path the file
 * @returns its byte count and SHA-256, or why it could not be read — `ARTEFACT_VANISHED` when the file was
 *   already gone, which only the backed-up-root walk treats as anything but a failure (`./fileRace.ts`)
 */
export function digestFile({ path }: { path: string }): Result<BackupArtefact, BackupError> {
  let descriptor: number | null = null;
  try {
    const bytes = statSync(path).size;
    descriptor = openSync(path, "r");
    const hash = createHash("sha256");
    const chunk = Buffer.alloc(DIGEST_CHUNK_BYTES);
    // Read the descriptor start to end; `readFileSync` on a descriptor reads from its current position
    // and would take the whole file into one Buffer, which is the shape this loop exists to avoid.
    let position = 0;
    while (position < bytes) {
      const read = readSync(descriptor, chunk, 0, chunk.length, position);
      if (read === 0) {
        break;
      }
      hash.update(chunk.subarray(0, read));
      position += read;
    }
    return ok({ bytes, sha256: hash.digest("hex") });
  } catch (error: unknown) {
    if (fileVanished({ cause: error, path })) {
      return err(BackupErrors.artefactVanished({ cause: error, path }));
    }
    return err(BackupErrors.artefactDigestFailed({ cause: error, path }));
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor);
    }
  }
}

/**
 * `pg_dump --version` inside the database container, verbatim.
 *
 * @returns the version line, or why the container could not be reached — the first thing a backup checks
 */
export function pgDumpVersion(): Result<string, BackupError> {
  return run({
    args: ["exec", supabaseContainer({ service: "db" }), "pg_dump", "--version"],
    command: "docker",
    label: "docker exec pg_dump --version",
    stdio: ["ignore", "pipe", "pipe"],
    timeoutMs: QUERY_STEP_TIMEOUT_MS,
  }).map((line) => line.trim());
}

/**
 * Dump the owned schemas of one database, custom format, into a file on the host.
 *
 * Scoped to {@link DUMPED_SCHEMAS} — see `plan.ts` for the measurement that made a whole-database dump
 * unrestorable. `--no-owner --no-privileges` because the restore target may be created by a different role
 * and the grants are re-applied by `yarn store:migrate`'s own phase 3, which owns them.
 *
 * @param database which database in the stack
 * @param path where the dump lands
 * @returns nothing on success, else the step's stderr
 */
export function dumpDatabase({ database, path }: { database: string; path: string }): Result<void, BackupError> {
  const out = openSync(path, "w", 0o600);
  try {
    return run({
      args: [
        "exec",
        supabaseContainer({ service: "db" }),
        "pg_dump",
        "-U",
        "postgres",
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        ...DUMPED_SCHEMAS.flatMap((schema) => ["-n", schema]),
        database,
      ],
      command: "docker",
      label: `pg_dump ${database}`,
      stdio: ["ignore", out, "pipe"],
      timeoutMs: PAYLOAD_STEP_TIMEOUT_MS,
    }).map(() => undefined);
  } finally {
    closeSync(out);
  }
}

/**
 * Tar the Storage volume's objects into a file on the host.
 *
 * @param path where the archive lands
 * @returns nothing on success, else the step's stderr
 */
export function tarStorage({ path }: { path: string }): Result<void, BackupError> {
  const out = openSync(path, "w", 0o600);
  try {
    return run({
      args: ["exec", supabaseContainer({ service: "storage" }), "tar", "-C", STORAGE_VOLUME_MOUNT, "-cf", "-", "."],
      command: "docker",
      label: "tar of the storage volume",
      stdio: ["ignore", out, "pipe"],
      timeoutMs: PAYLOAD_STEP_TIMEOUT_MS,
    }).map(() => undefined);
  } finally {
    closeSync(out);
  }
}

/**
 * Unpack a storage archive into the Storage volume — the live one, which is why the caller holds the
 * refusal and this function only performs.
 *
 * @param path the archive on the host
 * @returns nothing on success, else `tar`'s stderr
 */
export function untarStorage({ path }: { path: string }): Result<void, BackupError> {
  const input = openSync(path, "r");
  try {
    return run({
      args: ["exec", "-i", supabaseContainer({ service: "storage" }), "tar", "-C", STORAGE_VOLUME_MOUNT, "-xf", "-"],
      command: "docker",
      label: "tar into the storage volume",
      stdio: [input, "pipe", "pipe"],
      timeoutMs: PAYLOAD_STEP_TIMEOUT_MS,
    }).map(() => undefined);
  } finally {
    closeSync(input);
  }
}

/**
 * List a storage archive's members on the host, so a proof can say what the tar carries without
 * touching the live volume.
 *
 * @param path the archive
 * @returns the member paths, sorted
 */
export function listArchive({ path }: { path: string }): Result<readonly string[], BackupError> {
  return run({
    args: ["-tf", path],
    command: "tar",
    label: `tar -tf ${path}`,
    stdio: ["ignore", "pipe", "pipe"],
    timeoutMs: PAYLOAD_STEP_TIMEOUT_MS,
  }).map((out) =>
    out
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .toSorted(),
  );
}

/**
 * Read a small file whole — the manifest, never a payload.
 *
 * @param path the file
 * @returns its text
 */
export function readSmallFile({ path }: { path: string }): Result<string, BackupError> {
  try {
    return ok(readFileSync(path, "utf8"));
  } catch (error: unknown) {
    return err(BackupErrors.fileUnreadable({ cause: error, path }));
  }
}
