import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { SecretsErrors } from "../../../secrets/errors.js";
import {
  checkSecretValueShape,
  createSecretFile,
  normaliseSecretInput,
  writeSecretFile,
} from "../../../secrets/store.js";
import { secretFilePath } from "../../../stateHome.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slop-secrets-"));
});
afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("normaliseSecretInput", () => {
  it("strips a single trailing newline a shell pipe adds", () => {
    expect(unwrap(normaliseSecretInput({ input: "fake-token-abc-123\n" }))).toBe("fake-token-abc-123");
  });

  it("strips a trailing CRLF", () => {
    expect(unwrap(normaliseSecretInput({ input: "fake-token-abc-123\r\n" }))).toBe("fake-token-abc-123");
  });

  it("keeps an interior-dash token byte-for-byte (no interior trim)", () => {
    expect(unwrap(normaliseSecretInput({ input: "lin_api_AbC-dEf_123" }))).toBe("lin_api_AbC-dEf_123");
  });

  it("rejects an empty value", () => {
    const error = unwrapErr(normaliseSecretInput({ input: "\n" }));

    expect(error).toEqual(SecretsErrors.emptyValue());
    expect(error.message).toBe("empty secret value — nothing to write");
  });

  it("rejects a multi-line value", () => {
    const error = unwrapErr(normaliseSecretInput({ input: "line1\nline2" }));

    expect(error).toEqual(SecretsErrors.multilineValue());
    expect(error.message).toBe("secret value spans multiple lines — expected a single-line token");
  });
});

describe("checkSecretValueShape", () => {
  const bareId = "123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com";

  it("passes a bare Google client id through unchanged", () => {
    expect(unwrap(checkSecretValueShape({ name: "google-secops-client-id", value: bareId }))).toBe(bareId);
  });

  it("refuses an autolinked client id, naming the row and never the value", () => {
    const error = unwrapErr(checkSecretValueShape({ name: "google-secops-client-id", value: `http://${bareId}/` }));

    expect(error).toEqual(
      SecretsErrors.valueShapeMismatch({
        describe: "a bare Google OAuth client id, `<digits>-<letters and digits>.apps.googleusercontent.com`",
        name: "google-secops-client-id",
      }),
    );
    expect(error.message).not.toContain(bareId);
  });

  it("refuses a trailing slash alone, on every Google client-id row", () => {
    const codes = (["google-client-id", "google-admin-client-id", "google-secops-client-id"] as const).map(
      (name) => unwrapErr(checkSecretValueShape({ name, value: `${bareId}/` })).code,
    );

    expect(codes).toEqual(["VALUE_SHAPE_MISMATCH", "VALUE_SHAPE_MISMATCH", "VALUE_SHAPE_MISMATCH"]);
  });

  it("passes any single line for a row that declares no shape", () => {
    expect(unwrap(checkSecretValueShape({ name: "linear-token", value: "http://not-a-shape/" }))).toBe(
      "http://not-a-shape/",
    );
  });
});

