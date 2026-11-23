/**
 * Collecting `secrets/` into a bundle and putting one back.
 *
 * The exclusion case is written so it cannot pass vacuously: the passphrase file is WRITTEN to the home
 * first, and the assertion is that it is absent from the collected set while a sibling written the same
 * way is present. A `not.toContain` over an input that never carried the thing proves nothing.
 */
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  BACKUP_PASSPHRASE_SECRET,
  collectSecretsBundle,
  readBackupPassphrase,
  writeSecretsBundle,
} from "../../../store/backup/secretsBundle.js";
import { decryptSecretsBundle, encryptSecretsBundle } from "../../../store/backup/secretsCrypto.js";

const homes: string[] = [];

/** A throwaway home whose `secrets/` holds the named files, each at `0600`. */
function homeWithSecrets({ files }: { files: Readonly<Record<string, string>> }): string {
  const home = mkdtempSync(join(tmpdir(), "secrets-bundle-"));
  const directory = join(home, "secrets");
  mkdirSync(directory, { mode: 0o700, recursive: true });
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(join(directory, name), value, { mode: 0o600 });
  }
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("collecting the secrets bundle", () => {
  it("carries every regular file under secrets/, in name order", () => {
    const home = homeWithSecrets({ files: { "slack-bot-token": "xoxb-1", "zzz-last": "z", "aaa-first": "a" } });
    expect(unwrap(collectSecretsBundle({ home })).files.map((file) => file.name)).toEqual([
      "aaa-first",
      "slack-bot-token",
      "zzz-last",
    ]);
  });

  it("leaves the backup passphrase out while keeping its siblings — the file IS on disk", () => {
    const home = homeWithSecrets({ files: { [BACKUP_PASSPHRASE_SECRET]: "hunter2", "slack-bot-token": "xoxb-1" } });
    expect(statSync(join(home, "secrets", BACKUP_PASSPHRASE_SECRET)).isFile()).toBe(true);
    expect(unwrap(collectSecretsBundle({ home })).files.map((file) => file.name)).toEqual(["slack-bot-token"]);
  });

  it("leaves every retired name out — the upgraded home's Storage key files ARE on disk", () => {
    const home = homeWithSecrets({
      files: { "slack-bot-token": "xoxb-1", "store-api-url": "http://127.0.0.1:1", "store-service-key": "FIXTURE" },
    });
    expect(statSync(join(home, "secrets", "store-service-key")).isFile()).toBe(true);
    expect(statSync(join(home, "secrets", "store-api-url")).isFile()).toBe(true);
    expect(unwrap(collectSecretsBundle({ home })).files.map((file) => file.name)).toEqual(["slack-bot-token"]);
  });

  it("records each file's own permission bits rather than the umask's", () => {
    const home = homeWithSecrets({ files: { "slack-bot-token": "xoxb-1" } });
    expect(unwrap(collectSecretsBundle({ home })).files[0]!.mode).toBe(0o600);
  });

  it("yields an empty bundle for a home with no secrets directory at all", () => {
    const home = mkdtempSync(join(tmpdir(), "secrets-bundle-empty-"));
    homes.push(home);
    expect(unwrap(collectSecretsBundle({ home })).files).toEqual([]);
  });

  it("skips an entry that is not a regular file", () => {
    const home = homeWithSecrets({ files: { "slack-bot-token": "xoxb-1" } });
    mkdirSync(join(home, "secrets", "a-directory"));
    expect(unwrap(collectSecretsBundle({ home })).files.map((file) => file.name)).toEqual(["slack-bot-token"]);
  });

  it("reports a dangling symlink as SECRETS_UNREADABLE naming its path", () => {
    const home = homeWithSecrets({ files: { "slack-bot-token": "xoxb-1" } });
    const dangling = join(home, "secrets", "gone");
    symlinkSync(join(home, "secrets", "nothing-here"), dangling);
    const collected = collectSecretsBundle({ home });
    expect(collected.isErr()).toBe(true);
    expect(unwrapErr(collected).code).toBe("SECRETS_UNREADABLE");
    expect(unwrapErr(collected).message).toContain(dangling);
  });
});

