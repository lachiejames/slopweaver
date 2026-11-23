/**
 * The connector-secret WRITER — the one place a token lands on disk. It writes
 * `$SLOPWEAVER_HOME/secrets/<name>` at `0600` under a `0700` `secrets/` dir, enforcing both modes on
 * create AND on overwrite (a mode is umask-masked on create and never tightens an existing file). The
 * token value is NEVER logged, echoed, or returned — the result carries only the name + path + a written
 * flag, so a caller can report success without ever holding the value again.
 *
 * The value arrives from a no-echo/piped source (never argv); {@link normaliseSecretInput} strips the one
 * trailing newline a shell pipe adds and rejects a blank or multi-line value. The fs edge is thin over the
 * pure {@link normaliseSecretInput}; it is exercised by a temp-dir round-trip (a genuine fixture, no mock).
 */
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  realpathSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { err, ok, type Result } from "../lib/result.js";
import { writeFileAtomic } from "../lib/writeAtomic.js";
import { secretFilePath, stateHomePaths } from "../stateHome.js";
import { type SecretsError, SecretsErrors } from "./errors.js";
import type { SecretName } from "./names.js";
import { credentialsByName } from "./registry.js";

/** The outcome of a secret write — deliberately value-free so success is reportable without the token. */
export interface SecretWriteResult {
  readonly name: SecretName;
  readonly path: string;
  readonly written: true;
}

/**
 * Normalise a raw captured value: strip a single trailing `\r?\n` (the newline a shell pipe/`read` adds),
 * then reject a blank or multi-line value (a token is exactly one non-empty line). Pure — never trims
 * interior characters, so a token that legitimately contains no whitespace round-trips byte-for-byte.
 *
 * @param input the raw captured value (from piped stdin / a no-echo read)
 * @returns the cleaned single-line token, or an error
 */
export function normaliseSecretInput({ input }: { input: string }): Result<string, SecretsError> {
  const value = input.replace(/\r?\n$/, "");
  if (value.length === 0) {
    return err(SecretsErrors.emptyValue());
  }
  if (/[\r\n]/.test(value)) {
    return err(SecretsErrors.multilineValue());
  }
  return ok(value);
}

/**
 * Hold a normalised value to the exact form its register row declares, if it declares one. A row with no
 * `valueShape` accepts any single line, because most tokens have no form knowable here. Never names the
 * value in the refusal.
 *
 * @param name the secret the value is for
 * @param value the single-line value {@link normaliseSecretInput} returned
 * @returns the value unchanged, or `VALUE_SHAPE_MISMATCH`
 */
export function checkSecretValueShape({
  name,
  value,
}: {
  name: SecretName;
  value: string;
}): Result<string, SecretsError> {
  const shape = credentialsByName().get(name)?.valueShape;
  if (shape === undefined || shape.pattern.test(value)) {
    return ok(value);
  }
  return err(SecretsErrors.valueShapeMismatch({ describe: shape.describe, name }));
}

/**
 * Whether a directory's mode lets its group or anyone else write it. The symlink checks around a secret resolve
 * path strings, so they hold only while nobody else can rename an entry in the home between a check and the
 * write or read after it; a home others can write is refused instead.
 *
 * @param dir the resolved home holding `secrets/`
 * @returns `true` when the group or other write bit is set
 */
export function othersCanWrite({ dir }: { dir: string }): boolean {
  return (statSync(dir).mode & 0o022) !== 0;
}

/**
 * The refusal's words for a home others can write.
 *
 * @param dir the resolved home
 * @returns the reason, naming the directory and the fix
 */
export function othersCanWriteReason({ dir }: { dir: string }): string {
  return `${dir} is writable by its group or others, so a secret is never written or read under it — chmod go-w ${dir}`;
}

/**
 * Write a validated token to its secret file at `0600` (dir `0700`). Idempotent by content: writing the
 * same value twice leaves the same file at the same path. Overwriting replaces the value and re-tightens
 * the mode. Never logs the value. Returns a value-free result.
 *
 * @param home the Slopweaver home
 * @param name the allowlisted secret name
 * @param value the normalised single-line token
 * @returns the write result (name + path only), or an fs error
 */
