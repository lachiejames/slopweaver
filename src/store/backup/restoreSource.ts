/**
 * A restore's first half: resolving `--from` into a local directory, fetching a destination's objects into it,
 * and verifying them against the manifest's digests.
 *
 * Split from `./restore.ts`, which replays a verified directory, because the two share only the source shape —
 * this half reads a destination and the filesystem, that one drives the stack — and one file holding both grew
 * past the size at which a reader holds it in their head.
 *
 * **Every restore verifies before it writes.** The manifest's SHA-256s are checked against the bytes on disk
 * first, because a download cut short restores cleanly up to the point it was cut and a `pg_restore` that stopped
 * half way leaves a database that looks like a database.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { fetchDump } from "./chunkRestore.js";
import { type PlaintextPlace, parseBackupSourceAddress, refuseHomeOverlap } from "./destination.js";
import { backupDestinations, rememberedDestinations } from "./destinationConfig.js";
import { type BackupError, BackupErrors, backupErrorLines } from "./errors.js";
import {
  BACKUP_FILES,
  type BackupArtefact,
  type BackupManifest,
  FILES_MANIFEST,
  parseBackupManifest,
  SUPABASE_PROJECT_ID,
} from "./plan.js";
import { manifestNamesSecrets } from "./restoreSecrets.js";
import { digestFile, readSmallFile } from "./stack.js";
import { stagingRoot } from "./staging.js";
import { makeStagingDirectory } from "./stagingDirectory.js";
import type { BackupTransport } from "./transport.js";

/** Where a restore's files came from: a staging directory read in place, or a destination fetched and opened. */
export type RestoreSource =
  | { readonly kind: "directory"; readonly directory: string }
  | {
      readonly kind: "local-destination";
      readonly root: string;
      readonly prefix: string;
      readonly directory: string;
    };

/**
 * Resolve `--from` into a local directory holding the backup's files. A staging directory is read in place;
 * a `<root>/<project>/<instant>` destination address is fetched through the decrypting transport into the
 * staging root's `retrieved/`, so what lands there is plaintext the manifest's digests can check. A destination
 * overlapping the home, or any other place the restore writes plaintext to, is refused before the fetch.
 *
 * @param from the address as typed — a path or a `file://` URL
 * @param home the Slopweaver home, whose staging root a fetch lands under
 * @param transportFor the decrypting transport over a destination root, built with the backup key
 * @param writesTo the other places this restore writes plaintext to — `--files-into`, `--secrets-into`
 * @returns the source, or why it could not be resolved
 */