describe("the whole round trip", () => {
  it("puts every byte and every mode back, through the cipher, into a different directory", () => {
    const home = homeWithSecrets({
      files: { "linear-token": "lin-fixture", "slack-bot-token": "xoxb-1\nsecond line kept" },
    });
    const bundle = unwrap(collectSecretsBundle({ home }));
    const armoured = unwrap(
      encryptSecretsBundle({ passphrase: "one password", plaintext: Buffer.from(JSON.stringify(bundle)) }),
    );
    const opened = unwrap(decryptSecretsBundle({ armoured, passphrase: "one password" }));

    const into = join(mkdtempSync(join(tmpdir(), "secrets-restore-")), "secrets");
    homes.push(into);
    const written = unwrap(writeSecretsBundle({ bundle: JSON.parse(opened.toString("utf8")) as typeof bundle, into }));

    expect(written).toEqual(["linear-token", "slack-bot-token"]);
    expect(unwrap(collectSecretsBundle({ home: join(into, "..") })).files).toEqual(bundle.files);
    expect(statSync(join(into, "slack-bot-token")).mode & 0o777).toBe(0o600);
    expect(statSync(into).mode & 0o777).toBe(0o700);
  });

  it("leaves a retired name in an older bundle off disk on restore", () => {
    const b64 = ({ text }: { text: string }): string => Buffer.from(text).toString("base64");
    const bundle = {
      files: [
        { contentB64: b64({ text: "xoxb-1" }), mode: 0o600, name: "slack-bot-token" },
        { contentB64: b64({ text: "FIXTURE" }), mode: 0o600, name: "store-service-key" },
      ],
      version: 1 as const,
    };
    const into = join(mkdtempSync(join(tmpdir(), "secrets-restore-retired-")), "secrets");
    homes.push(into);

    expect(unwrap(writeSecretsBundle({ bundle, into }))).toEqual(["slack-bot-token"]);
    expect(unwrap(collectSecretsBundle({ home: join(into, "..") })).files.map((file) => file.name)).toEqual([
      "slack-bot-token",
    ]);
    expect(readdirSync(into)).toEqual(["slack-bot-token"]);
  });

  it("replaces a link already standing at a secret's name rather than writing through it", () => {
    const scratch = mkdtempSync(join(tmpdir(), "secrets-restore-link-"));
    homes.push(scratch);
    const victim = join(scratch, "manifest.json");
    writeFileSync(victim, "the destination's object");
    const into = join(scratch, "secrets");
    mkdirSync(into);
    symlinkSync(victim, join(into, "slack-bot-token"));
    const bundle = {
      files: [{ contentB64: Buffer.from("xoxb-1").toString("base64"), mode: 0o600, name: "slack-bot-token" }],
      version: 1 as const,
    };

    expect(unwrap(writeSecretsBundle({ bundle, into }))).toEqual(["slack-bot-token"]);
    expect(readFileSync(victim, "utf8")).toBe("the destination's object");
    expect(lstatSync(join(into, "slack-bot-token")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(into, "slack-bot-token"), "utf8")).toBe("xoxb-1");
  });
});

describe("reading the passphrase off this machine", () => {
  it("returns the single line, without the newline a shell pipe adds", () => {
    const home = homeWithSecrets({ files: { [BACKUP_PASSPHRASE_SECRET]: "one password\n" } });
    expect(unwrap(readBackupPassphrase({ home }))).toBe("one password");
  });

  it("names the command that sets one when the file is absent", () => {
    const home = homeWithSecrets({ files: { "slack-bot-token": "xoxb-1" } });
    const read = readBackupPassphrase({ home });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).code).toBe("NO_PASSPHRASE_SET");
    expect(unwrapErr(read).message).toContain("slopweaver secrets set backup-passphrase");
  });

  it("treats an empty passphrase file as none set, rather than encrypting under nothing", () => {
    const home = homeWithSecrets({ files: { [BACKUP_PASSPHRASE_SECRET]: "\n" } });
    expect(unwrapErr(readBackupPassphrase({ home })).code).toBe("NO_PASSPHRASE_SET");
  });

  it("REFUSES a passphrase that is there and unreadable, rather than calling it none set", () => {
    const home = homeWithSecrets({ files: { [BACKUP_PASSPHRASE_SECRET]: "one password" } });
    const path = join(home, "secrets", BACKUP_PASSPHRASE_SECRET);
    chmodSync(path, 0o000);
    const read = readBackupPassphrase({ home });
    expect(read.isErr()).toBe(true);
    expect(unwrapErr(read).code).toBe("SECRETS_UNREADABLE");
    chmodSync(path, 0o600);
  });
});
