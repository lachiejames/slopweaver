/**
 * The passphrase cipher for the backup's secrets leg.
 *
 * The case that earns its place is the LAST one: a wrong passphrase and a damaged file must not report
 * the same thing, because AES-GCM reports both as one tag mismatch and a person reading the wrong message
 * goes hunting for a corrupt download when they pasted the wrong line out of their password manager.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  decryptSecretsBundle,
  encryptSecretsBundle,
  parseSecretsEnvelope,
  SECRETS_BUNDLE_MAGIC,
} from "../../../store/backup/secretsCrypto.js";

const PASSPHRASE = "correct horse battery staple";
const PLAINTEXT = Buffer.from('{"version":1,"files":[{"name":"slack-bot-token","mode":384,"contentB64":"eG94Yi0x"}]}');

/** One freshly encrypted bundle, so each case starts from a real envelope rather than a fixture string. */
function bundle(): Buffer {
  return unwrap(encryptSecretsBundle({ passphrase: PASSPHRASE, plaintext: PLAINTEXT }));
}

describe("the secrets bundle cipher", () => {
  it("round-trips the exact plaintext bytes", () => {
    const opened = decryptSecretsBundle({ armoured: bundle(), passphrase: PASSPHRASE });
    expect(opened.isOk()).toBe(true);
    expect(unwrap(opened).toString("utf8")).toBe(PLAINTEXT.toString("utf8"));
  });

  it("opens with the magic line, so a reader can refuse a shape it does not know", () => {
    expect(bundle().subarray(0, SECRETS_BUNDLE_MAGIC.length).toString("utf8")).toBe(SECRETS_BUNDLE_MAGIC);
  });

  it("produces different bytes for the same plaintext twice, so a destination reader cannot see what changed", () => {
    expect(bundle().toString("base64")).not.toBe(bundle().toString("base64"));
  });

  it("carries a 16-byte salt, a 12-byte iv and a 16-byte tag in its header", () => {
    const envelope = unwrap(parseSecretsEnvelope({ armoured: bundle() }));
    expect(Buffer.from(envelope.saltB64, "base64").length).toBe(16);
    expect(Buffer.from(envelope.ivB64, "base64").length).toBe(12);
    expect(Buffer.from(envelope.tagB64, "base64").length).toBe(16);
    expect(envelope.kdf).toBe("scrypt");
    expect(envelope.cipher).toBe("aes-256-gcm");
  });

  it("refuses an empty passphrase rather than encrypting under one", () => {
    const encrypted = encryptSecretsBundle({ passphrase: "", plaintext: PLAINTEXT });
    expect(encrypted.isErr()).toBe(true);
    expect(unwrapErr(encrypted).code).toBe("BUNDLE_CORRUPT");
  });

  it("calls a one-character-different passphrase WRONG_PASSPHRASE, not corruption", () => {
    const opened = decryptSecretsBundle({ armoured: bundle(), passphrase: `${PASSPHRASE}x` });
    expect(opened.isErr()).toBe(true);
    expect(unwrapErr(opened).code).toBe("WRONG_PASSPHRASE");
  });

  it("says out loud that one corruption case is indistinguishable from a wrong passphrase", () => {
    const opened = decryptSecretsBundle({ armoured: bundle(), passphrase: "nope" });
    expect(unwrapErr(opened).message).toContain("indistinguishable");
    expect(unwrapErr(opened).message).toContain("secrets set backup-passphrase");
  });

  it("calls an unrecognised first line UNKNOWN_FORMAT and quotes what it found", () => {
    const opened = decryptSecretsBundle({ armoured: Buffer.from("NOT-A-BUNDLE\n{}\nxx"), passphrase: PASSPHRASE });
    expect(opened.isErr()).toBe(true);
    expect(unwrapErr(opened).code).toBe("UNKNOWN_FORMAT");
    expect(unwrapErr(opened).message).toContain("NOT-A-BUNDLE");
  });

  it("replaces non-printable bytes in the what-stood-there preview rather than echoing them", () => {
    const opened = decryptSecretsBundle({
      armoured: Buffer.concat([Buffer.from([0x00, 0x1b, 0x7f, 0xc2, 0x80]), Buffer.from("\n{}\nxx")]),
      passphrase: PASSPHRASE,
    });
    expect(unwrapErr(opened).code).toBe("UNKNOWN_FORMAT");
    expect(unwrapErr(opened).message).not.toContain("\u001b");
    expect(unwrapErr(opened).message).toContain("·");
  });

  it("calls a header that is not JSON BUNDLE_CORRUPT", () => {
    const opened = decryptSecretsBundle({
      armoured: Buffer.from(`${SECRETS_BUNDLE_MAGIC}\nnot json at all\nxx`),
      passphrase: PASSPHRASE,
    });
    expect(unwrapErr(opened).code).toBe("BUNDLE_CORRUPT");
  });

  it("calls a salt of the wrong length BUNDLE_CORRUPT, naming the field and both lengths", () => {
    const header = JSON.stringify({
      cipher: "aes-256-gcm",
      ivB64: Buffer.alloc(12).toString("base64"),
      kdf: "scrypt",
      keyBytes: 32,
      n: 131072,
      p: 1,
      r: 8,
      saltB64: Buffer.alloc(4).toString("base64"),
      tagB64: Buffer.alloc(16).toString("base64"),
    });
    const parsed = parseSecretsEnvelope({ armoured: Buffer.from(`${SECRETS_BUNDLE_MAGIC}\n${header}\nxx`) });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).code).toBe("BUNDLE_CORRUPT");
    expect(unwrapErr(parsed).message).toContain("saltB64 decodes to 4 byte(s), expected 16");
  });

  it("refuses a bundle whose header is followed by no ciphertext", () => {
    const armoured = bundle();
    const headerEnd = armoured.indexOf(0x0a, armoured.indexOf(0x0a) + 1);
    const parsed = parseSecretsEnvelope({ armoured: armoured.subarray(0, headerEnd + 1) });
    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).message).toContain("no ciphertext at all");
  });
});
