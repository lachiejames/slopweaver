/**
 * Which backup a restore rehearsal rehearses, and fetching the part of it a rehearsal needs.
 *
 * **The newest prefix IS the latest** — `./plan.ts` says so and keeps no `latest` pointer, because a pointer
 * that lags a failed upload is the kind of lie a restore would trust. So {@link newestBackupPrefix} reads the
 * listing and takes the lexically greatest `<project>/<instant>/` that carries a `manifest.json`, the last
 * object an upload writes; an instant with no manifest is an upload that never finished and is passed over.
 *
 * **What is fetched is every leg's manifest and the database's payload.** `manifest.json`, the dump (whole or
 * rebuilt from its chunks, each re-hashed), `storage.tar`, `files.json` and the sealed `vault.enc` — each decrypted
 * on the way in by the transport the caller built with the backup key. `verifyBackupDirectory` checks the dump, the
 * tar and the Vault object against the manifest. The tar is then LISTED, never unpacked — a digest proves the bytes
 * are the ones that were sent, a listing proves they are a tar. The files leg's blobs are not downloaded: every
 * one is content-addressed by its digest, so {@link readOtherLegs} asks the destination whether it holds each
 * object `files.json` names, at the right length — the check the backup sweep already trusts (`./filesHeld.ts`).
 * `secrets.enc` is not fetched: opening it needs the passphrase, and a rehearsal that held one would be a second
 * place the credentials could leak from.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";

import { backupErrorLines } from "./errors.js";
import { filesObjectsMissing } from "./filesHeld.js";
import { BACKUP_FILES, type BackupManifest, FILES_MANIFEST, parseFilesManifest, SUPABASE_PROJECT_ID } from "./plan.js";
import type { LegsReading } from "./rehearsalCheck.js";
import { type RehearsalError, RehearsalErrors } from "./rehearsalErrors.js";
import { fetchBackupObjects, verifyBackupDirectory } from "./restoreSource.js";
import { PAYLOAD_STEP_TIMEOUT_MS } from "./stack.js";
import { stagingRoot } from "./staging.js";
import { makeStagingDirectory } from "./stagingDirectory.js";
import type { BackupTransport } from "./transport.js";

/** An instant as a backup prefix spells it — `2026-09-27T18-32-20-978Z`. */
const INSTANT_SEGMENT = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

/**
 * The newest finished backup prefix in a destination listing.
 *
 * @param project the project segment every prefix of this install begins with
 * @param objectNames every object name under `<project>/`
 * @returns the prefix with its trailing slash, or `null` when no instant carries a manifest
 */
export function newestBackupPrefix({
  project,
  objectNames,
}: {
  project: string;
  objectNames: readonly string[];
}): string | null {
  const finished = objectNames
    .map((name) => name.split("/"))
    .filter(
      (parts) =>
        parts.length === 3 &&
        parts[0] === project &&
        INSTANT_SEGMENT.test(parts[1]!) &&
        parts[2] === BACKUP_FILES.manifest,
    )
    .map((parts) => parts[1]!)
    .toSorted();
  const newest = finished.at(-1);
  if (newest === undefined) {
    return null;
  }
  return `${project}/${newest}/`;
}

/**
 * Pick the backup to rehearse: the one named, or the newest finished one in the destination.
 *
 * @param from a `<project>/<instant>/` prefix the caller named, or `null` for the newest
 * @param destination the destination root, for the refusal
 * @param listBackups the destination listing under one prefix
 * @returns the prefix, or why there is none
 */
export async function chooseBackup({
  from,
  destination,
  listBackups,
}: {
  from: string | null;
  destination: string;
  listBackups: (args: { prefix: string }) => ReturnType<BackupTransport["list"]>;
}): Promise<Result<string, RehearsalError>> {
  if (from !== null) {
    return ok(from.endsWith("/") ? from : `${from}/`);
  }
  const listed = await listBackups({ prefix: `${SUPABASE_PROJECT_ID}/` });
  if (listed.isErr()) {
    return err(RehearsalErrors.stepFailed({ reasons: [listed.error.message], step: "listing the destination" }));
  }
  const newest = newestBackupPrefix({ objectNames: listed.value, project: SUPABASE_PROJECT_ID });
  if (newest === null) {
    return err(RehearsalErrors.noBackup({ destination, project: SUPABASE_PROJECT_ID }));
  }
  return ok(newest);
}

