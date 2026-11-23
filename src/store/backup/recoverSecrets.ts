/**
 * The credentials half of `slopweaver store recover`'s disk edge: the decrypted bundle and the values the recovery
 * derived, installed into `<home>/secrets/` at `0600`.
 *
 * **Nothing the home already holds is overwritten, bar one write.** Absent is written, byte-identical is skipped and
 * a difference is left in staging and reported, exactly as `./recoverFiles.ts` treats the files leg. The one write
 * over a difference is the home's own `store-url` repointed at the recovered database: the URL it already held with
 * only the database changed, so the login it held is the login it keeps, and the report names both databases.
 * `./recover.ts` has already refused a run whose `store-url` names a database holding a store, before any download.
 */
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomicBytes } from "#lib/writeAtomic.js";

import { createSecretFile } from "../../secrets/store.js";
import { secretFilePath, stateHomePaths } from "../../stateHome.js";
import { STORE_URL_SECRET } from "../config.js";
import { type RecoverError, RecoverErrors } from "./recoverErrors.js";
import { type InstallReplacement, type InstallReport, presentDigest, refuseInsideDestination } from "./recoverFiles.js";
import { databaseNameOf, type InstallDecision, installDecision, storeUrlDiffersOnlyByDatabase } from "./recoverPlan.js";
import { BACKUP_PASSPHRASE_SECRET } from "./secretsBundle.js";

/** One credential a recovery writes from a value it derived, rather than from the bundle. */
export interface DerivedSecret {
  readonly name: string;
  readonly value: string;
  /**
   * May replace the home's copy when the two differ ONLY by database — true for a `store-url` derived from this
   * home's own, false for everything else.
   */
  readonly replaceDatabaseOnly: boolean;
}

/** One credential on its way into `secrets/`: its bytes, where the bundle staged it, and its authority to replace. */
interface IncomingSecret {
  readonly bytes: Buffer;
  readonly name: string;
  /** `null` for a derived credential, which no bundle staged. */
  readonly stagedPath: string | null;
  /** True only for a derived `store-url` built from the home's own `store-url`. */
  readonly replaceDatabaseOnly: boolean;
}

/** What was decided for one credential, carrying the replacement when one was made. */
type SecretOutcome =
  { readonly decision: InstallDecision } | { readonly decision: "replace"; readonly replacement: InstallReplacement };

/**
 * Install the decrypted credentials into `<home>/secrets/` at `0600`, and the ones the recovery derived.
 *
 * A written or identical credential's staged plaintext copy is removed at once; a conflicting one stays in
 * the `0700` staging directory, named in the report, for a person to compare — a derived one is written
 * there at `0600` so the report's "left in staging" is true of it too. The one write over a difference is a
 * derived `store-url` marked `replaceDatabaseOnly` whose sole change from the home's own is the database, reported
 * in `replaced` by database name.
 *
 * @param staged the directory the bundle was decrypted into
 * @param names the bundle names to install as they are
 * @param derived the recovered `store-url`, and the passphrase when one was typed
 * @param home the Slopweaver home
 * @param destination the backup destination root, which no credential may land inside through a link in the home
 * @returns what was written, replaced, skipped and left behind, or the first credential that could not be written
 */
export function installStagedSecrets({
  staged,
  names,
  derived,
  home,
  destination,
}: {
  staged: string;
  names: readonly string[];
  derived: readonly DerivedSecret[];
  home: string;
  destination?: string;
}): Result<InstallReport, RecoverError> {
  const secretsDir = stateHomePaths({ home }).secrets;
  let written = 0;
  let identical = 0;
  const conflicts: string[] = [];
  const replaced: InstallReplacement[] = [];
  try {
    const incoming: IncomingSecret[] = [
      ...names.map((name) => ({
        bytes: readFileSync(join(staged, name)),
        name,
        replaceDatabaseOnly: false,
        stagedPath: join(staged, name),
      })),
      ...derived.map((secret) => ({
        bytes: Buffer.from(secret.value, "utf8"),
        name: secret.name,
        replaceDatabaseOnly: secret.replaceDatabaseOnly,
        stagedPath: null,
      })),
    ];
    mkdirSync(secretsDir, { mode: 0o700, recursive: true });
    chmodSync(secretsDir, 0o700);
    for (const secret of incoming) {
      const decided = installOneSecret({ destination, home, secret, staged });
      if (decided.isErr()) {
        return err(decided.error);
      }
      if (decided.value.decision === "replace") {
        replaced.push(decided.value.replacement);
      } else if (decided.value.decision === "write") {
        written += 1;
      } else if (decided.value.decision === "identical") {
        identical += 1;
      } else if (secret.name === BACKUP_PASSPHRASE_SECRET && secret.stagedPath === null) {
        conflicts.push(`secrets/${secret.name} (NOT staged: the password typed differs from the one this home holds)`);
      } else {
        conflicts.push(`secrets/${secret.name}`);
      }
    }
  } catch (cause: unknown) {
    return err(
      RecoverErrors.stepFailed({ reasons: [errorMessage({ error: cause })], step: "installing the credentials" }),
    );
  }
  return ok({ conflicts, identical, replaced, written });
}

