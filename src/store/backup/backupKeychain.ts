/**
 * The backup key: 32 random bytes in the macOS login Keychain, which every object a backup writes is
 * encrypted under (`./objectCrypto.ts`). Owner ruling (option A): the nightly backup opens it with
 * NO prompt.
 *
 * ## Why it opens without a prompt, and what that does and does not reach
 *
 * The item is written by `/usr/bin/security`, so that program is in its access list, and a later `security
 * find-generic-password -w` reads it without asking — while the login Keychain is unlocked. Code running as
 * this user can therefore open it the same way, which is the trade the ruling accepted: that code can read the
 * live store anyway. A LOCKED Keychain is not opened: `security` exits 36, the backup refuses, and nothing
 * ever prompts.
 *
 * ## Why it is created on purpose and never replaced
 *
 * Every backup written under a key needs that key to be read, so replacing it silently makes every earlier
 * backup garbage. {@link createBackupKey} refuses when an item exists, writes without `-U`, and reads the key
 * back before saying it worked. The key is random rather than derived from a password, so a master password
 * kept off this machine can later WRAP it into a recovery file without re-encrypting a single backup.
 *
 * ## Why the write goes through `security -i` on stdin
 *
 * An argv `-w <value>` is visible in the process table for the length of the call; stdin is not. The
 * truncation `src/claude/keychain.ts` records for `security -i` bites past about 4032 characters, and this
 * line is under 120.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { userInfo } from "node:os";

import { err, ok, type Result } from "#lib/result.js";

import { type BackupKeyError, BackupKeyErrors } from "./backupKeyErrors.js";
import { BACKUP_KEY_BYTES, keyFingerprint } from "./objectCrypto.js";

/** The Keychain service the production backup key lives under. */
export const BACKUP_KEY_SERVICE = "slopweaver-backup-key";

/** `security` exits 44 for "no such item" and 36 for a locked keychain. */
const ABSENT_EXIT = 44;
const LOCKED_EXIT = 36;

/** How long one `security` call may take before it counts as a failure — it never waits on a person. */
const TIMEOUT_MS = 10_000;

/** What one `security` invocation returned. */
export interface SecurityOutcome {
  readonly status: number;
  readonly stdout: string;
}

/** Run `/usr/bin/security` with these arguments and optional stdin — the one effect, replaceable in a test. */
export type SecurityRunner = (args: { argv: readonly string[]; input?: string }) => SecurityOutcome;

/** What the Keychain holds for the backup key. */
export type BackupKeyStatus =
  | { readonly kind: "present"; readonly key: Buffer; readonly fingerprint: string }
  | { readonly kind: "absent" }
  | { readonly kind: "locked" };

/**
 * The account every backup-key item is filed under — this user, the same on read and write.
 *
 * @returns `$USER`, else the OS user name
 */
function keychainAccount(): string {
  const user = process.env["USER"];
  if (user === undefined || user === "") {
    return userInfo().username;
  }
  return user;
}

/**
 * The production runner: `execFileSync`, so nothing outlives the call and no shell parses an argument.
 *
 * @param argv the arguments after `security`
 * @param input stdin, when the call takes one
 * @returns the exit status and stdout
 */
const runSecurity: SecurityRunner = ({ argv, input }) => {
  try {
    const stdout = execFileSync("/usr/bin/security", [...argv], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: TIMEOUT_MS,
      ...(input === undefined ? {} : { input }),
    });
    return { status: 0, stdout };
  } catch (cause: unknown) {
    const status = typeof cause === "object" && cause !== null && "status" in cause ? Number(cause.status) : -1;
    return { status: Number.isInteger(status) ? status : -1, stdout: "" };
  }
};

/**
 * Judge one `find-generic-password -w` outcome — pure, so every branch is testable without a Keychain.
 *
 * @param outcome what `security` returned
 * @param service the service, for the message
 * @returns the key's status, or why the item is unusable
 */