describe("writeSecretFile", () => {
  it("writes the token to the named secret file at 0600", () => {
    const result = unwrap(writeSecretFile({ home, name: "slack-user-token", value: "fake-slack-value" }));
    expect(result.path).toBe(secretFilePath({ home, name: "slack-user-token" }));
    expect(result.written).toBe(true);
    expect(readFileSync(result.path, "utf8")).toBe("fake-slack-value");
    expect(statSync(result.path).mode & 0o777).toBe(0o600);
  });

  it("is idempotent by content — the same value re-written keeps one file at 0600", () => {
    writeSecretFile({ home, name: "linear-token", value: "lin-1" });
    const second = unwrap(writeSecretFile({ home, name: "linear-token", value: "lin-1" }));
    expect(readFileSync(second.path, "utf8")).toBe("lin-1");
    expect(statSync(second.path).mode & 0o777).toBe(0o600);
  });

  it("overwrites a prior value and re-tightens the mode", () => {
    const path = secretFilePath({ home, name: "notion-token" });
    writeSecretFile({ home, name: "notion-token", value: "old" });
    writeSecretFile({ home, name: "notion-token", value: "new" });
    expect(readFileSync(path, "utf8")).toBe("new");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("replaces a symlink planted at the secret's path instead of writing the token through it", () => {
    const path = secretFilePath({ home, name: "knowbe4-api-token" });
    const elsewhere = join(home, "outside-secrets");
    writeFileSync(elsewhere, "untouched");
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(elsewhere, path);
    expect(lstatSync(path).isSymbolicLink()).toBe(true);

    writeSecretFile({ home, name: "knowbe4-api-token", value: "fake-kb4-value" });

    expect(readFileSync(elsewhere, "utf8")).toBe("untouched");
    expect(lstatSync(path).isSymbolicLink()).toBe(false);
    expect(readFileSync(path, "utf8")).toBe("fake-kb4-value");
  });

  it("refuses a symlinked secrets directory, and writes nothing where it points", () => {
    const path = secretFilePath({ home, name: "knowbe4-api-token" });
    const elsewhere = join(home, "outside-dir");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, dirname(path));
    expect(lstatSync(dirname(path)).isSymbolicLink()).toBe(true);

    const refused = unwrapErr(writeSecretFile({ home, name: "knowbe4-api-token", value: "fake-kb4-value" }));

    expect(refused.code).toBe("SECRET_WRITE_FAILED");
    expect(refused.message).toContain("is a symlink");
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("refuses to write under a home its group or others can write, and writes nothing", () => {
    chmodSync(home, 0o777);
    const realHome = realpathSync(home);

    const refused = unwrapErr(writeSecretFile({ home, name: "knowbe4-api-token", value: "fake-kb4-value" }));

    expect(refused.code).toBe("SECRET_WRITE_FAILED");
    expect(refused.message).toContain(`${realHome} is writable by its group or others`);
    expect(readdirSync(dirname(secretFilePath({ home, name: "knowbe4-api-token" })))).toEqual([]);
  });
});

describe("createSecretFile", () => {
  const password = "fake-master-password-FIXTURE-0001";

  it("creates the named secret file at 0600 when none stands there", () => {
    const result = unwrap(createSecretFile({ home, name: "backup-passphrase", value: password }));

    expect(result).toEqual({
      name: "backup-passphrase",
      path: secretFilePath({ home, name: "backup-passphrase" }),
      written: true,
    });
    expect(readFileSync(result.path, "utf8")).toBe(password);
    expect(statSync(result.path).mode & 0o777).toBe(0o600);
  });

  it("refuses SECRET_EXISTS over a value already there, and leaves that value as it was", () => {
    const path = secretFilePath({ home, name: "backup-passphrase" });
    unwrap(writeSecretFile({ home, name: "backup-passphrase", value: "the-one-already-saved" }));

    const refused = unwrapErr(createSecretFile({ home, name: "backup-passphrase", value: password }));

    expect(refused).toEqual(SecretsErrors.secretExists({ name: "backup-passphrase", path }));
    expect(refused.message).toBe(
      `secret backup-passphrase already exists at ${path}, and creating it never replaces one`,
    );
    expect(readFileSync(path, "utf8")).toBe("the-one-already-saved");
  });

  it("refuses a symlink planted at the name rather than writing through it", () => {
    const path = secretFilePath({ home, name: "backup-passphrase" });
    const elsewhere = join(home, "outside-secrets");
    writeFileSync(elsewhere, "untouched");
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(elsewhere, path);

    const refused = unwrapErr(createSecretFile({ home, name: "backup-passphrase", value: password }));

    expect(refused.code).toBe("SECRET_EXISTS");
    expect(readFileSync(elsewhere, "utf8")).toBe("untouched");
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
  });

  it("refuses a symlinked secrets directory, and creates nothing where it points", () => {
    const path = secretFilePath({ home, name: "backup-passphrase" });
    const elsewhere = join(home, "outside-dir");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, dirname(path));

    const refused = unwrapErr(createSecretFile({ home, name: "backup-passphrase", value: password }));

    expect(refused.code).toBe("SECRET_WRITE_FAILED");
    expect(refused.message).toContain("is a symlink");
    expect(readdirSync(elsewhere)).toEqual([]);
  });
});