export async function resolveRestoreSource({
  from,
  home,
  transportFor,
  writesTo = [],
}: {
  from: string;
  home: string;
  transportFor: (args: { root: string }) => Result<BackupTransport>;
  writesTo?: readonly PlaintextPlace[];
}): Promise<Result<RestoreSource, BackupError>> {
  const address = parseBackupSourceAddress({ from, project: SUPABASE_PROJECT_ID });
  if (address.isErr()) {
    return err(address.error);
  }
  if (address.value.kind === "staging") {
    const directory = address.value.directory;
    if (!existsSync(join(directory, BACKUP_FILES.manifest))) {
      return err(BackupErrors.restoreSourceUnfinished({ directory, manifest: BACKUP_FILES.manifest }));
    }
    const clear = refuseConfiguredDestinationOverlap({ home, writesTo });
    if (clear.isErr()) {
      return err(clear.error);
    }
    return ok({ directory, kind: "directory" });
  }
  const { root, prefix } = address.value;
  const clear = refuseHomeOverlap({ home, root, writesTo });
  if (clear.isErr()) {
    return err(clear.error);
  }
  const transport = transportFor({ root });
  if (transport.isErr()) {
    return err(BackupErrors.stepFailed({ reasons: transport.error }));
  }
  const directory = join(stagingRoot({ home }), "retrieved", prefix.replace(/\/+$/, "").replace(/\//g, "_"));
  const made = makeStagingDirectory({ directory, home });
  if (made.isErr()) {
    return err(made.error);
  }
  const fetched = await fetchBackupObjects({ directory, prefix, transport: transport.value, withSecrets: true });
  if (fetched.isErr()) {
    return err(fetched.error);
  }
  return ok({ directory, kind: "local-destination", prefix, root });
}

/**
 * A restore read from a staging directory names no destination, so the plaintext it writes is checked against
 * EVERY one this home's backups go to instead: credentials restored into a backup folder would sit as plaintext
 * beside the ciphertext that folder exists to hold, and the second folder on the list is no less one.
 *
 * @param home the Slopweaver home whose remembered destinations are read
 * @param writesTo the places this restore writes plaintext to — `--files-into`, `--secrets-into`
 * @returns nothing when none overlaps it or no destination is configured, else the refusal
 */
function refuseConfiguredDestinationOverlap({
  home,
  writesTo,
}: {
  home: string;
  writesTo: readonly PlaintextPlace[];
}): Result<void, BackupError> {
  if (writesTo.length === 0) {
    return ok(undefined);
  }
  const roots = configuredRoots({ home });
  if (roots.isErr()) {
    return err(roots.error);
  }
  for (const root of roots.value) {
    const overlap = refuseHomeOverlap({ home, root, writesTo });
    if (overlap.isErr()) {
      return err(overlap.error);
    }
  }
  return ok(undefined);
}

/**
 * Every root this home's backups go to: the environment's choice AND every remembered one — an ambient variable
 * shadowing the home's list must not hide the folders this home's nightly backups actually go to — de-duplicated.
 *
 * @param home the Slopweaver home whose remembered list is read
 * @returns the roots, none when no destination is configured, or why one that is named cannot be read
 */
function configuredRoots({ home }: { home: string }): Result<readonly string[], BackupError> {
  const selected = backupDestinations({ home, override: null });
  const remembered = rememberedDestinations({ home });
  const failures = [selected, remembered].flatMap((read) =>
    read.isErr() && read.error.code !== "DESTINATION_UNSELECTED" ? [read.error.message] : [],
  );
  if (failures.length > 0) {
    return err(BackupErrors.stepFailed({ reasons: failures }));
  }
  const destinations = [
    ...(selected.isOk() ? selected.value.destinations : []),
    ...(remembered.isOk() ? remembered.value : []),
  ];
  return ok([...new Set(destinations.map((destination) => destination.root))]);
}

/**
 * Fetch one backup's objects: the manifest FIRST, because it says whether the dump is one object or chunks and
 * whether the optional credentials and Vault objects exist — asked of the manifest rather than probed, since a
 * speculative fetch whose failure is swallowed cannot tell "this backup carried none" from "the fetch broke".
 *
 * @param directory where they land
 * @param prefix the backup's prefix under the destination root
 * @param transport the decrypting transport
 * @param withSecrets whether to fetch the credentials bundle too — a rehearsal does not, since opening it needs the
 *   passphrase and a rehearsal holding one would be a second place the credentials could leak from
 * @returns nothing, or the first fetch that failed
 */
export async function fetchBackupObjects({
  directory,
  prefix,
  transport,
  withSecrets,
}: {
  directory: string;
  prefix: string;
  transport: BackupTransport;
  withSecrets: boolean;
}): Promise<Result<void, BackupError>> {
  const fetchOne = async ({ name }: { name: string }): Promise<Result<void, BackupError>> =>
    (await transport.download({ objectName: `${prefix}${name}`, path: join(directory, name) })).mapErr(
      (transportError) => BackupErrors.transportFailed({ transportError }),
    );
  for (const name of [BACKUP_FILES.manifest, BACKUP_FILES.storage, FILES_MANIFEST]) {
    const fetched = await fetchOne({ name });
    if (fetched.isErr()) {
      return fetched;
    }
  }
  const dump = await fetchDump({ directory, prefix, transport });
  if (dump.isErr()) {
    return err(BackupErrors.stepFailed({ reasons: dump.error }));
  }
  const optional = [
    ...(withSecrets && manifestNamesSecrets({ directory }) ? [BACKUP_FILES.secrets] : []),
    ...(manifestNamesVault({ directory }) ? [BACKUP_FILES.vault] : []),
  ];
  for (const name of optional) {
    const fetched = await fetchOne({ name });
    if (fetched.isErr()) {
      return fetched;
    }
  }
  return ok(undefined);
}

/**
 * Whether a fetched manifest records a Vault leg — read once the manifest is on disk, before the rest is fetched.
 *
 * @param directory where the manifest landed
 * @returns `true` only for a manifest that parses and carries a non-null `vault`; one that does not parse is
 *   refused moments later by {@link verifyBackupDirectory}, which names why
 */
function manifestNamesVault({ directory }: { directory: string }): boolean {
  return readBackupManifest({ directory }).match(
    (manifest) => manifest.vault !== null,
    () => false,
  );
}

/**
 * Read and parse one backup directory's `manifest.json`.
 *
 * @param directory the backup directory
 * @returns the manifest, or why it is unreadable, not JSON or not a manifest
 */
function readBackupManifest({ directory }: { directory: string }): Result<BackupManifest, BackupError> {
  const text = readSmallFile({ path: join(directory, BACKUP_FILES.manifest) });
  if (text.isErr()) {
    return err(text.error);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(text.value);
  } catch {
    return err(BackupErrors.fileNotJson({ directory, file: BACKUP_FILES.manifest }));
  }
  return parseBackupManifest({ value: decoded });
}

/**
 * Read and verify a backup directory: the manifest parses, and the dump, the tar and `vault.enc` (when the
 * manifest records one) digest to what it says.
 *
 * @param directory the backup directory
 * @param digest the digest effect
 * @returns the manifest, or every mismatch
 */
export function verifyBackupDirectory({
  directory,
  digest = digestFile,
}: {
  directory: string;
  digest?: typeof digestFile;
}): Result<BackupManifest, BackupError> {
  const manifest = readBackupManifest({ directory });
  if (manifest.isErr()) {
    return err(manifest.error);
  }
  const vault = manifest.value.vault;
  const checked: readonly { name: string; expected: BackupArtefact }[] = [
    { expected: manifest.value.dump, name: BACKUP_FILES.dump },
    { expected: manifest.value.storage, name: BACKUP_FILES.storage },
    ...(vault === null ? [] : [{ expected: vault, name: BACKUP_FILES.vault }]),
  ];
  const problems = checked.flatMap(({ name, expected }) => digestProblems({ digest, directory, expected, name }));
  return problems.length > 0 ? err(BackupErrors.integrityFailed({ reasons: problems })) : ok(manifest.value);
}

/**
 * Digest one staged file and say how it disagrees with what the manifest recorded.
 *
 * @param directory the backup directory
 * @param name the file
 * @param expected the manifest's length and digest for it
 * @param digest the digest effect
 * @returns one line per disagreement, empty when it matches
 */
function digestProblems({
  directory,
  name,
  expected,
  digest,
}: {
  directory: string;
  name: string;
  expected: BackupArtefact;
  digest: typeof digestFile;
}): readonly string[] {
  const actual = digest({ path: join(directory, name) });
  if (actual.isErr()) {
    return backupErrorLines({ error: actual.error });
  }
  if (actual.value.sha256 === expected.sha256 && actual.value.bytes === expected.bytes) {
    return [];
  }
  return [
    `${name}: manifest says ${String(expected.bytes)} byte(s) sha256 ${expected.sha256.slice(0, 12)}…, ` +
      `the file is ${String(actual.value.bytes)} byte(s) sha256 ${actual.value.sha256.slice(0, 12)}…`,
  ];
}
