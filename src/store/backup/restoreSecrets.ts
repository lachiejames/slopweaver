/**
 * The credentials leg of a restore: deciding whether a backup carried one, and putting it back.
 *
 * Kept beside {@link runRestore} rather than inside it, because this half answers to a passphrase a person
 * pastes in while the rest of a restore answers to a destination and a database. The seam is the same one
 * `secretsBundle.ts` draws on the backup side.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseJsonObject } from "#lib/jsonParse.js";
import { err, ok, type Result } from "#lib/result.js";

import { BACKUP_FILES, type BackupManifest } from "./plan.js";
import type { RestoreSource } from "./restoreSource.js";
import { parseSecretsBundle, writeSecretsBundle } from "./secretsBundle.js";
import { decryptSecretsBundle } from "./secretsCrypto.js";
import { type SecretsBackupError, SecretsBackupErrors } from "./secretsErrors.js";
import { readSmallFile } from "./stack.js";

/**
 * Whether a downloaded manifest names a credentials bundle, read WITHOUT validating the whole manifest.
 *
 * Deliberately tolerant: a manifest this cannot read is not this function's problem — the very next step
 * is {@link verifyBackupDirectory}, whose refusal is the good one to surface. All this decides is whether
 * one more object is worth fetching.
 *
 * @param directory the directory the manifest was downloaded into
 * @returns whether `secrets` is present and not null
 */
export function manifestNamesSecrets({ directory }: { directory: string }): boolean {
  const text = readSmallFile({ path: join(directory, BACKUP_FILES.manifest) });
  if (text.isErr()) {
    return false;
  }
  const decoded = parseJsonObject({ text: text.value });
  if (decoded.isErr()) {
    return false;
  }
  return decoded.value["secrets"] != null;
}

/** What restoring the credentials leg did. Never carries a secret, a name only. */
export interface SecretsRestoreReport {
  readonly into: string;
  readonly names: readonly string[];
}

/**
 * Decrypt a backup's credentials bundle with a pasted passphrase and write it into a named directory.
 *
 * **The manifest decides whether one was expected, not the file's presence.** A backup taken before a
 * passphrase was ever set carries no `secrets.enc` and says `secrets: null`; that is a complete backup
 * and the refusal names it as such. A manifest that DOES name the artefact while the file is missing is a
 * broken download, and reads differently.
 *
 * Into a directory the caller names, never over the live `secrets/` — putting a credential back where it
 * lives is the last step of a recovery, and a copy is what a proof compares.
 *
 * **An empty passphrase refuses HERE, not at the prompt.** The verb reads a line and hands it over; what
 * counts as usable is this function's business, so a piped empty stdin and a bare Return at the prompt
 * fail the same way, by name, rather than reaching the cipher as a key derived from nothing.
 *
 * @param source where the downloaded or staged files are
 * @param manifest the verified manifest, whose `secrets` field says whether one is expected
 * @param into the directory to write the credentials under, created at `0700`
 * @param passphrase the single line pasted out of the operator's password manager
 * @returns which names were written, or why nothing was
 */
export function runRestoreSecrets({
  source,
  manifest,
  into,
  passphrase,
}: {
  source: RestoreSource;
  manifest: BackupManifest;
  into: string;
  passphrase: string;
}): Result<SecretsRestoreReport, SecretsBackupError> {
  const path = join(source.directory, BACKUP_FILES.secrets);
  if (passphrase.length === 0) {
    return err(SecretsBackupErrors.noPassphraseEntered());
  }
  if (manifest.secrets === null) {
    return err(SecretsBackupErrors.secretsNotInBackup({ createdAtIso: manifest.createdAtIso }));
  }
  let armoured: Buffer;
  try {
    armoured = readFileSync(path);
  } catch (error: unknown) {
    return err(SecretsBackupErrors.secretsUnreadable({ cause: error, path }));
  }
  if (armoured.length !== manifest.secrets.bytes) {
    return err(
      SecretsBackupErrors.bundleCorrupt({
        detail: `the manifest says ${String(manifest.secrets.bytes)} byte(s) and the file is ${String(armoured.length)}`,
      }),
    );
  }
  const opened = decryptSecretsBundle({ armoured, passphrase });
  if (opened.isErr()) {
    return err(opened.error);
  }
  const bundle = parseSecretsBundle({ plaintext: opened.value });
  if (bundle.isErr()) {
    return err(bundle.error);
  }
  const written = writeSecretsBundle({ bundle: bundle.value, into });
  if (written.isErr()) {
    return err(written.error);
  }
  return ok({ into, names: written.value });
}
