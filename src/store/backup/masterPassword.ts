/**
 * The backup's master password — one line the operator keeps in a password manager, which seals the credentials
 * bundle (`./secretsCrypto.ts`) and wraps the backup key (`./keyWrap.ts`), so a lost Mac recovers from the
 * destination plus this one line. Owner rulings: the fleet generates it, 128 random bits, shown
 * once for the operator's password manager, and a shorter typed one is refused.
 *
 * ## Why 26 characters is the floor
 *
 * Whoever holds a destination can guess at the wrap offline, so the password is the whole defence. Sixteen random
 * bytes in unpadded lowercase RFC 4648 base32 is 26 characters, and that length is the minimum every READER of a
 * new password enforces: the nightly, the wrap, and `secrets set backup-passphrase` through the row's `valueShape`.
 * A longer typed one passes; nothing measures a typed one's entropy, so the floor is the length the generator gives.
 * History is never refused: a credentials bundle sealed under a shorter passphrase still opens.
 *
 * ## Why it never reaches stdout
 *
 * A seat's stdout is a model transcript, and a TTY check does not tell a terminal from a visible agent session.
 * So the password is only ever handed to `/usr/bin/pbcopy` on stdin — never argv, never stdout, never a JSON
 * report, never a door record. It lives on this machine in `secrets/backup-passphrase` at `0600`, which is what
 * lets the 03:00 backup and the monthly rehearsal run with nobody there.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { err, ok, type Result } from "#lib/result.js";

import { type MasterPasswordError, MasterPasswordErrors } from "./masterPasswordErrors.js";
import { readBackupPassphrase } from "./secretsBundle.js";

/** The random bytes a generated master password carries: 128 bits. */
const MASTER_PASSWORD_BYTES = 16;

/** The shortest master password any reader accepts — the length {@link MASTER_PASSWORD_BYTES} encodes to. */
export const MASTER_PASSWORD_MIN_CHARS = 26;

/** RFC 4648 base32, lowercase, so a pasted password has no case to get wrong and no padding to lose. */
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * Encode bytes as unpadded lowercase RFC 4648 base32.
 *
 * @param bytes what is encoded
 * @returns the base32 text, five bits per character, the last character zero-padded
 */
export function base32Lower({ bytes }: { bytes: Buffer }): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31]!;
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31]!;
  }
  return out;
}

/**
 * Generate a master password: {@link MASTER_PASSWORD_BYTES} random bytes as 26 lowercase base32 characters.
 *
 * @param random the source of the bytes, replaceable in a test
 * @returns the password
 */
export function generateMasterPassword({
  random = ({ bytes }) => randomBytes(bytes),
}: {
  random?: (args: { bytes: number }) => Buffer;
} = {}): string {
  return base32Lower({ bytes: random({ bytes: MASTER_PASSWORD_BYTES }) });
}

/**
 * Hold a password to the floor every new use of it needs.
 *
 * @param password the candidate, never echoed
 * @returns the password unchanged, or `MASTER_PASSWORD_TOO_SHORT` naming its length and the floor
 */
export function validateMasterPassword({ password }: { password: string }): Result<string, MasterPasswordError> {
  // Code points rather than UTF-16 units, so a typed character outside the BMP counts once toward the floor.
  const length = Array.from(password).length;
  if (length < MASTER_PASSWORD_MIN_CHARS) {
    return err(MasterPasswordErrors.tooShort({ length, minimum: MASTER_PASSWORD_MIN_CHARS }));
  }
  return ok(password);
}

/**
 * Read this machine's master password from `secrets/backup-passphrase`, for a run with nobody there.
 *
 * @param home the Slopweaver home
 * @returns the password, `null` when none is set, or why the one that is set cannot be used
 */
export function readMasterPassword({ home }: { home: string }): Result<string | null, MasterPasswordError> {
  const read = readBackupPassphrase({ home });
  if (read.isErr()) {
    if (read.error.code === "NO_PASSPHRASE_SET") {
      return ok(null);
    }
    if (read.error.code === "SECRETS_UNREADABLE") {
      return err(MasterPasswordErrors.unreadable({ cause: read.error.cause, path: read.error.path }));
    }
    return err(MasterPasswordErrors.unreadable({ cause: new Error(read.error.message), path: home }));
  }
  return validateMasterPassword({ password: read.value });
}

/** Run one program with stdin only, returning its exit status — the one effect, replaceable in a test. */
export type ClipboardRunner = (args: { program: string; argv: readonly string[]; input: string }) => number;

/**
 * The production runner: `execFileSync`, so no shell parses anything and nothing outlives the call.
 *
 * @param program the absolute path of the program
 * @param argv its arguments
 * @param input what it reads on stdin
 * @returns its exit status, `-1` when it could not be run
 */
const runClipboard: ClipboardRunner = ({ program, argv, input }) => {
  try {
    execFileSync(program, [...argv], { input, stdio: ["pipe", "ignore", "ignore"], timeout: 10_000 });
    return 0;
  } catch (cause: unknown) {
    const status = typeof cause === "object" && cause !== null && "status" in cause ? Number(cause.status) : -1;
    return Number.isInteger(status) ? status : -1;
  }
};

/**
 * Put the master password on the macOS clipboard through `/usr/bin/pbcopy`'s stdin — the one way it is shown.
 *
 * @param run the runner, replaceable in a test
 * @returns nothing, or why the copy failed
 */
export function copyMasterPassword({
  password,
  run = runClipboard,
}: {
  password: string;
  run?: ClipboardRunner;
}): Result<void, MasterPasswordError> {
  const status = run({ argv: [], input: password, program: "/usr/bin/pbcopy" });
  if (status !== 0) {
    return err(MasterPasswordErrors.clipboardFailed({ status }));
  }
  return ok(undefined);
}
