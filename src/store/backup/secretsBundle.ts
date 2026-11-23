/**
 * The secrets leg's effectful edge — reading `$SLOPWEAVER_HOME/secrets/` into one plaintext bundle, and
 * putting one back at the modes it was taken at.
 *
 * ## What goes in, and the files that do not
 *
 * Every regular file directly under `secrets/` goes in, rather than every name on the
 * `SECRET_NAMES` allowlist. The allowlist is what `secrets set` will WRITE; it is not a promise about
 * what is on disk, and a credential the register has not caught up with is still a credential somebody
 * loses. The directory is the truth here.
 *
 * The exception is {@link BACKUP_PASSPHRASE_SECRET} itself, which is excluded on purpose. It is the key
 * to the bundle, so carrying it inside would be encrypting it under itself — no harm, and no point. The
 * consequence is real and belongs in the recovery steps rather than in a comment nobody reads in the middle of the night: a
 * restored home cannot take its OWN next backup until the passphrase is set again, which is two seconds
 * of paste from the password manager and needs to be written down as a step.
 *
 * A name the credential register declares `retired` stays out too: nothing reads it, and a backup carrying
 * one only spreads a dead copy of a credential, the retired copy of the Storage service key most of all.
 *
 * ## Why modes travel with the bytes
 *
 * `src/secrets/store.ts` writes `0600` under a `0700` directory and re-tightens both on every overwrite,
 * because a mode is umask-masked on create and never tightens an existing file. A restore that put the
 * bytes back under whatever umask the new machine happens to have would quietly undo that, so each entry
 * carries its own mode and {@link writeSecretsBundle} applies it with an explicit `chmodSync`.
 */
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { parseJson } from "#lib/jsonParse.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomicBytes } from "#lib/writeAtomic.js";

import { CREDENTIALS } from "../../secrets/registry.js";
import { secretFilePath, stateHomePaths } from "../../stateHome.js";

import { type SecretsBackupError, SecretsBackupErrors } from "./secretsErrors.js";

/** The one passphrase, as a secret name. Set once from the operator's password manager; never carried inside the bundle. */
export const BACKUP_PASSPHRASE_SECRET = "backup-passphrase";

/** The bundle's own version, so a restore can refuse a plaintext shape it does not know. */
const SECRETS_BUNDLE_VERSION = 1;

/**
 * The largest single secret file this will carry, in bytes.
 *
 * A credential is a token or a service-account JSON — kilobytes. The cap exists because every entry is
 * base64'd into one JS string, so a file whose size came from somewhere other than "a person pasted a
 * credential" is the shape `.claude/rules/typescript-patterns.md` bans, and refusing it by name beats
 * discovering it as a heap error during a disaster.
 */
const MAX_SECRET_BYTES = 1024 * 1024;

/** One secret file inside the bundle. */
interface BundledSecret {
  readonly name: string;
  /** The file's permission bits, as `statSync(...).mode & 0o777`. */
  readonly mode: number;
  readonly contentB64: string;
}

/** The plaintext a bundle encrypts. */
export interface SecretsBundle {
  readonly version: typeof SECRETS_BUNDLE_VERSION;
  readonly files: readonly BundledSecret[];
}

/**
 * The names the credential register declares `retired`: nothing reads them, so a backup carrying one only
 * spreads a dead copy — the Storage service key most of all, which the owner ruled is stored nowhere.
 * A name the register has NOT caught up with still goes in; only a declared-dead one stays out.
 *
 * @returns the retired names
 */
function retiredSecretNames(): ReadonlySet<string> {
  return new Set(CREDENTIALS.flatMap((entry) => (entry.lifecycle === "retired" ? [entry.name] : [])));
}

/**
 * Read every secret under one home into a bundle, excluding the backup passphrase itself and every retired name.
 *
 * A home with no `secrets/` directory at all yields an empty bundle rather than an error — a fresh
 * install has nothing to protect, and refusing would fail a backup that is otherwise correct.
 *
 * @param home the Slopweaver home
 * @returns the bundle, or the first file that could not be read
 */
export function collectSecretsBundle({ home }: { home: string }): Result<SecretsBundle, SecretsBackupError> {
  const directory = stateHomePaths({ home }).secrets;
  let names: readonly string[];
  try {
    names = readdirSync(directory).toSorted((left, right) => left.localeCompare(right));
  } catch {
    return ok({ files: [], version: SECRETS_BUNDLE_VERSION });
  }
  const files: BundledSecret[] = [];
  const retired = retiredSecretNames();
  for (const name of names) {
    if (name === BACKUP_PASSPHRASE_SECRET || retired.has(name)) {
      continue;
    }
    const path = join(directory, name);
    const entry = readOneSecret({ name, path });
    if (entry.isErr()) {
      return err(entry.error);
    }
    if (entry.value !== null) {
      files.push(entry.value);
    }
  }
  return ok({ files, version: SECRETS_BUNDLE_VERSION });
}

/**
 * Read one directory entry, skipping anything that is not a regular file.
 *
 * @param name the entry's name under `secrets/`
 * @param path its absolute path
 * @returns the bundled secret, `null` when the entry is not a regular file, or why it could not be read
 */