/**
 * Write one credential the home lacks. The master password goes through the exclusive open `secrets set` uses, so
 * it is written to its own name and nowhere else: the atomic write's temporary sibling would be the password in a
 * second file whenever a run died between that write and the rename. Throws on a failure; the caller
 * maps that.
 *
 * @param secret the credential's name and bytes
 * @param path where it lands, `secrets/<name>`
 * @param home the Slopweaver home
 */
function writeSecret({
  secret,
  path,
  home,
}: {
  secret: { bytes: Buffer; name: string };
  path: string;
  home: string;
}): void {
  if (secret.name !== BACKUP_PASSPHRASE_SECRET) {
    writeFileAtomicBytes({ bytes: secret.bytes, dirMode: 0o700, fileMode: 0o600, path });
    chmodSync(path, 0o600);
    return;
  }
  const created = createSecretFile({ home, name: BACKUP_PASSPHRASE_SECRET, value: secret.bytes.toString("utf8") });
  if (created.isErr()) {
    throw new Error(created.error.message);
  }
}

/**
 * The replacement to make when a derived `store-url` differs from the home's own only by database, or `null` when
 * the difference must stay a conflict: a bundle-carried value, a URL derived from the environment rather than the
 * home, a link standing at the path, or any other field that differs.
 *
 * @param secret the incoming credential and its authority to replace
 * @param path the home's `secrets/<name>`
 * @param present the digest the home's copy read as, `"symlink"` for a link
 * @returns the replacement, or `null` to leave it a conflict
 */
function databaseOnlyReplacement({
  secret,
  path,
  present,
}: {
  secret: IncomingSecret;
  path: string;
  present: string | null;
}): InstallReplacement | null {
  const authorised =
    secret.name === STORE_URL_SECRET && secret.stagedPath === null && secret.replaceDatabaseOnly && present !== null;
  if (!authorised || present === "symlink" || !lstatSync(path).isFile()) {
    return null;
  }
  const before = readFileSync(path, "utf8").trim();
  const after = secret.bytes.toString("utf8").trim();
  if (!storeUrlDiffersOnlyByDatabase({ incoming: after, present: before })) {
    return null;
  }
  return {
    newDatabase: databaseNameOf({ url: after }),
    oldDatabase: databaseNameOf({ url: before }),
    path: "secrets/store-url",
  };
}

/**
 * Install one credential, never over one that differs — bar the home's own `store-url` repointed at the recovered
 * database, which is the URL it already held with only the database changed. Written, identical or replaced, its
 * staged plaintext copy is removed; conflicting, it stays in staging — a derived one is written there at `0600`
 * so it is there to compare. Throws on a write failure; the caller maps that.
 *
 * @param secret the credential, where the bundle staged it (`null` for a derived one), and its authority to replace
 * @param staged the directory the bundle was decrypted into
 * @param home the Slopweaver home
 * @param destination the backup destination root the credential must not land inside
 * @returns what was decided for it, or why the home's copy could not be read or would land in the destination
 */
function installOneSecret({
  secret,
  staged,
  home,
  destination,
}: {
  secret: IncomingSecret;
  staged: string;
  home: string;
  destination: string | undefined;
}): Result<SecretOutcome, RecoverError> {
  const path = secretFilePath({ home, name: secret.name });
  const present = presentDigest({ path });
  if (present.isErr()) {
    return err(present.error);
  }
  const decision = installDecision({ incoming: sha256({ bytes: secret.bytes }), present: present.value });
  const replacement =
    decision === "conflict" ? databaseOnlyReplacement({ path, present: present.value, secret }) : null;
  if (replacement !== null || decision === "write") {
    const outside = refuseInsideDestination({ destination, path });
    if (outside.isErr()) {
      return err(outside.error);
    }
    writeSecret({ home, path, secret });
  }
  if (replacement !== null) {
    return ok({ decision: "replace", replacement });
  }
  const conflicting = decision === "conflict";
  // The master password was typed by the operator, who holds it already: a staged copy to compare against buys
  // nothing and is the password in a second file. Its conflict is still reported, by name.
  if (conflicting && secret.stagedPath === null && secret.name !== BACKUP_PASSPHRASE_SECRET) {
    writeFileAtomicBytes({ bytes: secret.bytes, dirMode: 0o700, fileMode: 0o600, path: join(staged, secret.name) });
  }
  if (!conflicting && secret.stagedPath !== null) {
    rmSync(secret.stagedPath, { force: true });
  }
  return ok({ decision });
}

/**
 * The SHA-256 of a small in-memory value.
 *
 * @param bytes the value
 * @returns its hex digest
 */
function sha256({ bytes }: { bytes: Buffer }): string {
  return createHash("sha256").update(bytes).digest("hex");
}