export function backupKeyFromOutcome({
  outcome,
  service,
}: {
  outcome: SecurityOutcome;
  service: string;
}): Result<BackupKeyStatus, BackupKeyError> {
  if (outcome.status === ABSENT_EXIT) {
    return ok({ kind: "absent" });
  }
  if (outcome.status === LOCKED_EXIT) {
    return ok({ kind: "locked" });
  }
  if (outcome.status !== 0) {
    return err(BackupKeyErrors.readFailed({ service, status: outcome.status }));
  }
  const encoded = outcome.stdout.trim();
  const key = Buffer.from(encoded, "base64");
  if (key.length !== BACKUP_KEY_BYTES || key.toString("base64") !== encoded) {
    return err(BackupKeyErrors.malformed({ service }));
  }
  return ok({ fingerprint: keyFingerprint({ key }), key, kind: "present" });
}

/**
 * Read the backup key's status from the Keychain, never prompting.
 *
 * @param service the Keychain service; the production one unless a proof names a throwaway
 * @param run the `security` runner
 * @returns present with the key, absent, or locked — or why the item is unusable
 */
export function readBackupKey({
  service = BACKUP_KEY_SERVICE,
  run = runSecurity,
}: { service?: string; run?: SecurityRunner } = {}): Result<BackupKeyStatus, BackupKeyError> {
  const outcome = run({ argv: ["find-generic-password", "-s", service, "-a", keychainAccount(), "-w"] });
  return backupKeyFromOutcome({ outcome, service });
}

/**
 * Read the key a backup or restore needs, turning absent and locked into the errors that stop it.
 *
 * @param service the Keychain service
 * @param run the `security` runner
 * @returns the key and its fingerprint, or why there is none to use
 */
export function requireBackupKey({
  service = BACKUP_KEY_SERVICE,
  run = runSecurity,
}: { service?: string; run?: SecurityRunner } = {}): Result<{ key: Buffer; fingerprint: string }, BackupKeyError> {
  const status = readBackupKey({ run, service });
  if (status.isErr()) {
    return err(status.error);
  }
  switch (status.value.kind) {
    case "present":
      return ok({ fingerprint: status.value.fingerprint, key: status.value.key });
    case "absent":
      return err(BackupKeyErrors.absent({ service }));
    case "locked":
      return err(BackupKeyErrors.locked({ service }));
    default: {
      const unreachable: never = status.value;
      return unreachable;
    }
  }
}

/**
 * The one `security -i` line that adds the item: no `-U`, so an existing item fails rather than being
 * replaced, and `/usr/bin/security` named as the trusted reader.
 *
 * @param service the Keychain service
 * @param account the Keychain account
 * @param encoded the key, base64
 * @returns the stdin for `security -i`
 */
export function addItemCommand({
  service,
  account,
  encoded,
}: {
  service: string;
  account: string;
  encoded: string;
}): string {
  const quote = ({ value }: { value: string }): string => `"${value.replace(/(["\\])/g, "\\$1")}"`;
  return (
    `add-generic-password -s ${quote({ value: service })} -a ${quote({ value: account })} ` +
    `-T /usr/bin/security -w ${quote({ value: encoded })}\n`
  );
}

/**
 * Create the backup key: refuse if one exists, write 32 random bytes, read them back.
 *
 * @param service the Keychain service
 * @param run the `security` runner
 * @param random the source of the key's bytes
 * @returns the new key's fingerprint, or why none was created
 */
export function createBackupKey({
  service = BACKUP_KEY_SERVICE,
  run = runSecurity,
  random = ({ bytes }) => randomBytes(bytes),
}: {
  service?: string;
  run?: SecurityRunner;
  random?: (args: { bytes: number }) => Buffer;
} = {}): Result<{ fingerprint: string }, BackupKeyError> {
  const before = readBackupKey({ run, service });
  if (before.isErr()) {
    return err(before.error);
  }
  if (before.value.kind === "present") {
    return err(BackupKeyErrors.exists({ service }));
  }
  if (before.value.kind === "locked") {
    return err(BackupKeyErrors.locked({ service }));
  }
  const key = random({ bytes: BACKUP_KEY_BYTES });
  const written = run({
    argv: ["-i"],
    input: addItemCommand({ account: keychainAccount(), encoded: key.toString("base64"), service }),
  });
  if (written.status !== 0) {
    return err(BackupKeyErrors.writeFailed({ service, status: written.status }));
  }
  const after = readBackupKey({ run, service });
  if (after.isErr()) {
    return err(after.error);
  }
  if (after.value.kind !== "present" || !after.value.key.equals(key)) {
    return err(BackupKeyErrors.readbackMismatch({ service }));
  }
  return ok({ fingerprint: after.value.fingerprint });
}
