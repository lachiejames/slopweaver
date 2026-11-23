import { pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { decryptCookieValue, deriveCookieKey } from "../../../browser/cookieCrypto.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

import { chromeEncrypt } from "../../chromeCookieFixture.js";

const PASSWORD = "a-fake-safe-storage-password";
const HOST = ".github.com";

const key = deriveCookieKey({ password: PASSWORD, platform: "darwin" });

describe("deriveCookieKey", () => {
  it("is Chrome's own macOS derivation: PBKDF2-HMAC-SHA1, salt saltysalt, 1003 rounds, 16 bytes", () => {
    expect(key.equals(pbkdf2Sync(PASSWORD, "saltysalt", 1003, 16, "sha1"))).toBe(true);
  });

  it("uses Linux's single round elsewhere, which is a DIFFERENT key from the same password", () => {
    const linux = deriveCookieKey({ password: PASSWORD, platform: "linux" });
    expect(linux.equals(pbkdf2Sync(PASSWORD, "saltysalt", 1, 16, "sha1"))).toBe(true);
    expect(linux.equals(key)).toBe(false);
  });
});

describe("decryptCookieValue", () => {
  it("reads back a value Chrome's own scheme encrypted", () => {
    const encrypted = chromeEncrypt({ hostKey: HOST, key, plaintext: "yes" });
    expect(unwrap(decryptCookieValue({ encrypted, hostKey: HOST, key }))).toBe("yes");
  });

  it("reads back a long value, so the padding path is exercised at every remainder", () => {
    for (const length of [1, 15, 16, 17, 64]) {
      const plaintext = "x".repeat(length);
      const encrypted = chromeEncrypt({ hostKey: HOST, key, plaintext });
      expect(unwrap(decryptCookieValue({ encrypted, hostKey: HOST, key }))).toBe(plaintext);
    }
  });

  it("REFUSES a value whose embedded digest names a different host", () => {
    // The property that makes this a check rather than a strip: a row filed under one host cannot be
    // assembled into a Cookie header for another.
    const encrypted = chromeEncrypt({ hostKey: ".evil.invalid", key, plaintext: "stolen" });
    const result = decryptCookieValue({ encrypted, hostKey: HOST, key });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("KEY_WRONG");
  });

  it("REFUSES a wrong key as a wrong key, rather than throwing on bad padding", () => {
    const encrypted = chromeEncrypt({ hostKey: HOST, key, plaintext: "yes" });
    const other = deriveCookieKey({ password: "a-different-password", platform: "darwin" });
    const result = decryptCookieValue({ encrypted, hostKey: HOST, key: other });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("KEY_WRONG");
  });

  it("names an unknown version prefix rather than decrypting whatever follows it", () => {
    const encrypted = Buffer.concat([Buffer.from("v20", "latin1"), Buffer.alloc(32)]);
    const result = decryptCookieValue({ encrypted, hostKey: HOST, key });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("JAR_UNREADABLE");
    expect(unwrapErr(result).message).toContain("v20");
  });

  it("never puts a plaintext value in an error", () => {
    const encrypted = chromeEncrypt({ hostKey: ".evil.invalid", key, plaintext: "a-secret-value" });
    // Both halves, per `.claude/rules/testing.md`'s falsifiable-witness rule: read under its
    // OWN host the ciphertext gives the plaintext straight back, so the value really is in the input.
    expect(unwrap(decryptCookieValue({ encrypted, hostKey: ".evil.invalid", key }))).toBe("a-secret-value");
    expect(unwrapErr(decryptCookieValue({ encrypted, hostKey: HOST, key })).message).not.toContain("a-secret-value");
  });
});