function readOneSecret({
  name,
  path,
}: {
  name: string;
  path: string;
}): Result<BundledSecret | null, SecretsBackupError> {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) {
      return ok(null);
    }
    if (stat.size > MAX_SECRET_BYTES) {
      return err(
        SecretsBackupErrors.secretsUnreadable({
          cause: new Error(
            `${String(stat.size)} bytes is past the ${String(MAX_SECRET_BYTES)}-byte cap for one secret`,
          ),
          path,
        }),
      );
    }
    return ok({ contentB64: readFileSync(path).toString("base64"), mode: stat.mode & 0o777, name });
  } catch (error: unknown) {
    return err(SecretsBackupErrors.secretsUnreadable({ cause: error, path }));
  }
}

/**
 * Write a bundle's files into a directory, at the modes they were taken at, under a `0700` directory.
 *
 * Into a directory the caller names rather than over the live `secrets/`, exactly as `runRestoreFiles`
 * rebuilds the corpus roots into a named directory: putting a credential back where it lives is the last
 * step of a recovery and a copy is what a proof compares.
 *
 * A retired name in a bundle taken before it was retired is left out, so an old backup cannot put a dead
 * copy back on disk.
 *
 * @param into the directory to write them under, created here
 * @param bundle the decrypted plaintext
 * @returns the names written, in bundle order, or the first one that could not be written
 */
export function writeSecretsBundle({
  into,
  bundle,
}: {
  into: string;
  bundle: SecretsBundle;
}): Result<readonly string[], SecretsBackupError> {
  try {
    mkdirSync(into, { mode: 0o700, recursive: true });
    chmodSync(into, 0o700);
  } catch (error: unknown) {
    return err(SecretsBackupErrors.secretsUnreadable({ cause: error, path: into }));
  }
  const written: string[] = [];
  const retired = retiredSecretNames();
  for (const file of bundle.files) {
    if (retired.has(file.name)) {
      continue;
    }
    const path = join(into, file.name);
    try {
      // A fresh temp file renamed over the name: a link already standing at `path` is REPLACED, never written
      // through, so it cannot carry a credential into whatever it points at (a backup destination's objects).
      writeFileAtomicBytes({ bytes: Buffer.from(file.contentB64, "base64"), fileMode: file.mode, path });
      chmodSync(path, file.mode);
    } catch (error: unknown) {
      return err(SecretsBackupErrors.secretsUnreadable({ cause: error, path }));
    }
    written.push(file.name);
  }
  return ok(written);
}

/**
 * Read the backup passphrase off this machine, for the unattended nightly.
 *
 * Only the BACKUP side reads a file. A restore runs on a machine whose `secrets/` is gone, which is the
 * whole reason it exists, so it takes the passphrase pasted in instead — see the `--secrets-into` verb.
 *
 * **Only a file that is NOT THERE means none is set.** A passphrase file that exists and cannot be read —
 * the wrong owner after a restore, mode `000`, a directory where a file should be — is
 * {@link SecretsBackupErrors.secretsUnreadable}, which REFUSES the backup. The distinction is the whole point:
 * the first is a machine that never had one and ships a complete backup without credentials, the second is
 * a machine that HAS one and would have shipped a backup missing them while printing the reassuring line.
 * Found by this branch's own r1 review, which is the class of defect it was looking for.
 *
 * @param home the Slopweaver home
 * @returns the single-line passphrase, or that none is set and the command that sets one
 */
export function readBackupPassphrase({ home }: { home: string }): Result<string, SecretsBackupError> {
  const path = secretFilePath({ home, name: BACKUP_PASSPHRASE_SECRET });
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error: unknown) {
    if (isNotFound({ error })) {
      return err(SecretsBackupErrors.noPassphraseSet({ path }));
    }
    return err(SecretsBackupErrors.secretsUnreadable({ cause: error, path }));
  }
  const value = raw.replace(/\r?\n$/, "");
  if (value.length === 0) {
    return err(SecretsBackupErrors.noPassphraseSet({ path }));
  }
  return ok(value);
}

const bundleSchema = z
  .object({
    files: z.array(
      z
        .object({
          contentB64: z.string(),
          mode: z.number().int().nonnegative(),
          name: z.string().min(1),
        })
        .strict(),
    ),
    version: z.literal(SECRETS_BUNDLE_VERSION),
  })
  .strict();

/**
 * Parse a decrypted plaintext into a bundle.
 *
 * Reached only after the cipher's tag authenticated, so this is not a boundary against an attacker — it is
 * a version check against a bundle written by a different build of slopweaver, which is why a failure is
 * {@link SecretsBackupErrors.unknownFormat} rather than corruption.
 *
 * @param plaintext what the cipher returned
 * @returns the bundle, or why this build cannot read it
 */
export function parseSecretsBundle({ plaintext }: { plaintext: Buffer }): Result<SecretsBundle, SecretsBackupError> {
  const decoded = parseJson({ text: plaintext.toString("utf8") });
  if (decoded.isErr()) {
    return err(SecretsBackupErrors.unknownFormat({ found: "the decrypted bundle is not JSON" }));
  }
  const parsed = bundleSchema.safeParse(decoded.value);
  if (!parsed.success) {
    return err(
      SecretsBackupErrors.unknownFormat({ found: parsed.error.issues.map((issue) => issue.message).join("; ") }),
    );
  }
  return ok(parsed.data);
}

/**
 * Whether a filesystem error means the path is not there, as opposed to being there and unreadable.
 *
 * @param error what `readFileSync` threw
 * @returns whether its code is `ENOENT`
 */
function isNotFound({ error }: { error: unknown }): boolean {
  return error instanceof Error && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
