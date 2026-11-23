/**
 * The credentials leg of a backup: reading this machine's `secrets/` and sealing it into `secrets.enc`.
 *
 * Its own module rather than a block inside {@link prepareStaging}, mirroring `restoreSecrets.ts` on the
 * other side. The rest of a backup answers to a database and a destination; this leg answers to the master
 * password, and the two halves share nothing but the staging directory. The password is read ONCE per run by the
 * verb (`./masterPassword.ts`) and handed in, so `secrets.enc` and the destination's key wrap are always sealed
 * under the same string.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { backupErrorLines } from "./errors.js";
import { BACKUP_FILES, type BackupArtefact } from "./plan.js";
import type { BackupDeps } from "./run.js";
import { collectSecretsBundle } from "./secretsBundle.js";
import { encryptSecretsBundle } from "./secretsCrypto.js";
import { SecretsBackupErrors } from "./secretsErrors.js";

/**
 * Write `secrets.enc` into the staging directory, when a master password is set on this machine.
 *
 * **No password is not a failure here, and that is deliberate.** The nightly runs unattended at 03:00;
 * refusing the whole backup because the credentials leg has nothing to encrypt with would trade a partial
 * backup for no backup. What it must never do is pass SILENTLY — it returns `null`, the manifest records
 * `secrets: null` as a required field, and the verb prints the command that fixes it. Every other failure
 * — an unreadable secret, a file past the size cap — IS a refusal, because those mean the leg could have
 * run and did not.
 *
 * @param directory the staging directory the artefact lands in
 * @param home the Slopweaver home whose `secrets/` is carried
 * @param masterPassword the master password the verb read and validated, or `null` when none is set
 * @param deps the stack effects, for the digest
 * @returns the artefact, or `null` when no password is set, or why the leg could not run
 */
export function stageSecretsLeg({
  directory,
  home,
  masterPassword,
  deps,
}: {
  directory: string;
  home: string;
  masterPassword: string | null;
  deps: BackupDeps;
}): Result<BackupArtefact | null> {
  if (masterPassword === null) {
    return ok(null);
  }
  const bundle = collectSecretsBundle({ home });
  if (bundle.isErr()) {
    return err([bundle.error.message]);
  }
  const armoured = encryptSecretsBundle({
    passphrase: masterPassword,
    plaintext: Buffer.from(JSON.stringify(bundle.value), "utf8"),
  });
  if (armoured.isErr()) {
    return err([armoured.error.message]);
  }
  const path = join(directory, BACKUP_FILES.secrets);
  try {
    writeFileSync(path, armoured.value, { mode: 0o600 });
  } catch (error: unknown) {
    // Every other failure in this leg is a Result; an unguarded write would have been the one that threw
    // past the whole backup instead of failing it. Raised by this branch's own review.
    return err([SecretsBackupErrors.secretsUnreadable({ cause: error, path }).message]);
  }
  return deps.digestFile({ path }).mapErr((error) => backupErrorLines({ error }));
}