export function writeSecretFile({
  home,
  name,
  value,
}: {
  home: string;
  name: SecretName;
  value: string;
}): Result<SecretWriteResult, SecretsError> {
  const path = secretFilePath({ home, name });
  const place = realSecretPath({ home, name });
  if (place.isErr()) {
    return err(place.error);
  }
  try {
    // A fresh `0600` temp file renamed over the path, never a write THROUGH it: `writeFileSync` follows a
    // symlink planted at the secret's path and would land the token wherever it points. A rename
    // replaces the link itself.
    writeFileAtomic({ contents: value, fileMode: 0o600, path: place.value });
    chmodSync(place.value, 0o600);
  } catch (error: unknown) {
    return err(SecretsErrors.secretWriteFailed({ cause: error, name }));
  }
  return ok({ name, path, written: true });
}

/**
 * Create a secret file that must not already exist — the write for a value that is generated once and never
 * replaced, such as the backup's master password. Exclusive at the final path rather than checked first: the
 * name is opened `O_CREAT | O_EXCL` at `0600`, which fails when anything already stands there — a link planted
 * at the name included, which `O_EXCL` never follows. The value is written nowhere else, so no interrupted run
 * leaves a copy of it under another name; a write that fails removes the file this call created, and
 * one killed mid-write leaves a short file that every reader of the master password refuses under its floor.
 *
 * @param home the Slopweaver home
 * @param name the allowlisted secret name
 * @param value the normalised single-line value
 * @returns the write result (name + path only), `SECRET_EXISTS` when one is already there, or an fs error
 */
export function createSecretFile({
  home,
  name,
  value,
}: {
  home: string;
  name: SecretName;
  value: string;
}): Result<SecretWriteResult, SecretsError> {
  const path = secretFilePath({ home, name });
  const place = realSecretPath({ home, name });
  if (place.isErr()) {
    return err(place.error);
  }
  let descriptor: number;
  try {
    descriptor = openSync(place.value, "wx", 0o600);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return err(SecretsErrors.secretExists({ name, path }));
    }
    return err(SecretsErrors.secretWriteFailed({ cause: error, name }));
  }
  try {
    writeSync(descriptor, value);
    fsyncSync(descriptor);
  } catch (error: unknown) {
    // This call created the file, so nothing else's value is removed here.
    rmSync(place.value, { force: true });
    return err(SecretsErrors.secretWriteFailed({ cause: error, name }));
  } finally {
    closeSync(descriptor);
  }
  return ok({ name, path, written: true });
}

/**
 * Make `secrets/` (`0700`) and resolve the real path a secret is written at, refusing a linked directory and a
 * home others can write.
 *
 * @param home the Slopweaver home
 * @param name the secret, for the refusal
 * @returns the resolved file path inside the real `secrets/` directory, or why nothing may be written there
 */
function realSecretPath({ home, name }: { home: string; name: SecretName }): Result<string, SecretsError> {
  const dir = stateHomePaths({ home }).secrets;
  const path = secretFilePath({ home, name });
  try {
    mkdirSync(dir, { mode: 0o700, recursive: true });
    // A symlinked `secrets/` would carry every write below it to wherever the link points.
    // Resolve the parent, THEN the directory: `secrets` resolving anywhere but inside its own
    // resolved parent means it, or the parent between the two reads, is a link. Every write below goes to that
    // resolved path, so a directory swapped for a link after this check cannot redirect the token.
    const realParent = realpathSync(dirname(dir));
    const realDir = realpathSync(dir);
    if (realDir !== join(realParent, basename(dir))) {
      return err(
        SecretsErrors.secretWriteFailed({
          cause: new Error(`${dir} is a symlink, and a secret is only ever written into a real directory`),
          name,
        }),
      );
    }
    if (othersCanWrite({ dir: realParent })) {
      return err(
        SecretsErrors.secretWriteFailed({ cause: new Error(othersCanWriteReason({ dir: realParent })), name }),
      );
    }
    chmodSync(realDir, 0o700);
    return ok(join(realDir, basename(path)));
  } catch (error: unknown) {
    return err(SecretsErrors.secretWriteFailed({ cause: error, name }));
  }
}
