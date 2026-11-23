/**
 * The backup master password: generated at 128 bits, held to a 26-character floor, read from its 0600 file, and
 * handed over only through the clipboard's stdin.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  base32Lower,
  copyMasterPassword,
  generateMasterPassword,
  MASTER_PASSWORD_MIN_CHARS,
  readMasterPassword,
  validateMasterPassword,
} from "../../../store/backup/masterPassword.js";
import { MasterPasswordErrors } from "../../../store/backup/masterPasswordErrors.js";

const homes: string[] = [];

/**
 * A throwaway home, optionally holding a `backup-passphrase` file.
 *
 * @param passphrase the file's contents, or absent for no file
 * @returns the home
 */
function home({ passphrase }: { passphrase?: string } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-master-password-"));
  homes.push(dir);
  mkdirSync(join(dir, "secrets"), { mode: 0o700 });
  if (passphrase !== undefined) {
    writeFileSync(join(dir, "secrets", "backup-passphrase"), passphrase, { mode: 0o600 });
  }
  return dir;
}

afterEach(() => {
  homes.splice(0).forEach((dir) => {
    rmSync(dir, { force: true, recursive: true });
  });
});

describe("base32Lower", () => {
  it("encodes the RFC 4648 test vector in lowercase without padding", () => {
    expect(base32Lower({ bytes: Buffer.from("foobar") })).toBe("mzxw6ytboi");
  });

  it("encodes nothing as nothing", () => {
    expect(base32Lower({ bytes: Buffer.alloc(0) })).toBe("");
  });
});

describe("generateMasterPassword", () => {
  it("turns 16 random bytes into 26 lowercase base32 characters", () => {
    const password = generateMasterPassword({ random: ({ bytes }) => Buffer.alloc(bytes, 0xff) });
    expect(password).toBe("77777777777777777777777774");
    expect(password.length).toBe(MASTER_PASSWORD_MIN_CHARS);
  });

  it("asks the random source for exactly 16 bytes", () => {
    const asked: number[] = [];
    generateMasterPassword({
      random: ({ bytes }) => {
        asked.push(bytes);
        return Buffer.alloc(bytes);
      },
    });
    expect(asked).toEqual([16]);
  });
});

describe("validateMasterPassword", () => {
  it("refuses 25 characters, naming the length and the floor", () => {
    const refused = unwrapErr(validateMasterPassword({ password: "a".repeat(25) }));
    expect(refused.code).toBe("MASTER_PASSWORD_TOO_SHORT");
    expect(refused.message).toContain("is 25 characters, and it must be at least 26");
  });

  it("accepts 26 characters and a longer one", () => {
    expect(unwrap(validateMasterPassword({ password: "a".repeat(26) }))).toBe("a".repeat(26));
    expect(unwrap(validateMasterPassword({ password: "b".repeat(40) }))).toBe("b".repeat(40));
  });

  it("never echoes the password in the refusal", () => {
    expect(unwrapErr(validateMasterPassword({ password: "secretsecret" })).message).not.toContain("secretsecret");
  });
});

describe("readMasterPassword", () => {
  it("reads no file as no password set", () => {
    expect(unwrap(readMasterPassword({ home: home() }))).toBe(null);
  });

  it("reads a long enough password, its trailing newline removed", () => {
    expect(unwrap(readMasterPassword({ home: home({ passphrase: `${"c".repeat(26)}\n` }) }))).toBe("c".repeat(26));
  });

  it("refuses a set password shorter than the floor", () => {
    expect(unwrapErr(readMasterPassword({ home: home({ passphrase: "short" }) })).code).toBe(
      "MASTER_PASSWORD_TOO_SHORT",
    );
  });
});

describe("copyMasterPassword", () => {
  it("hands the password to pbcopy on stdin alone, with no arguments", () => {
    const calls: { program: string; argv: readonly string[]; input: string }[] = [];
    const copied = copyMasterPassword({
      password: "d".repeat(26),
      run: (call) => {
        calls.push(call);
        return 0;
      },
    });
    expect(copied.isOk()).toBe(true);
    expect(calls).toEqual([{ argv: [], input: "d".repeat(26), program: "/usr/bin/pbcopy" }]);
  });

  it("names a failed copy by its exit status", () => {
    const failed = unwrapErr(copyMasterPassword({ password: "d".repeat(26), run: () => 1 }));
    expect(failed).toEqual(MasterPasswordErrors.clipboardFailed({ status: 1 }));
    expect(failed.message).toContain("pbcopy exited 1");
  });
});
