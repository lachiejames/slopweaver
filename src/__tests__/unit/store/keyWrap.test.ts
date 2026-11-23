/**
 * The backup key wrapped by the master password, and the object header that says which key a backup needs.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  BACKUP_KEY_WRAP_MAGIC,
  backupKeyWrapObjectName,
  unwrapBackupKey,
  wrapBackupKey,
} from "../../../store/backup/keyWrap.js";
import { KeyWrapErrors } from "../../../store/backup/keyWrapErrors.js";
import { keyFingerprint, OBJECT_MAGIC, objectFingerprintOf } from "../../../store/backup/objectCrypto.js";

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const PASSWORD = "abcdefghijklmnopqrstuvwxyz";
const NAME = "slopweaver/keys/x.wrap";

describe("backupKeyWrapObjectName", () => {
  it("files a wrap under the project's keys directory, named for the key's fingerprint", () => {
    expect(backupKeyWrapObjectName({ fingerprint: "631645873f6e085d", project: "slopweaver" })).toBe(
      "slopweaver/keys/631645873f6e085d.wrap",
    );
  });
});

describe("wrapBackupKey and unwrapBackupKey", () => {
  it("round-trips the exact key", () => {
    const wrapped = unwrap(wrapBackupKey({ key: KEY, password: PASSWORD }));
    const opened = unwrapBackupKey({
      armoured: wrapped,
      expectedFingerprint: keyFingerprint({ key: KEY }),
      objectName: NAME,
      password: PASSWORD,
    });
    expect(unwrap(opened).equals(KEY)).toBe(true);
  });

  it("opens with its own magic line, not the credentials bundle's", () => {
    const wrapped = unwrap(wrapBackupKey({ key: KEY, password: PASSWORD }));
    expect(wrapped.subarray(0, BACKUP_KEY_WRAP_MAGIC.length).toString("utf8")).toBe("SLOPWEAVER-BACKUP-KEY-1");
  });

  it("refuses a 25-character password and wraps nothing", () => {
    const refused = unwrapErr(wrapBackupKey({ key: KEY, password: PASSWORD.slice(1) }));
    expect(refused.code).toBe("KEY_WRAP_PASSWORD_TOO_SHORT");
  });

  it("refuses a key that is 31 or 33 bytes", () => {
    expect(unwrapErr(wrapBackupKey({ key: Buffer.alloc(31), password: PASSWORD })).message).toContain(
      "31 were handed in",
    );
    expect(unwrapErr(wrapBackupKey({ key: Buffer.alloc(33), password: PASSWORD })).message).toContain(
      "33 were handed in",
    );
  });

  it("calls a different password a wrong password, naming the wrap", () => {
    const wrapped = unwrap(wrapBackupKey({ key: KEY, password: PASSWORD }));
    const refused = unwrapErr(
      unwrapBackupKey({
        armoured: wrapped,
        expectedFingerprint: keyFingerprint({ key: KEY }),
        objectName: NAME,
        password: `${PASSWORD}x`,
      }),
    );
    expect(refused).toEqual(KeyWrapErrors.wrongPassword({ objectName: NAME }));
    expect(refused.message).toContain(NAME);
  });

  it("refuses a wrap whose key is not the one the backup names", () => {
    const wrapped = unwrap(wrapBackupKey({ key: KEY, password: PASSWORD }));
    const refused = unwrapErr(
      unwrapBackupKey({
        armoured: wrapped,
        expectedFingerprint: keyFingerprint({ key: OTHER_KEY }),
        objectName: NAME,
        password: PASSWORD,
      }),
    );
    expect(refused.code).toBe("KEY_WRAP_FINGERPRINT_MISMATCH");
  });

  it("calls bytes under another magic an unknown format", () => {
    const refused = unwrapErr(
      unwrapBackupKey({
        armoured: Buffer.from("SLOPWEAVER-SECRETS-1\n{}\nxx"),
        expectedFingerprint: keyFingerprint({ key: KEY }),
        objectName: NAME,
        password: PASSWORD,
      }),
    );
    expect(refused).toEqual(KeyWrapErrors.unknownFormat({ objectName: NAME }));
  });

  it("never carries the password in a refusal", () => {
    const wrapped = unwrap(wrapBackupKey({ key: KEY, password: PASSWORD }));
    const refused = unwrapErr(
      unwrapBackupKey({ armoured: wrapped, expectedFingerprint: "0", objectName: NAME, password: PASSWORD }),
    );
    expect(refused.message).not.toContain(PASSWORD);
  });
});

describe("objectFingerprintOf", () => {
  it("reads the key fingerprint off a complete SWOBJ1 header without any key", () => {
    const fingerprint = Buffer.from("0123456789abcdef", "hex");
    const header = Buffer.concat([OBJECT_MAGIC, fingerprint, Buffer.alloc(12)]);
    expect(unwrap(objectFingerprintOf({ header, objectName: "m" }))).toBe("0123456789abcdef");
  });

  it("refuses a header cut short", () => {
    const header = Buffer.concat([OBJECT_MAGIC, Buffer.alloc(4)]);
    expect(unwrapErr(objectFingerprintOf({ header, objectName: "m" })).code).toBe("OBJECT_NOT_ENCRYPTED");
  });

  it("refuses a plaintext object", () => {
    expect(unwrapErr(objectFingerprintOf({ header: Buffer.alloc(27, 0x41), objectName: "m" })).code).toBe(
      "OBJECT_NOT_ENCRYPTED",
    );
  });
});
