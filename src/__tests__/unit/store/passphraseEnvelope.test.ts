/**
 * The passphrase envelope both the credentials bundle and the backup key's wrap are sealed in.
 *
 * The case that earns its place is the exact-parameter refusal: the header is read from the destination, so a
 * header asking for a huge scrypt cost must be refused BEFORE scrypt runs, never handed to it.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  openPassphraseEnvelope,
  parsePassphraseEnvelope,
  sealPassphraseEnvelope,
} from "../../../store/backup/passphraseEnvelope.js";
import { PassphraseEnvelopeErrors } from "../../../store/backup/passphraseEnvelopeErrors.js";

const MAGIC = "SLOPWEAVER-TEST-ENVELOPE-1";
const PASSPHRASE = "abcdefghijklmnopqrstuvwxyz";
const PLAINTEXT = Buffer.from("the bytes being sealed");

/**
 * The same envelope with one header field replaced, as new bytes — the envelope handed in is only read.
 *
 * @param armoured the sealed envelope to copy
 * @param field the header field to replace
 * @param value what it becomes
 * @returns the edited envelope bytes
 */
function withHeaderField({ armoured, field, value }: { armoured: Buffer; field: string; value: unknown }): Buffer {
  const first = armoured.indexOf(0x0a);
  const second = armoured.indexOf(0x0a, first + 1);
  const header = JSON.parse(armoured.subarray(first + 1, second).toString("utf8")) as Record<string, unknown>;
  header[field] = value;
  return Buffer.concat([Buffer.from(`${MAGIC}\n${JSON.stringify(header)}\n`, "utf8"), armoured.subarray(second + 1)]);
}

describe("the passphrase envelope", () => {
  /**
   * One envelope sealed for every case that reads it. A seal is one scrypt at N=2^17 (~200ms measured on this
   * suite's machine), and every case but the round trip and the wrong passphrase only parses the bytes; none
   * writes into them, so sharing them loses nothing.
   */
  let sealed: Buffer = Buffer.alloc(0);

  beforeAll(() => {
    sealed = unwrap(sealPassphraseEnvelope({ magic: MAGIC, passphrase: PASSPHRASE, plaintext: PLAINTEXT }));
  });

  it("round-trips the exact plaintext under its own magic", () => {
    const opened = openPassphraseEnvelope({ armoured: sealed, magic: MAGIC, passphrase: PASSPHRASE });
    expect(unwrap(opened).toString("utf8")).toBe("the bytes being sealed");
  });

  it("opens with the magic line it was sealed under", () => {
    expect(sealed.subarray(0, MAGIC.length + 1).toString("utf8")).toBe(`${MAGIC}\n`);
  });

  it("refuses an envelope sealed under a different magic as an unknown format", () => {
    const opened = openPassphraseEnvelope({ armoured: sealed, magic: "SLOPWEAVER-OTHER-1", passphrase: PASSPHRASE });
    expect(unwrapErr(opened).code).toBe("ENVELOPE_UNKNOWN_FORMAT");
  });

  it("calls a one-character-different passphrase an authentication failure", () => {
    const opened = openPassphraseEnvelope({ armoured: sealed, magic: MAGIC, passphrase: `${PASSPHRASE}!` });
    expect(unwrapErr(opened)).toEqual(PassphraseEnvelopeErrors.authenticationFailed());
  });

  it("refuses an empty passphrase rather than sealing under one", () => {
    const refused = sealPassphraseEnvelope({ magic: MAGIC, passphrase: "", plaintext: PLAINTEXT });
    expect(unwrapErr(refused)).toEqual(PassphraseEnvelopeErrors.emptyPassphrase());
  });

  it("refuses a header asking for a larger scrypt cost before deriving anything", () => {
    const parsed = parsePassphraseEnvelope({
      armoured: withHeaderField({ armoured: sealed, field: "n", value: 1_073_741_824 }),
      magic: MAGIC,
    });
    expect(unwrapErr(parsed).code).toBe("ENVELOPE_CORRUPT");
    expect(unwrapErr(parsed).message).toContain("n=1073741824, and this build opens only n=131072");
  });

  it("refuses a header whose r is not the one this build writes", () => {
    const parsed = parsePassphraseEnvelope({
      armoured: withHeaderField({ armoured: sealed, field: "r", value: 16 }),
      magic: MAGIC,
    });
    expect(unwrapErr(parsed).message).toContain("r=16, and this build opens only r=8");
  });

  it("refuses a parameter that is not a positive integer", () => {
    const parsed = parsePassphraseEnvelope({
      armoured: withHeaderField({ armoured: sealed, field: "p", value: "1" }),
      magic: MAGIC,
    });
    expect(unwrapErr(parsed).message).toContain("p is not a positive integer");
  });

  it("refuses a salt of the wrong length, naming both lengths", () => {
    const parsed = parsePassphraseEnvelope({
      armoured: withHeaderField({ armoured: sealed, field: "saltB64", value: Buffer.alloc(4).toString("base64") }),
      magic: MAGIC,
    });
    expect(unwrapErr(parsed).message).toContain("saltB64 decodes to 4 byte(s), expected 16");
  });

  it("refuses an envelope with no ciphertext after its header", () => {
    const second = sealed.indexOf(0x0a, sealed.indexOf(0x0a) + 1);
    const parsed = parsePassphraseEnvelope({ armoured: sealed.subarray(0, second + 1), magic: MAGIC });
    expect(unwrapErr(parsed).message).toContain("no ciphertext at all");
  });
});