/** A fetched and verified backup, ready to replay. */
export interface RehearsalSource {
  /** The local destination root it was read from. */
  readonly destination: string;
  readonly prefix: string;
  /** Where the manifest, the dump, the tar and the Vault object were decrypted to. */
  readonly directory: string;
  readonly manifest: BackupManifest;
}

/**
 * Fetch one backup's manifest, dump, tar, files manifest and Vault object, and verify every payload against the
 * manifest.
 *
 * Lands under the same `retrieved/` directory `store restore --from <destination>/<project>/<instant>` uses, so a
 * rehearsal and a hand restore of the same prefix share one download rather than holding two.
 *
 * @param home the Slopweaver home
 * @param destination the destination root, reported back on the source
 * @param prefix the backup's prefix, with its trailing slash
 * @param transport the decrypting transport over the destination
 * @returns the verified source, or why it could not be fetched or did not verify
 */
export async function fetchRehearsalSource({
  home,
  destination,
  prefix,
  transport,
}: {
  home: string;
  destination: string;
  prefix: string;
  transport: BackupTransport;
}): Promise<Result<RehearsalSource, RehearsalError>> {
  const directory = join(stagingRoot({ home }), "retrieved", prefix.replace(/\/+$/, "").replace(/\//g, "_"));
  const made = makeStagingDirectory({ directory, home });
  if (made.isErr()) {
    return err(
      RehearsalErrors.stepFailed({ reasons: backupErrorLines({ error: made.error }), step: "making the staging" }),
    );
  }
  const fetched = await fetchBackupObjects({ directory, prefix, transport, withSecrets: false });
  if (fetched.isErr()) {
    return err(
      RehearsalErrors.stepFailed({ reasons: backupErrorLines({ error: fetched.error }), step: "fetching the backup" }),
    );
  }
  const manifest = verifyBackupDirectory({ directory });
  if (manifest.isErr()) {
    return err(
      RehearsalErrors.stepFailed({
        reasons: backupErrorLines({ error: manifest.error }),
        step: "verifying the backup",
      }),
    );
  }
  return ok({ destination, directory, manifest: manifest.value, prefix });
}

/**
 * Read the two legs that are not the database: does `storage.tar` list as a tar, and does the destination hold
 * every object `files.json` names.
 *
 * @param directory where the source was fetched to
 * @param transport the destination, listed and never written
 * @returns both readings, or why `files.json` could not be read or the destination listed
 */
export async function readOtherLegs({
  directory,
  transport,
}: {
  directory: string;
  transport: BackupTransport;
}): Promise<Result<LegsReading, RehearsalError>> {
  const path = join(directory, FILES_MANIFEST);
  let value: unknown;
  try {
    value = safeJsonParse({ label: path, text: readFileSync(path, "utf8") });
  } catch (cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return err(RehearsalErrors.stepFailed({ reasons: [why], step: `reading ${FILES_MANIFEST}` }));
  }
  const files = parseFilesManifest({ value });
  if (files.isErr()) {
    return err(
      RehearsalErrors.stepFailed({
        reasons: backupErrorLines({ error: files.error }),
        step: `reading ${FILES_MANIFEST}`,
      }),
    );
  }
  const missing = await filesObjectsMissing({ files: files.value.files, transport });
  if (missing.isErr()) {
    return err(RehearsalErrors.stepFailed({ reasons: missing.error, step: "listing the files leg's objects" }));
  }
  return ok({
    files: { missing: missing.value, named: files.value.files.length },
    storage: listTar({ path: join(directory, BACKUP_FILES.storage) }),
  });
}

/**
 * List a tar without unpacking it. Exported for the store lock's pre-lock backup, which reads its own local
 * `storage.tar` the same way (`src/store/lock/backupGate.ts`).
 *
 * @param path the tar
 * @returns how many entries it lists, or what `tar` said when it would not list
 */
export function listTar({ path }: { path: string }): LegsReading["storage"] {
  const listed = spawnSync("tar", ["-tf", path], {
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: PAYLOAD_STEP_TIMEOUT_MS,
  });
  if (listed.error !== undefined) {
    return { status: "unreadable", why: listed.error.message };
  }
  if (listed.status !== 0) {
    return { status: "unreadable", why: String(listed.stderr).trim() };
  }
  const entries = String(listed.stdout)
    .split("\n")
    .filter((line) => line.length > 0).length;
  return { entries, status: "listed" };
}
