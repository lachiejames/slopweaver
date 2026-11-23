/**
 * Putting a backup's credentials back, and the four ways that refuses.
 *
 * Every refusal is asserted by its CODE rather than by "it failed", because the whole value of this leg
 * is telling a person in the middle of the night which of the four happened: nothing typed, nothing in the backup, the wrong
 * passphrase, or a file that does not match what the manifest says it should.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { BackupManifest } from "../../../store/backup/plan.js";
import { BACKUP_FILES, BACKUP_MANIFEST_VERSION, SUPABASE_PROJECT_ID } from "../../../store/backup/plan.js";
import { runRestoreSecrets } from "../../../store/backup/restoreSecrets.js";
import type { RestoreSource } from "../../../store/backup/restoreSource.js";
import { encryptSecretsBundle } from "../../../store/backup/secretsCrypto.js";
import { SecretsBackupErrors } from "../../../store/backup/secretsErrors.js";

const PASSPHRASE = "correct horse battery staple";

const minted: string[] = [];

afterEach(() => {
  minted.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

/**
 * A throwaway directory that is removed after the test that minted it.
 *
 * @returns its absolute path
 */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "restore-secrets-"));
  minted.push(dir);
  return dir;
}

/**
 * A manifest naming a credentials artefact of a given size, or naming none at all.
 *
 * @param secrets what the `secrets` field should say
 * @returns a manifest the leg will accept as verified
 */
function manifestWith({ secrets }: { secrets: BackupManifest["secrets"] }): BackupManifest {
  return {
    createdAtIso: "2026-09-20T03:00:00.000Z",
    database: "postgres",
    dump: { bytes: 1, chunked: null, sha256: "a".repeat(64) },
    extensions: [],
    pgDumpVersion: "pg_dump (PostgreSQL) 17.6",
    project: SUPABASE_PROJECT_ID,
    schemas: ["public"],
    secrets,
    storage: { bytes: 1, sha256: "b".repeat(64) },
    vault: null,
    version: BACKUP_MANIFEST_VERSION,
  };
}

/**
 * Stage a real encrypted bundle carrying one named secret, and the manifest that matches its bytes.
 *
 * @param name the secret's file name
 * @param contents what that file holds
 * @returns the source directory and a manifest whose `secrets` matches the staged file exactly
 */
function stagedBundle({ name, contents }: { name: string; contents: string }): {
  source: RestoreSource;
  manifest: BackupManifest;
} {
  const directory = scratch();
  const plaintext = Buffer.from(
    JSON.stringify({
      files: [{ contentB64: Buffer.from(contents, "utf8").toString("base64"), mode: 0o600, name }],
      version: 1,
    }),
    "utf8",
  );
  const armoured = unwrap(encryptSecretsBundle({ passphrase: PASSPHRASE, plaintext }));
  writeFileSync(join(directory, BACKUP_FILES.secrets), armoured);
  return {
    manifest: manifestWith({ secrets: { bytes: armoured.length, sha256: "c".repeat(64) } }),
    source: { directory, kind: "directory" },
  };
}

