/**
 * The encrypted backup object format, round-tripped through real files: exact overhead, the size mapping,
 * the fingerprint, and every way a tampered, truncated or foreign object is refused without touching the target.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  decryptObjectFile,
  encryptObjectFile,
  keyFingerprint,
  OBJECT_HEADER_BYTES,
  OBJECT_MAGIC,
  OBJECT_OVERHEAD_BYTES,
  plaintextLengthOf,
} from "../../../store/backup/objectCrypto.js";
import { ObjectCryptoErrors } from "../../../store/backup/objectCryptoErrors.js";

const made: string[] = [];
const KEY = Buffer.alloc(32, 7);

/**
 * A fresh temporary directory, removed after each test.
 *
 * @returns its path
 */
function scratch(): string {
  const directory = mkdtempSync(join(tmpdir(), "sw-object-crypto-"));
  made.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of made.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

/**
 * Encrypt `body` under `key` into a fresh directory.
 *
 * @param body the plaintext
 * @param key the key
 * @returns the directory and the encrypted object's path
 */
async function sealed({
  body,
  key = KEY,
}: {
  body: Buffer;
  key?: Buffer;
}): Promise<{ directory: string; object: string }> {
  const directory = scratch();
  const plain = join(directory, "plain");
  writeFileSync(plain, body);
  const object = join(directory, "object.enc");
  unwrap(await encryptObjectFile({ key, objectName: "o", source: plain, target: object }));
  return { directory, object };
}

describe("the encrypted object format", () => {
  it("carries a 27-byte header and a fixed 43-byte overhead", () => {
    expect(OBJECT_HEADER_BYTES).toBe(27);
    expect(OBJECT_OVERHEAD_BYTES).toBe(43);
  });

  it("fingerprints a key as the first 16 hex characters of its sha256", () => {
    expect(keyFingerprint({ key: KEY })).toBe(createHash("sha256").update(KEY).digest("hex").slice(0, 16));
  });

  it("maps a physical length to its plaintext length at the boundary", () => {
    expect(plaintextLengthOf({ ciphertextBytes: 42 })).toBe(null);
    expect(plaintextLengthOf({ ciphertextBytes: 43 })).toBe(0);
    expect(plaintextLengthOf({ ciphertextBytes: 44 })).toBe(1);
  });

  it.each([0, 1, 65_535, 65_536, 300_001])("round-trips %i plaintext bytes", async (length) => {
    const body = randomBytes(length);
    const { directory, object } = await sealed({ body });
    expect(statSync(object).size).toBe(length + 43);
    expect(readFileSync(object).subarray(0, OBJECT_MAGIC.length).equals(OBJECT_MAGIC)).toBe(true);
    const back = join(directory, "back");
    unwrap(await decryptObjectFile({ key: KEY, objectName: "o", source: object, target: back }));
    expect(readFileSync(back).equals(body)).toBe(true);
  });

  it("encrypts only the bounded prefix and reports its length and digest", async () => {
    const directory = scratch();
    const plain = join(directory, "plain");
    writeFileSync(plain, "abcdef");
    const object = join(directory, "object.enc");
    const report = unwrap(
      await encryptObjectFile({ bytes: 4, key: KEY, objectName: "o", source: plain, target: object }),
    );
    expect(report).toEqual({
      bytes: 4,
      sealed: { bytes: 4 + 43, sha256: createHash("sha256").update(readFileSync(object)).digest("hex") },
      sha256: createHash("sha256").update("abcd").digest("hex"),
    });
    expect(statSync(object).size).toBe(4 + 43);
  });

  it("produces different bytes for the same plaintext, because each IV is fresh", async () => {
    const body = Buffer.from("same plaintext");
    const first = await sealed({ body });
    const second = await sealed({ body });
    expect(readFileSync(first.object).equals(readFileSync(second.object))).toBe(false);
  });

  it("never carries the plaintext in the clear", async () => {
    const { object } = await sealed({ body: Buffer.from("MARKER-THAT-MUST-NOT-APPEAR") });
    expect(readFileSync(object).includes(Buffer.from("MARKER-THAT-MUST-NOT-APPEAR"))).toBe(false);
  });

  it("refuses an object under another key, naming both fingerprints", async () => {
    const { directory, object } = await sealed({ body: Buffer.from("secret") });
    const other = Buffer.alloc(32, 9);
    const refused = unwrapErr(
      await decryptObjectFile({ key: other, objectName: "o", source: object, target: join(directory, "back") }),
    );
    expect(refused.code).toBe("OBJECT_KEY_MISMATCH");
    expect(refused.message).toBe(
      `o was written under backup key ${keyFingerprint({ key: KEY })}, not the key in hand (${keyFingerprint({ key: other })})`,
    );
  });

  it("refuses a plaintext file as not encrypted", async () => {
    const directory = scratch();
    const plain = join(directory, "plain.json");
    writeFileSync(plain, '{"version":3,"createdAtIso":"2026-11-03T00:00:00.000Z"}');
    const refused = unwrapErr(
      await decryptObjectFile({ key: KEY, objectName: "o", source: plain, target: join(directory, "back") }),
    );
    expect(refused).toEqual(ObjectCryptoErrors.notEncrypted({ objectName: "o" }));
  });

  it("refuses a truncated object", async () => {
    const { directory, object } = await sealed({ body: Buffer.from("secret") });
    writeFileSync(object, readFileSync(object).subarray(0, 30));
    const refused = unwrapErr(
      await decryptObjectFile({ key: KEY, objectName: "o", source: object, target: join(directory, "back") }),
    );
    expect(refused).toEqual(ObjectCryptoErrors.truncated({ bytes: 30, objectName: "o" }));
  });

  it.each([
    ["the IV", 20],
    ["the ciphertext", 27],
    ["the tag", -1],
  ])("refuses an object whose %s was changed, and writes nothing", async (_part, offset) => {
    const { directory, object } = await sealed({ body: Buffer.from("secret payload") });
    const bytes = readFileSync(object);
    const at = offset < 0 ? bytes.length + offset : offset;
    bytes[at] = bytes[at]! ^ 0xff;
    writeFileSync(object, bytes);
    const target = join(directory, "back");
    const refused = unwrapErr(await decryptObjectFile({ key: KEY, objectName: "o", source: object, target }));
    expect(refused.code).toBe("OBJECT_AUTHENTICATION_FAILED");
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(directory).toSorted()).toEqual(["object.enc", "plain"]);
  });

  it("leaves an existing target unchanged when authentication fails", async () => {
    const { directory, object } = await sealed({ body: Buffer.from("secret payload") });
    const bytes = readFileSync(object);
    bytes[30] = bytes[30]! ^ 0xff;
    writeFileSync(object, bytes);
    const target = join(directory, "back");
    writeFileSync(target, "the good copy");
    unwrapErr(await decryptObjectFile({ key: KEY, objectName: "o", source: object, target }));
    expect(readFileSync(target, "utf8")).toBe("the good copy");
  });
});