describe("runRestoreSecrets", () => {
  it("writes every secret the bundle carried, by name", () => {
    const { source, manifest } = stagedBundle({ contents: "xoxb-not-real\n", name: "slack-bot-token" });
    const into = join(scratch(), "restored");

    const report = unwrap(runRestoreSecrets({ into, manifest, passphrase: PASSPHRASE, source }));

    expect(report.names).toEqual(["slack-bot-token"]);
    expect(report.into).toBe(into);
  });

  it("refuses an empty passphrase by name, before it touches the file", () => {
    const { source, manifest } = stagedBundle({ contents: "xoxb-not-real\n", name: "slack-bot-token" });

    const failure = unwrapErr(runRestoreSecrets({ into: join(scratch(), "x"), manifest, passphrase: "", source }));

    expect(failure.code).toBe("NO_PASSPHRASE_ENTERED");
    expect(failure.message).toContain("the one line you keep in your password manager");
    expect(failure.message).not.toMatch(/1password/iu);
  });

  it("refuses on the MANIFEST when the backup carried no credentials", () => {
    const directory = scratch();
    const manifest = manifestWith({ secrets: null });

    const failure = unwrapErr(
      runRestoreSecrets({
        into: join(scratch(), "x"),
        manifest,
        passphrase: PASSPHRASE,
        source: { directory, kind: "directory" },
      }),
    );

    expect(failure.code).toBe("SECRETS_NOT_IN_BACKUP");
    expect(failure.message).toContain("2026-09-20T03:00:00.000Z");
  });

  it("names both lengths when the staged file is not the size the manifest recorded", () => {
    const { source, manifest } = stagedBundle({ contents: "xoxb-not-real\n", name: "slack-bot-token" });
    const shortened = manifestWith({ secrets: { bytes: 11, sha256: "c".repeat(64) } });

    const failure = unwrapErr(
      runRestoreSecrets({ into: join(scratch(), "x"), manifest: shortened, passphrase: PASSPHRASE, source }),
    );

    expect(failure.code).toBe("BUNDLE_CORRUPT");
    expect(failure.message).toContain("11 byte(s)");
    expect(failure.message).toContain(String(manifest.secrets!.bytes));
  });

  it("separates a wrong passphrase from a damaged file", () => {
    const { source, manifest } = stagedBundle({ contents: "xoxb-not-real\n", name: "slack-bot-token" });

    const failure = unwrapErr(
      runRestoreSecrets({ into: join(scratch(), "x"), manifest, passphrase: "not the passphrase", source }),
    );

    expect(failure.code).toBe("WRONG_PASSPHRASE");
    expect(failure.message).toContain("indistinguishable");
  });

  it("reports the file's own path when the staged bundle is not there at all", () => {
    const directory = scratch();
    mkdirSync(join(directory, "empty"), { recursive: true });
    const manifest = manifestWith({ secrets: { bytes: 42, sha256: "c".repeat(64) } });

    const failure = unwrapErr(
      runRestoreSecrets({
        into: join(scratch(), "x"),
        manifest,
        passphrase: PASSPHRASE,
        source: { directory, kind: "directory" },
      }),
    );

    expect(failure.code).toBe("SECRETS_UNREADABLE");
    expect(failure.message).toContain(BACKUP_FILES.secrets);
  });
});

describe("SecretsBackupErrors", () => {
  it("names the machine's own passphrase file on the backup side", () => {
    const error = SecretsBackupErrors.noPassphraseSet({ path: "/home/secrets/backup-passphrase" });
    expect(error.code).toBe("NO_PASSPHRASE_SET");
    expect(error.path).toBe("/home/secrets/backup-passphrase");
    expect(error.message).toContain("slopweaver secrets set backup-passphrase");
    expect(error.message).toContain("NOT in this backup");
  });

  it("carries the instant of the backup that held no credentials", () => {
    const error = SecretsBackupErrors.secretsNotInBackup({ createdAtIso: "2026-09-14T03:00:00.000Z" });
    expect(error.code).toBe("SECRETS_NOT_IN_BACKUP");
    expect(error.createdAtIso).toBe("2026-09-14T03:00:00.000Z");
    expect(error.message).toContain("2026-09-14T03:00:00.000Z");
    expect(error.message).toContain("nothing is corrupt");
  });

  it("reads a throw's own message into the unreadable line, and keeps the cause", () => {
    const cause = new Error("EACCES: permission denied");
    const error = SecretsBackupErrors.secretsUnreadable({ cause, path: "/tmp/secrets.enc" });
    expect(error.code).toBe("SECRETS_UNREADABLE");
    expect(error.cause).toBe(cause);
    expect(error.message).toBe("could not read or write /tmp/secrets.enc: EACCES: permission denied");
  });

  it("stringifies a thrown non-Error rather than printing [object Object]", () => {
    const error = SecretsBackupErrors.secretsUnreadable({ cause: "not an Error", path: "/tmp/secrets.enc" });
    expect(error.message).toBe("could not read or write /tmp/secrets.enc: not an Error");
  });

  it("replaces non-printable bytes in the unknown-format preview it quotes back", () => {
    const error = SecretsBackupErrors.unknownFormat({ found: "PK\u0003\u0004binary" });
    expect(error.code).toBe("UNKNOWN_FORMAT");
    expect(error.found).not.toContain("\u0003");
    expect(error.message).toContain("not a bundle");
  });

  it("says the one case a wrong passphrase cannot be told apart from", () => {
    const error = SecretsBackupErrors.wrongPassphrase();
    expect(error.code).toBe("WRONG_PASSPHRASE");
    expect(error.message).toContain("indistinguishable");
  });

  it("puts both measured lengths into the corrupt-bundle line", () => {
    const error = SecretsBackupErrors.bundleCorrupt({ detail: "the manifest says 387 byte(s) and the file is 12" });
    expect(error.code).toBe("BUNDLE_CORRUPT");
    expect(error.message).toBe(
      "the secrets bundle is truncated or damaged: the manifest says 387 byte(s) and the file is 12 — " +
        "fetch it from the destination again",
    );
  });
});
